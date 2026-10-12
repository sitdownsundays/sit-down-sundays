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
 * attempt: conflict (stale timestamp), unexpected (uncertain outcome), and
 * invalid_status (the reservation is no longer in a cancellable state). For
 * these, the outcome of the previous attempt is unknown until the user
 * reloads.
 *
 * invalid_status is included because the server rejected the transition —
 * the reservation may already have been cancelled by someone else, or moved
 * to a non-cancellable state. The user must see the current state before
 * acting again.
 */
export function requiresReloadBeforeRetry(code: string): boolean {
  return code === "conflict" || code === "unexpected" || code === "invalid_status";
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

/**
 * Result of an explicit "Reload latest" operation — a discriminated union.
 *
 * Success requires the freshly-fetched ReservationDetailDTO (the exact record
 * the parent adopts into the displayed detail; no second fetch). Failure
 * requires reservation:null and a safe error. There is no "unknown" success
 * variant — a malformed server response is a failure.
 */
export type CancelReloadResult =
  | { success: true; reservation: ReservationDetailDTO }
  | { success: false; reservation: null; error: string };

/** Assessment of a reloaded reservation for the cancellation flow. */
export type CancelReloadAssessment =
  | { kind: "cancellable"; reservation: ReservationDetailDTO }
  | { kind: "already_cancelled"; reservation: ReservationDetailDTO }
  | { kind: "non_cancellable"; reservation: ReservationDetailDTO; status: string };

/**
 * Assess a freshly reloaded reservation to decide what to do next:
 * - "cancellable": status is in the cancellable allow-list — show fresh
 *   detail and allow a new cancellation using the fresh timestamp.
 * - "already_cancelled": status is cancelled — show that state; do NOT mutate.
 * - "non_cancellable": any other status — show current status and remove the
 *   cancellation action; do NOT mutate.
 */
export function assessReloadedReservationForCancel(
  reservation: ReservationDetailDTO,
): CancelReloadAssessment {
  if (reservation.status === "cancelled") {
    return { kind: "already_cancelled", reservation };
  }
  if (isCancellableStatus(reservation.status)) {
    return { kind: "cancellable", reservation };
  }
  return { kind: "non_cancellable", reservation, status: reservation.status };
}

/**
 * Status-specific message to show after a successful reload that did NOT
 * yield a cancellable reservation. Returns null for cancellable — in that
 * case the fresh detail is shown without an extra message.
 */
export function reloadOutcomeMessage(status: string): string | null {
  if (status === "cancelled") return "This reservation is already cancelled.";
  if (isCancellableStatus(status)) return null;
  const label = status.replace(/_/g, " ");
  return `This reservation is now ${label}. Cancellation is not available.`;
}

/**
 * Refresh-failure toast shown when the cancellation succeeded but the display
 * could not be refreshed. The mutation result is preserved; this does not
 * invite another mutation.
 */
export const REFRESH_FAILURE_MSG =
  "Cancelled, but the display could not be refreshed. Reload the page to see updates.";
