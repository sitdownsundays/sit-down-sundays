/**
 * Admin Reservations — Assign Tables dialog helpers.
 *
 * Pure functions for deriving the initial selection from current assignments,
 * validating capacity/inactive-table guards, and building the save payload.
 * Tested directly; consumed by the AssignTablesDialog component.
 */
import type {
  ReservationTableContextDTO,
  ReservationTableAssignmentDTO,
  ReservationRoomTableDTO,
} from "@/lib/sundays/types";

export interface AssignTablesSelection {
  /** Selected table IDs (independent of the current assignments). */
  tableIds: string[];
}

/**
 * Build the initial selection from the loaded context's current assignments.
 * Preselects any tables currently assigned to the reservation, regardless of
 * their active status (inactive assigned tables remain visible/selectable to
 * allow release).
 */
export function initialSelectionFromContext(
  context: ReservationTableContextDTO,
): AssignTablesSelection {
  return {
    tableIds: context.currentAssignments.map((a) => a.diningTableId),
  };
}

/** Total seats across the selected room tables. */
export function selectedSeats(
  tables: ReservationRoomTableDTO[],
  selection: AssignTablesSelection,
): number {
  const set = new Set(selection.tableIds);
  return tables.reduce((sum, t) => (set.has(t.id) ? sum + t.seats : sum), 0);
}

/** The set of currently-assigned table IDs (for change detection). */
export function currentAssignmentIds(context: ReservationTableContextDTO): Set<string> {
  return new Set(context.currentAssignments.map((a) => a.diningTableId));
}

/**
 * Whether the current selection differs from the reservation's saved
 * assignments. Used to gate the Save button (no-op save is blocked).
 */
export function selectionHasChanges(
  context: ReservationTableContextDTO,
  selection: AssignTablesSelection,
): boolean {
  const current = currentAssignmentIds(context);
  if (selection.tableIds.length !== current.size) return true;
  return selection.tableIds.some((id) => !current.has(id));
}

/**
 * Whether the selection contains any inactive table that is NOT already a
 * current assignment. Inactive tables can be deselected but not newly
 * selected — the room inventory may have changed since the assignment was
 * made.
 */
export function hasInvalidNewInactiveSelection(
  context: ReservationTableContextDTO,
  selection: AssignTablesSelection,
): boolean {
  const currentIds = currentAssignmentIds(context);
  return selection.tableIds.some(
    (id) => !currentIds.has(id) && context.roomTables.some((t) => t.id === id && !t.isActive),
  );
}

/**
 * Guard message for a nonempty selection that would block save. Returns null
 * when the selection is valid (or empty — empty is a release, not a save).
 *
 * Guards:
 *  1. A nonempty selection containing inactive tables that were not already
 *     assigned → "cannot be newly selected."
 *  2. A nonempty selection whose combined seats are below party size →
 *     "insufficient seats."
 */
export function guardMessage(
  context: ReservationTableContextDTO,
  selection: AssignTablesSelection,
): string | null {
  if (selection.tableIds.length === 0) return null;
  if (hasInvalidNewInactiveSelection(context, selection)) {
    return "Inactive tables cannot be newly selected. They can only be deselected from an existing assignment.";
  }
  if (selectedSeats(context.roomTables, selection) < context.partySize) {
    return `The selected tables (${selectedSeats(
      context.roomTables,
      selection,
    )} seats) cannot accommodate this party (${context.partySize} guests).`;
  }
  return null;
}

/**
 * Build the save payload. The reservation ID and the context's ORIGINAL
 * updatedAt are preserved as expectedUpdatedAt — never replaced silently
 * while editing.
 */
export function buildSavePayload(
  context: ReservationTableContextDTO,
  selection: AssignTablesSelection,
): { reservationId: string; tableIds: string[]; expectedUpdatedAt: string } {
  return {
    reservationId: context.reservationId,
    tableIds: [...selection.tableIds],
    expectedUpdatedAt: context.updatedAt,
  };
}

/**
 * Build the release payload (empty tableIds). Distinct from an accidentally
 * empty selection — the dialog requires explicit confirmation before
 * sending this.
 */
export function buildReleasePayload(context: ReservationTableContextDTO): {
  reservationId: string;
  tableIds: string[];
  expectedUpdatedAt: string;
} {
  return {
    reservationId: context.reservationId,
    tableIds: [],
    expectedUpdatedAt: context.updatedAt,
  };
}
