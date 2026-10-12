/**
 * Confirm Reservation dialog — staff confirmation of a pending_review request.
 *
 * Lifecycle guarantees:
 *  - Synchronous submit lock (ref) + reactive submitting state.
 *  - Operation-identity guard: obsolete responses (unmount, reservation
 *    change, close, or a newer operation) are ignored via identity + generation.
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
 * Confirmation accepts the reservation request; it does NOT collect payment or
 * mark the deposit as paid.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { confirmReservation } from "@/lib/sundays.functions";
import type { ConfirmReservationResult } from "@/lib/sundays/types";
import type { ReservationDetailDTO } from "@/lib/reservation/types";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  ALREADY_CONFIRMED_MSG,
  CONFIRM_SUCCESS_MSG,
  partyDisplayName,
  reloadOutcomeMessage,
  requiresReloadBeforeRetry,
} from "./confirm-reservation-helpers";
import type { ConfirmReloadResult } from "./confirm-reservation-helpers";
import {
  beginOperation,
  createOperationGuard,
  createOwnerLock,
  acquireLock,
  isCurrentOperation,
  isLocked,
  invalidateAll,
  ownsLock,
  releaseLock,
  setActiveReservation,
} from "./confirm-reservation-guard";
import type { OperationIdentity, OperationGuard, OwnerLock } from "./confirm-reservation-guard";
import {
  refreshWarningForOutcome,
  type CombinedRefreshResult,
} from "@/components/admin/refresh-result-helpers";

interface ConfirmReservationDialogProps {
  /** The reservation detail record shown to the user. Null = closed. */
  reservation: ReservationDetailDTO | null;
  /**
   * Called after a successful confirmation. The parent refreshes detail + list
   * with meaningful awaited results and reports any refresh failure separately.
   * Returns a CombinedRefreshResult so a "superseded" refresh is never
   * confused with a "failure" or a "success".
   * @param message distinct success feedback (confirmed vs already-confirmed)
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
  onReload: () => Promise<ConfirmReloadResult>;
  /**
   * Whether the parent's uncertainty gate is currently blocking another
   * attempt for THIS reservation. Survives dialog close/reopen.
   */
  gateBlocked: boolean;
  /**
   * Notify the parent to block another attempt for this reservation ID.
   * Invoked for conflict/unexpected/invalid_status failures and thrown errors.
   */
  onRequireReload: (reservationId: string) => void;
}

