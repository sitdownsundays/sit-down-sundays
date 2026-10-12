/**
 * Cancel Reservation dialog — staff pre-arrival cancellation.
 *
 * Calls the existing cancelReservation server function with the reservation
 * detail's original updatedAt as expectedUpdatedAt (never re-fetched). Uses a
 * synchronous ref lock plus reactive submitting state. Distinguishes success,
 * already-cancelled recovery, conflict (stale), and uncertain outcomes.
 *
 * Recovery state (reason + retry gate) is owned by the PARENT
 * CancelReservationPanel, keyed by reservation ID, so it survives dialog
 * close/reopen. This dialog is a controlled view over that state.
 *
 * Stale-response guard:
 *  - Operation-identity + generation guard: a response after reservation
 *    change/close/unmount is obsolete and ignored (no setState/onClose/toast).
 *  - Owner-locked lock: an old operation's finally cannot release a newer op's lock.
 *  - Uncertainty gate owned by the PARENT (keyed by reservation ID) survives
 *    dialog close/reopen — closing and reopening does not bypass it.
 *  - "Reload latest" is an awaited operation; the parent adopts the fresh
 *    record into the displayed detail (no second fetch) and returns success/
 *    failure. The gate only clears on a successful reload of the SAME
 *    reservation whose details were adopted.
 *  - Successful mutation feedback is preserved separately from refresh
 *    failures.
 *
 * Cancellation does NOT refund money or change payment status.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { cancelReservation } from "@/lib/sundays.functions";
import type { CancelReservationResult } from "@/lib/sundays/types";
import type { ReservationDetailDTO } from "@/lib/reservation/types";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  MAX_REASON_LENGTH,
  partyDisplayName,
  reloadOutcomeMessage,
  requiresReloadBeforeRetry,
  validateCancellationReason,
} from "./cancel-reservation-helpers";
import type { CancelReloadResult } from "./cancel-reservation-helpers";
import {
  acquireLock,
  beginOperation,
  createOperationGuard,
  createOwnerLock,
  invalidateAll,
  isCurrentOperation,
  isLocked,
  ownsLock,
  releaseLock,
  setActiveReservation,
} from "@/components/admin/confirm-reservation-guard";
import type { OperationGuard, OwnerLock } from "@/components/admin/confirm-reservation-guard";
import {
  refreshWarningForOutcome,
  type CombinedRefreshResult,
} from "@/components/admin/refresh-result-helpers";

interface CancelReservationDialogProps {
  /** The reservation detail record shown to the user. Null = closed. */
  reservation: ReservationDetailDTO | null;
  /** True when the parent-owned uncertainty gate blocks another attempt. */
  gateBlocked: boolean;
  /** The reason stored by the parent (survives close/reopen). */
  storedReason: string;
  /** Notify the parent that the reason changed. */
  onReasonChange: (reason: string) => void;
  /**
   * Called after a successful cancellation. The parent refreshes detail + list
   * with meaningful awaited results and reports any refresh failure separately.
   * Returns a CombinedRefreshResult so a "superseded" refresh is never
   * confused with a "failure" or a "success".
   * @param message distinct success feedback (cancelled vs already-cancelled)
   */
  onSaved: (message: string) => Promise<CombinedRefreshResult>;
  /** Called when the dialog is dismissed (cancel / outside click / escape). */
  onClose: () => void;
  /**
   * Awaitable reload: the parent re-fetches the latest reservation detail,
   * adopts it into the displayed detail, and returns success/failure with the
   * exact record. The gate stays closed until this resolves OK for the SAME
   * reservation.
   */
  onReload: () => Promise<CancelReloadResult>;
  /**
   * Notified when an uncertain/conflict/invalid_status outcome requires the
   * parent to block another attempt for this reservation. The gate survives
   * close/reopen.
   */
  onRequireReload: (reservationId: string) => void;
}

