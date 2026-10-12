/**
 * Approval Reservation lifecycle controller.
 *
 * Pure framework-agnostic state machine for the approval lifecycle: the
 * parent-owned uncertainty gate (keyed by reservation ID) and the
 * reload-assessment logic. The ApprovalReservationPanel component uses this
 * controller, so tests against it exercise the REAL production logic rather
 * than a copied model.
 */
import type { ReservationDetailDTO } from "@/lib/reservation/types";
import { assessReloadedReservation } from "./approval-reservation-helpers";
import type { ApprovalReloadResult } from "./approval-reservation-helpers";

export type ApprovalGateMap = Record<string, boolean>;

/** Create a fresh empty gate. */
export function createApprovalGate(): ApprovalGateMap {
  return {};
}

/** True if the gate currently blocks another attempt for this reservation. */
export function isGateBlocked(gate: ApprovalGateMap, reservationId: string): boolean {
  return !!gate[reservationId];
}

/** Set the gate to blocked for a reservation (after an uncertain outcome). */
export function blockGate(gate: ApprovalGateMap, reservationId: string): ApprovalGateMap {
  return { ...gate, [reservationId]: true };
}

/** Clear the gate for a reservation (after success or an approvable reload). */
export function clearGate(gate: ApprovalGateMap, reservationId: string): ApprovalGateMap {
  if (!gate[reservationId]) return gate;
  const next = { ...gate };
  delete next[reservationId];
  return next;
}

/**
 * Apply a reload result to the gate, returning the updated gate and the
 * assessment. On a successful reload:
 *  - approvable → clear the gate (fresh timestamp available for a new attempt).
 *  - already_approved / inapplicable → keep the gate blocked (no new mutation).
 * On a failed reload, the gate stays blocked.
 */
export function applyReloadToGate(
  gate: ApprovalGateMap,
  reload: ApprovalReloadResult,
): {
  gate: ApprovalGateMap;
  assessment: ReturnType<typeof assessReloadedReservation> | null;
} {
  if (!reload.success) {
    return { gate, assessment: null };
  }
  const reservation = reload.reservation;
  const assessment = assessReloadedReservation(reservation);
  if (assessment.kind === "approvable") {
    return { gate: clearGate(gate, reservation.id), assessment };
  }
  return { gate: blockGate(gate, reservation.id), assessment };
}
