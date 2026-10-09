/**
 * Confirm Reservation dialog — staff confirmation of a pending_review request.
 *
 * Calls the existing confirmReservation server function with the reservation
 * detail's original updatedAt as expectedUpdatedAt (never re-fetched). Uses a
 * synchronous ref lock plus reactive submitting state. Distinguishes success,
 * already-confirmed recovery, conflict (stale), and uncertain outcomes.
 *
 * Confirmation accepts the reservation request; it does NOT collect payment or
 * mark the deposit as paid.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";

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

import { partyDisplayName, requiresReloadBeforeRetry } from "./confirm-reservation-helpers";

interface ConfirmReservationDialogProps {
  /** The reservation detail record shown to the user. */
  reservation: ReservationDetailDTO | null;
  /** Called after a successful confirmation so the parent refreshes detail. */
  onSaved: () => void;
  /** Called when the dialog is dismissed (cancel / outside click / escape). */
  onClose: () => void;
  /** Called so the parent reloads the latest reservation detail. */
  onReload: () => void;
}

export function ConfirmReservationDialog({
  reservation,
  onSaved,
  onClose,
  onReload,
}: ConfirmReservationDialogProps) {
  const confirmFn = useServerFn(confirmReservation);

  const [error, setError] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submitLockRef = useRef(false);

  const open = reservation !== null;

  // Reset local state each time a different reservation opens.
  useEffect(() => {
    if (reservation) {
      setError("");
      setNeedsReload(false);
      setSubmitting(false);
    }
  }, [reservation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = submitting;
  const canSubmit = !!reservation && !busy && !needsReload;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (busy) return; // Block dismissal while awaiting the response.
      if (!next) onClose();
    },
    [busy, onClose],
  );

  async function handleSubmit() {
    if (!reservation || submitLockRef.current) return;
    if (needsReload) return;

    submitLockRef.current = true;
    setSubmitting(true);
    setError("");
    setNeedsReload(false);
    try {
      const result: ConfirmReservationResult = await confirmFn({
        data: {
          reservationId: reservation.id,
          expectedUpdatedAt: reservation.updatedAt,
        },
      });
      if (result.ok) {
        onSaved();
        onClose();
        return;
      }
      if (requiresReloadBeforeRetry(result.code)) {
        setNeedsReload(true);
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
      // Uncertain outcome — never claim success or failure. Require reload.
      setNeedsReload(true);
      setError("Confirmation could not be verified. Reload the reservation before trying again.");
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

            {needsReload && (
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
