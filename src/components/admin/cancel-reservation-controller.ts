/**
 * Cancel Reservation lifecycle controller.
 *
 * Pure framework-agnostic state machine for the cancellation recovery
 * lifecycle: the parent-owned uncertainty gate (keyed by reservation ID) and
 * the reason map (keyed by reservation ID so an entered reason survives
 * dialog close/reopen). The CancelReservationPanel component uses this
 * controller, so tests against it exercise the REAL production logic rather
 * than a copied model.
 *
 * Lives in a separate module so it is testable without a DOM and can be
 * imported by both the panel component and its lifecycle tests.
 */
import type { ReservationDetailDTO } from "@/lib/reservation/types";
import { assessReloadedReservationForCancel } from "./cancel-reservation-helpers";
import type { CancelReloadResult } from "./cancel-reservation-helpers";

export type CancelGateMap = Record<string, boolean>;
export type CancelReasonMap = Record<string, string>;

/** Create a fresh empty gate. */
export function createCancelGate(): CancelGateMap {
  return {};
}

/** Create a fresh empty reason map. */
export function createCancelReasonMap(): CancelReasonMap {
  return {};
}

/** True if the gate currently blocks another attempt for this reservation. */
export function isCancelGateBlocked(gate: CancelGateMap, reservationId: string): boolean {
  return !!gate[reservationId];
}

/** Set the gate to blocked for a reservation (after an uncertain outcome). */
export function blockCancelGate(gate: CancelGateMap, reservationId: string): CancelGateMap {
  return { ...gate, [reservationId]: true };
}

/** Clear the gate for a reservation (after success or a cancellable reload). */
export function clearCancelGate(gate: CancelGateMap, reservationId: string): CancelGateMap {
  if (!gate[reservationId]) return gate;
  const next = { ...gate };
  delete next[reservationId];
  return next;
}

/** Store or update a reason for a reservation. */
export function setReason(
  map: CancelReasonMap,
  reservationId: string,
  reason: string,
): CancelReasonMap {
  return { ...map, [reservationId]: reason };
}

/** Read the stored reason for a reservation, or "" if none. */
export function getReason(map: CancelReasonMap, reservationId: string): string {
  return map[reservationId] ?? "";
}

/** Remove the stored reason for a reservation. */
export function clearReason(map: CancelReasonMap, reservationId: string): CancelReasonMap {
  if (!(reservationId in map)) return map;
  const next = { ...map };
  delete next[reservationId];
  return next;
}

/**
 * Apply a reload result to the gate, returning the updated gate and the
 * assessment. On a successful reload:
 *  - cancellable → clear the gate (fresh timestamp available for a new attempt).
 *  - already_cancelled / non_cancellable → keep the gate blocked (no new mutation).
 * On a failed reload, the gate stays blocked.
 *
 * Note: this helper does NOT validate that the returned reservation ID matches
 * the requested reservation — the panel performs that identity check before
 * calling this, so a wrong-reservation reload never reaches here.
 */
export function applyCancelReloadToGate(
  gate: CancelGateMap,
  reload: CancelReloadResult,
): {
  gate: CancelGateMap;
  assessment: ReturnType<typeof assessReloadedReservationForCancel> | null;
} {
  if (!reload.success) {
    return { gate, assessment: null };
  }
  const reservation = reload.reservation;
  const assessment = assessReloadedReservationForCancel(reservation);
  if (assessment.kind === "cancellable") {
    return { gate: clearCancelGate(gate, reservation.id), assessment };
  }
  return { gate: blockCancelGate(gate, reservation.id), assessment };
}
