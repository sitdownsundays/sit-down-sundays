/**
 * Cancel Reservation dialog — staff pre-arrival cancellation.
 *
 * Calls the existing cancelReservation server function with the reservation
 * detail's original updatedAt as expectedUpdatedAt (never re-fetched). Uses a
 * synchronous ref lock plus reactive submitting state. Distinguishes success,
 * already-cancelled recovery, conflict (stale), and uncertain outcomes.
 *
 * Cancellation does NOT refund money or change payment status.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

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
  requiresReloadBeforeRetry,
  validateCancellationReason,
} from "./cancel-reservation-helpers";

interface CancelReservationDialogProps {
  /** The reservation detail record shown to the user. */
  reservation: ReservationDetailDTO | null;
  /** Called after a successful cancellation so the parent refreshes detail. */
  onSaved: () => void;
  /** Called when the dialog is dismissed (cancel / outside click / escape). */
  onClose: () => void;
  /** Called so the parent reloads the latest reservation detail. */
  onReload: () => void;
}

export function CancelReservationDialog({
  reservation,
  onSaved,
  onClose,
  onReload,
}: CancelReservationDialogProps) {
  const cancelFn = useServerFn(cancelReservation);

  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submitLockRef = useRef(false);

  const open = reservation !== null;

  // Reset local state each time a different reservation opens.
  useEffect(() => {
    if (reservation) {
      setReason("");
      setError("");
      setNeedsReload(false);
      setSubmitting(false);
    }
  }, [reservation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = submitting;

  const reasonError = reason.length > 0 ? validateCancellationReason(reason) : null;
  const canSubmit =
    !!reservation && !busy && !needsReload && validateCancellationReason(reason) === null;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (busy) return; // Block dismissal while awaiting the response.
      if (!next) onClose();
    },
    [busy, onClose],
  );

  async function handleSubmit() {
    if (!reservation || submitLockRef.current) return;
    const validationError = validateCancellationReason(reason);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (needsReload) return;

    submitLockRef.current = true;
    setSubmitting(true);
    setError("");
    setNeedsReload(false);
    try {
      const result: CancelReservationResult = await cancelFn({
        data: {
          reservationId: reservation.id,
          expectedUpdatedAt: reservation.updatedAt,
          reason,
        },
      });
      if (result.ok) {
        onSaved();
        onClose();
        return;
      }
      // Preserve the entered reason on failure.
      if (requiresReloadBeforeRetry(result.code)) {
        setNeedsReload(true);
        if (result.code === "conflict") {
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
      setNeedsReload(true);
      setError("Cancellation could not be confirmed. Reload the reservation before trying again.");
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  function handleReloadLatest() {
    if (busy) return;
    setNeedsReload(false);
    setError("");
    onReload();
    onClose();
  }

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
                  setReason(e.target.value);
                  if (error && !needsReload) setError("");
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

            {needsReload && (
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
                  onClick={handleReloadLatest}
                  disabled={busy}
                >
                  Reload latest
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