export function ConfirmReservationDialog({
  reservation,
  onSaved,
  onClose,
  onReload,
  gateBlocked,
  onRequireReload,
}: ConfirmReservationDialogProps) {
  const confirmFn = useServerFn(confirmReservation);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reloading, setReloading] = useState(false);

  const guardRef = useRef<OperationGuard | null>(null);
  if (guardRef.current === null) guardRef.current = createOperationGuard();
  const lockRef = useRef<OwnerLock | null>(null);
  if (lockRef.current === null) lockRef.current = createOwnerLock();

  const open = reservation !== null;

  // Track mount status so we never setState after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Invalidate all pending operations on unmount (StrictMode safe).
      const guard = guardRef.current;
      if (guard) invalidateAll(guard);
    };
  }, []);

  // Update active reservation identity + generation on change/close.
  // A→B→A gets a strictly greater generation, so the original cannot revive.
  useEffect(() => {
    const guard = guardRef.current!;
    if (reservation) {
      setActiveReservation(guard, reservation.id);
      // Reset local (non-gate) state each time a different reservation opens.
      setError("");
      setNotice("");
      setSubmitting(false);
      setReloading(false);
    } else {
      // Closing the dialog invalidates pending operations.
      invalidateAll(guard);
      setError("");
      setNotice("");
      setSubmitting(false);
      setReloading(false);
    }
  }, [reservation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = submitting || reloading;
  // Submission is blocked while submitting, reloading, or while the parent's
  // uncertainty gate is closed for this reservation.
  const canSubmit = !!reservation && !busy && !gateBlocked;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      // Guard dismissal using the owner lock, not just reactive state.
      const lock = lockRef.current!;
      if (isLocked(lock)) return;
      if (reloading) return;
      if (!next) onClose();
    },
    [reloading, onClose],
  );

  async function handleSubmit() {
    if (!reservation) return;
    const guard = guardRef.current!;
    const lock = lockRef.current!;

    // Synchronous duplicate-submit guard.
    if (isLocked(lock)) return;
    if (gateBlocked) return;

    const snapshot: OperationIdentity = beginOperation(guard, reservation.id);
    if (!acquireLock(lock, snapshot)) return;

    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const result: ConfirmReservationResult = await confirmFn({
        data: {
          reservationId: reservation.id,
          expectedUpdatedAt: reservation.updatedAt,
        },
      });

      // Ignore obsolete responses: unmount, reservation change, close, or a
      // newer operation. Reads current identity via the ref.
      if (!mountedRef.current || !isCurrentOperation(guard, snapshot)) return;

      if (result.ok) {
        const message = result.alreadyConfirmed ? ALREADY_CONFIRMED_MSG : CONFIRM_SUCCESS_MSG;
        // Refresh detail + list. A refresh failure is reported separately via
        // the Sonner toast (which survives dialog close) and does NOT
        // invalidate the successful mutation. Only status:"failure" counts;
        // a "superseded" refresh is NOT a failure — a newer operation owns
        // the display now.
        const outcome = await onSaved(message);
        if (!mountedRef.current || !isCurrentOperation(guard, snapshot)) return;
        const warn = refreshWarningForOutcome(outcome, "confirmed");
        if (warn) toast.warning(warn);
        onClose();
        return;
      }
      // Any failure that requires reload blocks another attempt. The gate is
      // owned by the parent, so it persists across close/reopen.
      if (requiresReloadBeforeRetry(result.code)) {
        onRequireReload(reservation.id);
        if (result.code === "conflict") {
          setError(result.error);
        } else {
          setError(
            "Confirmation could not be verified. Reload the reservation before trying again.",
          );
        }
      } else {
        setError(result.error);
      }
    } catch {
      if (!mountedRef.current || !isCurrentOperation(guard, snapshot)) return;
      // Uncertain outcome — never claim success or failure. Require reload.
      onRequireReload(reservation.id);
      setError("Confirmation could not be verified. Reload the reservation before trying again.");
    } finally {
      // Only release if THIS operation still owns the lock. An old op's
      // finally cannot release a newer op's lock.
      if (ownsLock(lock, snapshot)) {
        releaseLock(lock, snapshot);
        if (isCurrentOperation(guard, snapshot)) {
          setSubmitting(false);
        }
      }
    }
  }

  async function handleReloadLatest() {
    if (!reservation) return;
    const guard = guardRef.current!;
    const lock = lockRef.current!;

    // Prevent simultaneous submit/reload and repeated reload clicks.
    if (isLocked(lock)) return;

    const snapshot: OperationIdentity = beginOperation(guard, reservation.id);
    if (!acquireLock(lock, snapshot)) return;

    setReloading(true);
    setError("");
    setNotice("");
    try {
      const result = await onReload();
      // Ignore obsolete reload results: unmount, reservation change, close,
      // or a newer operation.
      if (!mountedRef.current || !isCurrentOperation(guard, snapshot)) return;
      if (!result.success) {
        // Gate stays closed; show the reload failure but do not close.
        setError(result.error ?? "Could not reload the reservation. Try again.");
        return;
      }
      // Successful reload — the parent has adopted the exact record into the
      // displayed detail. Clear local error; the parent cleared the gate based
      // on the fresh status. Keep the dialog open so the staff member sees the
      // refreshed detail (for pending_review they can confirm with the fresh
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
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirm reservation</DialogTitle>
          <DialogDescription>
            This accepts the reservation request. It does not collect payment or mark the deposit as
            paid.
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
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Party size
                </dt>
                <dd className="mt-0.5 font-medium text-foreground">{reservation.partySize}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Service
                </dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {reservation.serviceDate}
                  <span className="text-muted-foreground">
                    {" "}
                    {reservation.seatingStartTime}–{reservation.seatingEndTime}
                  </span>
                </dd>
              </div>
            </dl>

            <p className="text-sm text-muted-foreground">
              Confirmation moves this reservation from pending review to confirmed. Payment amounts
              and payment status are not changed by this action.
            </p>

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
                  The reservation may have changed, or the confirmation outcome could not be
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
            Keep pending
          </Button>
          <Button variant="default" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {submitting ? "Confirming…" : "Confirm reservation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
