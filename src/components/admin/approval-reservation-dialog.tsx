/**
 * Approval Reservation dialog — management approval of a late-booking request
 * for deposit payment.
 *
 * Lifecycle guarantees mirror ConfirmReservationDialog:
 *  - Synchronous submit lock (ref) + reactive submitting state.
 *  - Operation-identity guard: obsolete responses are ignored.
 *  - Owner-locked lock: an old operation's finally cannot release a newer op's lock.
 *  - Uncertainty gate owned by the PARENT (keyed by reservation ID) survives
 *    dialog close/reopen.
 *  - Successful mutation feedback is preserved separately from refresh failures.
 *
 * Approval authorizes the deposit-payment window; it does NOT collect money,
 * satisfy the deposit, confirm the reservation, or change payment status.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { approveReservationForPayment } from "@/lib/sundays.functions";
import type { ApprovalResult, ApprovalBalanceDeadlineType } from "@/lib/sundays/types";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  ALREADY_APPROVED_MSG,
  APPROVAL_SUCCESS_MSG,
  buildApprovalPayload,
  partyDisplayName,
  requiresReloadBeforeRetry,
  successMessage,
  type ApprovalFormState,
  type ApprovalReloadResult,
} from "./approval-reservation-helpers";
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
  type RefreshResult,
} from "@/components/admin/refresh-result-helpers";

const DEFAULT_FORM: ApprovalFormState = {
  balanceDeadlineType: "default",
  customHours: "",
  customDeadline: "",
  reason: "",
};

interface ApprovalReservationDialogProps {
  reservation: ReservationDetailDTO | null;
  onSaved: (message: string) => Promise<CombinedRefreshResult>;
  onClose: () => void;
  onReload: () => Promise<ApprovalReloadResult>;
  gateBlocked: boolean;
  onRequireReload: (reservationId: string) => void;
}

export function ApprovalReservationDialog({
  reservation,
  onSaved,
  onClose,
  onReload,
  gateBlocked,
  onRequireReload,
}: ApprovalReservationDialogProps) {
  const approveFn = useServerFn(approveReservationForPayment);

  const [form, setForm] = useState<ApprovalFormState>(DEFAULT_FORM);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reloading, setReloading] = useState(false);

  const guardRef = useRef<OperationGuard | null>(null);
  if (guardRef.current === null) guardRef.current = createOperationGuard();
  const lockRef = useRef<OwnerLock | null>(null);
  if (lockRef.current === null) lockRef.current = createOwnerLock();

  const open = reservation !== null;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const guard = guardRef.current;
      if (guard) invalidateAll(guard);
    };
  }, []);

  useEffect(() => {
    const guard = guardRef.current!;
    if (reservation) {
      setActiveReservation(guard, reservation.id);
      setForm(DEFAULT_FORM);
      setError("");
      setNotice("");
      setSubmitting(false);
      setReloading(false);
    } else {
      invalidateAll(guard);
      setForm(DEFAULT_FORM);
      setError("");
      setNotice("");
      setSubmitting(false);
      setReloading(false);
    }
  }, [reservation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = submitting || reloading;
  const canSubmit = !!reservation && !busy && !gateBlocked;

  const handleOpenChange = useCallback(
    (next: boolean) => {
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

    if (isLocked(lock)) return;
    if (gateBlocked) return;

    const snapshot: OperationIdentity = beginOperation(guard, reservation.id);
    if (!acquireLock(lock, snapshot)) return;

    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const payload = buildApprovalPayload(reservation, form);
      const result: ApprovalResult = await approveFn({ data: payload });

      if (!mountedRef.current || !isCurrentOperation(guard, snapshot)) return;

      if (result.ok) {
        const message = successMessage(result.alreadyApproved);
        const outcome = await onSaved(message);
        if (!mountedRef.current || !isCurrentOperation(guard, snapshot)) return;
        const warn = refreshWarningForOutcome(outcome, "approved");
        if (warn) toast.warning(warn);
        onClose();
        return;
      }

      if (requiresReloadBeforeRetry(result.code)) {
        onRequireReload(reservation.id);
        if (result.code === "conflict") {
          setError(result.error);
        } else if (result.code === "default_deadline_passed") {
          setError(result.error);
        } else if (result.code === "checkout_requires_review") {
          setError(
            "An existing payment attempt needs reconciliation. Reload the reservation before approving again.",
          );
        } else {
          setError("Approval could not be verified. Reload the reservation before trying again.");
        }
      } else if (result.code === "default_deadline_passed" || result.code === "invalid_deadline") {
        // Keep the dialog open for another deadline choice.
        setError(result.error);
      } else {
        setError(result.error);
      }
    } catch {
      if (!mountedRef.current || !isCurrentOperation(guard, snapshot)) return;
      onRequireReload(reservation.id);
      setError("Approval could not be verified. Reload the reservation before trying again.");
    } finally {
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

    if (isLocked(lock)) return;

    const snapshot: OperationIdentity = beginOperation(guard, reservation.id);
    if (!acquireLock(lock, snapshot)) return;

    setReloading(true);
    setError("");
    setNotice("");
    try {
      const result = await onReload();
      if (!mountedRef.current || !isCurrentOperation(guard, snapshot)) return;
      if (!result.success) {
        setError(result.error);
      } else {
        setNotice("Reloaded the latest reservation details.");
      }
    } catch {
      if (!mountedRef.current || !isCurrentOperation(guard, snapshot)) return;
      setError("Could not reload the reservation.");
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
          <DialogTitle>Approve for deposit payment</DialogTitle>
          <DialogDescription>
            Approval allows the guest to pay their deposit. It does not record payment or confirm
            the reservation.
          </DialogDescription>
        </DialogHeader>

        {reservation && (
          <div className="space-y-4">
            <div className="rounded-md bg-muted/40 p-4 text-sm">
              <p className="font-medium">{reservation.reservationNumber}</p>
              <p className="text-muted-foreground">{partyDisplayName(reservation)}</p>
              <p className="text-muted-foreground">
                {reservation.serviceDate} · {reservation.seatingStartTime}–
                {reservation.seatingEndTime}
              </p>
              <p className="text-muted-foreground">Party size: {reservation.partySize}</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="approval-deadline-type">
                Remaining-balance deadline
              </label>
              <Select
                value={form.balanceDeadlineType}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, balanceDeadlineType: v as ApprovalBalanceDeadlineType }))
                }
                disabled={busy}
              >
                <SelectTrigger id="approval-deadline-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default — 72 hours before seating</SelectItem>
                  <SelectItem value="hours_before">Custom hours before seating</SelectItem>
                  <SelectItem value="custom">Specific date and time</SelectItem>
                  <SelectItem value="at_check_in">At check-in</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.balanceDeadlineType === "hours_before" && (
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="approval-custom-hours">
                  Hours before seating (1–720)
                </label>
                <Input
                  id="approval-custom-hours"
                  type="number"
                  min={1}
                  max={720}
                  step={1}
                  value={form.customHours}
                  onChange={(e) => setForm((f) => ({ ...f, customHours: e.target.value }))}
                  disabled={busy}
                />
              </div>
            )}

            {form.balanceDeadlineType === "custom" && (
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="approval-custom-deadline">
                  Specific date and time (with timezone)
                </label>
                <Input
                  id="approval-custom-deadline"
                  type="datetime-local"
                  value={form.customDeadline}
                  onChange={(e) => setForm((f) => ({ ...f, customDeadline: e.target.value }))}
                  disabled={busy}
                />
                <p className="text-xs text-muted-foreground">
                  Use an explicit timezone (Z or numeric offset). A timezone-less value is never
                  interpreted in the browser timezone.
                </p>
              </div>
            )}

            {form.balanceDeadlineType !== "default" && (
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="approval-reason">
                  Reason (required for non-default choices)
                </label>
                <Textarea
                  id="approval-reason"
                  maxLength={1000}
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  disabled={busy}
                  rows={3}
                />
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
            {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
            {gateBlocked && (
              <p className="text-sm text-muted-foreground">
                Reload the reservation to see its current state before approving again.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {gateBlocked && (
            <Button variant="secondary" onClick={() => void handleReloadLatest()} disabled={busy}>
              Reload latest
            </Button>
          )}
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {submitting ? "Approving…" : "Approve for deposit payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { RefreshResult };
