/**
 * Cancel Reservation — pure client-safe helpers.
 *
 * Server authorization (reservations.manage) and the cancel_reservation_atomic
 * RPC remain authoritative for status eligibility and the atomic operation.
 * These helpers only drive UI gating, local validation, and payload assembly.
 *
 * Cancellation does NOT refund money or change payment status.
 */
import type { ReservationDetailDTO } from "@/lib/reservation/types";

/**
 * Reservation statuses from which a pre-arrival staff cancellation is
 * supported in this first slice. Mirrors the allow-list enforced by
 * cancel_reservation_atomic. Server/RPC validation remains authoritative.
 */
export const CANCELLABLE_STATUSES = [
  "pending_review",
  "confirmed",
  "balance_due",
  "paid_in_full",
  "ready_for_service",
  "cancellation_requested",
  "transfer_requested",
] as const;

/** Maximum cancellation reason length (matches the RPC + schema). */
export const MAX_REASON_LENGTH = 1000;

/** True only for a reservation whose status is in the cancellable allow-list. */
export function isCancellableStatus(status: string): boolean {
  return (CANCELLABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * Validate a cancellation reason locally.
 * Returns a user-facing error string, or null when valid.
 * Matches the schema: 1–1000 chars, at least one non-whitespace character.
 */
export function validateCancellationReason(reason: string): string | null {
  if (reason.length === 0) return "A cancellation reason is required.";
  if (reason.length > MAX_REASON_LENGTH)
    return `Reason must be ${MAX_REASON_LENGTH} characters or fewer.`;
  if (!/\S/.test(reason)) return "Reason must contain at least one non-whitespace character.";
  return null;
}

/** Whether a reason is non-empty and valid (ready to submit). */
export function reasonIsValid(reason: string): boolean {
  return validateCancellationReason(reason) === null;
}

/**
 * Build the cancelReservation payload from the reservation detail shown to
 * the user. The timestamp is passed through verbatim — never re-fetched or
 * re-serialized — so the optimistic-concurrency check in the RPC uses the
 * exact record the staff member reviewed.
 */
export function buildCancelPayload(
  reservation: ReservationDetailDTO,
  reason: string,
): { reservationId: string; expectedUpdatedAt: string; reason: string } {
  return {
    reservationId: reservation.id,
    expectedUpdatedAt: reservation.updatedAt,
    reason,
  };
}

/**
 * Safe codes that require an explicit reload before another cancellation
 * attempt: conflict (stale timestamp) and unexpected (uncertain outcome).
 * For these, the outcome of the previous attempt is unknown until the user
 * reloads the reservation.
 */
export function requiresReloadBeforeRetry(code: string): boolean {
  return code === "conflict" || code === "unexpected";
}

/** Party display name for the cancellation confirmation. */
export function partyDisplayName(reservation: ReservationDetailDTO): string {
  const first = reservation.contactFirstName?.trim();
  const last = reservation.contactLastName?.trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (last) return last;
  return reservation.reservationNumber;
}