export function CancelReservationDialog({
  reservation,
  gateBlocked,
  storedReason,
  onReasonChange,
  onSaved,
  onClose,
  onReload,
  onRequireReload,
}: CancelReservationDialogProps) {
  const cancelFn = useServerFn(cancelReservation);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reloading, setReloading] = useState(false);

  // Stale-response guard: tracks current reservation identity + generation.
  const guardRef = useRef<OperationGuard | null>(null);
  if (guardRef.current === null) guardRef.current = createOperationGuard();
  const mountedRef = useRef(true);

  // Owner-locked lock: an old op's finally cannot release a newer op's lock.
  const lockRef = useRef<OwnerLock | null>(null);
  if (lockRef.current === null) lockRef.current = createOwnerLock();

  const open = reservation !== null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const guard = guardRef.current;
      if (guard) invalidateAll(guard);
    };
  }, []);

  // Reset local (non-gate) state each time a different reservation opens,
  // and invalidate pending operations on close.
  useEffect(() => {
    const guard = guardRef.current!;
    if (reservation) {
      setActiveReservation(guard, reservation.id);
      setError("");
      setNotice("");
      setSubmitting(false);
      setReloading(false);
    } else {
      invalidateAll(guard);
      setError("");
      setNotice("");
      setSubmitting(false);
      setReloading(false);
    }
  }, [reservation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reason = storedReason;
  const busy = submitting || reloading;

  const reasonError = reason.length > 0 ? validateCancellationReason(reason) : null;
  const canSubmit =
    !!reservation && !busy && !gateBlocked && validateCancellationReason(reason) === null;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (busy) return; // Block dismissal while awaiting a response.
      if (!next) onClose();
    },
    [busy, onClose],
  );

  const handleSubmit = useCallback(async () => {
    if (!reservation) return;
    const lock = lockRef.current!;
    if (isLocked(lock) || gateBlocked) return;
    const validationError = validateCancellationReason(reason);
    if (validationError) {
      setError(validationError);
      return;
    }

    const guard = guardRef.current!;
    const snapshot = beginOperation(guard, reservation.id);
    acquireLock(lock, snapshot);

    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const result: CancelReservationResult = await cancelFn({
        data: {
          reservationId: reservation.id,
          expectedUpdatedAt: reservation.updatedAt,
          reason,
        },
      });
      // Ignore obsolete responses: unmount, reservation change, close, or a
      // newer operation. Do NOT setState/onClose/toast for an obsolete result.
      if (!mountedRef.current || !isCurrentOperation(guard, snapshot)) return;

      if (result.ok) {
        const message = result.alreadyCancelled
          ? "Reservation is already cancelled."
          : "Reservation cancelled.";
        // Refresh detail + list. A refresh failure is reported separately via
        // the Sonner toast (which survives dialog close) and does NOT
        // invalidate the successful mutation. Only status:"failure" counts;
        // a "superseded" refresh is NOT a failure — a newer operation owns
        // the display now.
        const outcome = await onSaved(message);
        if (!mountedRef.current || !isCurrentOperation(guard, snapshot)) return;
        const warn = refreshWarningForOutcome(outcome, "cancelled");
        if (warn) toast.warning(warn);
        onClose();
        return;
      }

      // Failure — preserve the entered reason.
      if (requiresReloadBeforeRetry(result.code)) {
        onRequireReload(reservation.id);
        if (result.code === "conflict" || result.code === "invalid_status") {
          setError(result.error);
        } else {
          setError(
            "Cancellation could not be confirmed. Reload the reservation before trying again.",
          );
        }
      } else {
        setError(result.error);
      }
    } catch {
      // Uncertain outcome — never claim success or failure. Require reload.
      if (!mountedRef.current || !isCurrentOperation(guard, snapshot)) return;
      onRequireReload(reservation.id);
      setError("Cancellation could not be confirmed. Reload the reservation before trying again.");
    } finally {
      // Only release the lock if THIS operation still owns it. An old op's
      // finally must not release a newer op's lock.
      if (ownsLock(lock, snapshot)) {
        releaseLock(lock, snapshot);
        if (isCurrentOperation(guard, snapshot)) {
          setSubmitting(false);
        }
      }
    }
  }, [reservation, reason, gateBlocked, cancelFn, onSaved, onClose, onRequireReload]);

  const handleReloadLatest = useCallback(async () => {
    if (!reservation) return;
    const lock = lockRef.current!;
    if (isLocked(lock)) return;

    const guard = guardRef.current!;
    const snapshot = beginOperation(guard, reservation.id);
    acquireLock(lock, snapshot);

    setReloading(true);
    setError("");
    setNotice("");
    try {
      const result = await onReload();
      // Ignore obsolete reload results: unmount, reservation change, close,
      // or a newer operation.
      if (!mountedRef.current || !isCurrentOperation(guard, snapshot)) return;

      if (!result.success) {
        // Reload failed — gate stays blocked, reason preserved.
        setError(result.error ?? "Could not reload the reservation. Try again.");
        return;
      }
      // Successful reload — the parent has adopted the exact record into the
      // displayed detail. Clear local error; the parent cleared the gate based
      // on the fresh status. Keep the dialog open so the staff member sees the
      // refreshed detail (for cancellable they can cancel with the fresh
      // timestamp; for other statuses the gate stays blocked with a message).
      setError("");
      const msg = reloadOutcomeMessage(result.reservation.status);
      if (msg) {
        setNotice(msg);
      } else {
        setNotice("");
      }
    } finally {
      if (ownsLock(lock, snapshot)) {
        releaseLock(lock, snapshot);
        if (isCurrentOperation(guard, snapshot)) {
          setReloading(false);
        }
      }
    }
  }, [reservation, onReload]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cancel reservation</DialogTitle>
          <DialogDescription>
            This cancels the entire party&rsquo;s reservation and releases its assigned tables. It
            does not issue a refund or credit.
          </DialogDescription>
        </DialogHeader>

        {reservation && (
          <div className="space-y-4 py-2">
            {/* Reservation summary */}
            <dl className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Reservation
                </dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {reservation.reservationNumber}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Party
                </dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {partyDisplayName(reservation)}
                </dd>
              </div>
            </dl>

            <p className="text-sm text-muted-foreground">
              Cancellation releases assigned tables and records a reason. Payment amounts and status
              are not changed by this action.
            </p>

            {/* Reason */}
            <div className="space-y-1.5">
              <Label htmlFor="cancel-reason" className="text-sm font-medium text-foreground">
                Cancellation reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="cancel-reason"
                value={reason}
                onChange={(e) => {
                  onReasonChange(e.target.value);
                  if (error && !gateBlocked) setError("");
                }}
                disabled={busy}
                maxLength={MAX_REASON_LENGTH}
                placeholder="Explain why this reservation is being cancelled…"
                aria-describedby="cancel-reason-hint"
                aria-invalid={!!reasonError}
                rows={4}
              />
              <div className="flex items-center justify-between">
                <p id="cancel-reason-hint" className="text-xs text-muted-foreground">
                  Required. Maximum {MAX_REASON_LENGTH} characters.
                </p>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {reason.length}/{MAX_REASON_LENGTH}
                </span>
              </div>
              {reasonError && (
                <p role="alert" className="text-sm text-destructive">
                  {reasonError}
                </p>
              )}
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            {notice && (
              <p
                role="status"
                className="rounded-md border border-border bg-muted/40 p-2 text-sm text-foreground"
              >
                {notice}
              </p>
            )}

            {gateBlocked && (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p className="font-medium text-foreground">Reload required</p>
                <p className="mt-1 text-muted-foreground">
                  The reservation may have changed, or the cancellation outcome could not be
                  confirmed. Reload the latest reservation before another attempt.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => void handleReloadLatest()}
                  disabled={busy}
                >
                  {reloading ? "Reloading…" : "Reload latest"}
                </Button>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Keep reservation
          </Button>
          <Button variant="destructive" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {submitting ? "Cancelling…" : "Cancel reservation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
