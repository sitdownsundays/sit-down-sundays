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
 * attempt: conflict (stale timestamp) and unexpected (uncertain outcome).
 * For these, the outcome of the previous attempt is unknown until the user
 * reloads the reservation.
 */
export function requiresReloadBeforeRetry(code: string): boolean {
  return code === "conflict" || code === "unexpected";
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
