/**
 * Confirm Reservation lifecycle controller.
 *
 * Pure framework-agnostic state machine for the confirmation lifecycle:
 * the parent-owned uncertainty gate (keyed by reservation ID) and the
 * reload-assessment logic. The ConfirmReservationPanel component uses this
 * controller, so tests against it exercise the REAL production logic rather
 * than a copied model.
 *
 * Lives in a separate module so it is testable without a DOM and can be
 * imported by both the panel component and its lifecycle tests.
 */
import type { ReservationDetailDTO } from "@/lib/reservation/types";
import { assessReloadedReservation } from "./confirm-reservation-helpers";
import type { ConfirmReloadResult } from "./confirm-reservation-helpers";

export type ConfirmGateMap = Record<string, boolean>;

/** Create a fresh empty gate. */
export function createConfirmGate(): ConfirmGateMap {
  return {};
}

/** True if the gate currently blocks another attempt for this reservation. */
export function isGateBlocked(gate: ConfirmGateMap, reservationId: string): boolean {
  return !!gate[reservationId];
}

/** Set the gate to blocked for a reservation (after an uncertain outcome). */
export function blockGate(gate: ConfirmGateMap, reservationId: string): ConfirmGateMap {
  return { ...gate, [reservationId]: true };
}

/** Clear the gate for a reservation (after success or a confirmable reload). */
export function clearGate(gate: ConfirmGateMap, reservationId: string): ConfirmGateMap {
  if (!gate[reservationId]) return gate;
  const next = { ...gate };
  delete next[reservationId];
  return next;
}

/**
 * Apply a reload result to the gate, returning the updated gate and the
 * assessment. On a successful reload:
 *  - confirmable → clear the gate (fresh timestamp available for a new attempt).
 *  - already_confirmed / inapplicable → keep the gate blocked (no new mutation).
 * On a failed reload, the gate stays blocked.
 */
export function applyReloadToGate(
  gate: ConfirmGateMap,
  reload: ConfirmReloadResult,
): { gate: ConfirmGateMap; assessment: ReturnType<typeof assessReloadedReservation> | null } {
  if (!reload.success) {
    return { gate, assessment: null };
  }
  const reservation = reload.reservation;
  const assessment = assessReloadedReservation(reservation);
  if (assessment.kind === "confirmable") {
    return { gate: clearGate(gate, reservation.id), assessment };
  }
  return { gate: blockGate(gate, reservation.id), assessment };
}
