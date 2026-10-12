/**
 * Confirm Reservation — pure client-safe helpers.
 *
 * Server authorization (reservations.manage) and the confirm_reservation_atomic
 * RPC remain authoritative for status eligibility and the atomic operation.
 * These helpers only drive UI gating and payload assembly.
 *
 * Confirmation accepts the reservation request; it does NOT collect payment,
 * satisfy the deposit, or change payment status.
 */
import type { ReservationDetailDTO } from "@/lib/reservation/types";

/**
 * The single reservation status from which staff confirmation is supported in
 * this slice. Mirrors the transition enforced by confirm_reservation_atomic:
 * pending_review → confirmed. Server/RPC validation remains authoritative.
 */
export const CONFIRMABLE_STATUS = "pending_review" as const;

/** True only for a reservation whose status is pending_review. */
export function isConfirmableStatus(status: string): boolean {
  return status === CONFIRMABLE_STATUS;
}

/**
 * Build the confirmReservation payload from the reservation detail shown to
 * the user. The timestamp is passed through verbatim — never re-fetched or
 * re-serialized — so the optimistic-concurrency check in the RPC uses the
 * exact record the staff member reviewed.
 */
export function buildConfirmPayload(reservation: ReservationDetailDTO): {
  reservationId: string;
  expectedUpdatedAt: string;
} {
  return {
    reservationId: reservation.id,
    expectedUpdatedAt: reservation.updatedAt,
  };
}

/**
 * Safe codes that require an explicit reload before another confirmation
 * attempt: conflict (stale timestamp), unexpected (uncertain outcome), and
 * invalid_status (the reservation is no longer pending_review). For these,
 * the outcome of the previous attempt is unknown until the user reloads.
 *
 * invalid_status is included because the server rejected the transition —
 * the reservation may already have been confirmed by someone else, or moved
 * to a different state. The user must see the current state before acting again.
 */
export function requiresReloadBeforeRetry(code: string): boolean {
  return code === "conflict" || code === "unexpected" || code === "invalid_status";
}

/** Party display name for the confirmation summary. */
export function partyDisplayName(reservation: ReservationDetailDTO): string {
  const first = reservation.contactFirstName?.trim();
  const last = reservation.contactLastName?.trim();
  if (first && last) return `${first} ${last}`;
  if (first) return first;
  if (last) return last;
  return reservation.reservationNumber;
}

/** Success feedback for a fresh confirmation. */
export const CONFIRM_SUCCESS_MSG = "Reservation confirmed.";
/** Success feedback for an already-confirmed recovery (idempotent retry). */
export const ALREADY_CONFIRMED_MSG = "Reservation is already confirmed.";

/**
 * Result of an explicit "Reload latest" operation — a discriminated union.
 *
 * Success requires the freshly-fetched ReservationDetailDTO (the exact record
 * the parent adopts into the displayed detail; no second fetch). Failure
 * requires reservation:null and a safe error. There is no "unknown" success
 * variant — a malformed server response is a failure.
 */
export type ConfirmReloadResult =
  | { success: true; reservation: ReservationDetailDTO }
  | { success: false; reservation: null; error: string };

/** Assessment of a reloaded reservation for the confirmation flow. */
export type ReloadAssessment =
  | { kind: "confirmable"; reservation: ReservationDetailDTO }
  | { kind: "already_confirmed"; reservation: ReservationDetailDTO }
  | { kind: "inapplicable"; reservation: ReservationDetailDTO; status: string };

/**
 * Assess a freshly reloaded reservation to decide what to do next:
 * - "confirmable": status is pending_review — show fresh detail and allow a
 *   new confirmation using the fresh timestamp.
 * - "already_confirmed": status is confirmed — show that state; do NOT mutate.
 * - "inapplicable": any other status — show current status and remove the
 *   confirmation action; do NOT mutate.
 */
export function assessReloadedReservation(reservation: ReservationDetailDTO): ReloadAssessment {
  if (reservation.status === "confirmed") {
    return { kind: "already_confirmed", reservation };
  }
  if (isConfirmableStatus(reservation.status)) {
    return { kind: "confirmable", reservation };
  }
  return { kind: "inapplicable", reservation, status: reservation.status };
}

/**
 * Success feedback label distinguishing a fresh confirmation from an
 * already-confirmed recovery (idempotent retry).
 */
export function successMessage(alreadyConfirmed: boolean): string {
  return alreadyConfirmed ? ALREADY_CONFIRMED_MSG : CONFIRM_SUCCESS_MSG;
}

/**
 * Refresh-failure toast shown when the mutation succeeded but the display
 * could not be refreshed. The mutation result is preserved; this does not
 * invite another mutation.
 */
export const REFRESH_FAILURE_MSG =
  "Confirmed, but the display could not be refreshed. Reload the page to see updates.";

/**
 * Status-specific message to show after a successful reload that did NOT
 * yield a confirmable (pending_review) reservation. Returns null for
 * pending_review — in that case the gate-block UI handles the message.
 */
export function reloadOutcomeMessage(status: string): string | null {
  if (status === "confirmed") return ALREADY_CONFIRMED_MSG;
  if (status === "pending_review") return null;
  const label = status.replace(/_/g, " ");
  return `This reservation is now ${label}. Confirmation is not available.`;
}
