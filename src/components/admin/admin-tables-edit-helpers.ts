/**
 * Admin Tables — edit/disable helpers.
 *
 * Pure helpers for building the edit form from a loaded table, deriving the
 * optimistic-concurrency update payload, and detecting a conflict result.
 * Tested directly; consumed by the edit-dialog component.
 */
import type { DiningTableDTO, DiningTableOperationResult } from "@/lib/sundays/types";

export interface EditTableForm {
  label: string;
  seats: number;
  zone: string;
  isActive: boolean;
}

/**
 * Build the editable form fields from a loaded table record. The room is
 * read-only (no reassignment in this slice), so it is not part of the form.
 */
export function editFormFromTable(table: DiningTableDTO): EditTableForm {
  return {
    label: table.label,
    seats: table.seats,
    zone: table.zone,
    isActive: table.isActive,
  };
}

/**
 * Build the update payload submitted to updateDiningTable. The table ID and
 * the ORIGINAL updatedAt are preserved as expectedUpdatedAt — never replaced
 * silently while editing. Only changed fields are included so the server
 * schema's optional fields apply cleanly.
 */
export function buildUpdatePayload(
  table: DiningTableDTO,
  form: EditTableForm,
): {
  id: string;
  expectedUpdatedAt: string;
  label?: string;
  seats?: number;
  zone?: string;
  isActive?: boolean;
} {
  const payload: {
    id: string;
    expectedUpdatedAt: string;
    label?: string;
    seats?: number;
    zone?: string;
    isActive?: boolean;
  } = {
    id: table.id,
    expectedUpdatedAt: table.updatedAt,
  };

  const trimmedLabel = form.label.trim();
  const trimmedZone = form.zone.trim();

  if (trimmedLabel !== table.label) payload.label = trimmedLabel;
  if (form.seats !== table.seats) payload.seats = form.seats;
  if (trimmedZone !== table.zone) payload.zone = trimmedZone;
  if (form.isActive !== table.isActive) payload.isActive = form.isActive;

  return payload;
}

/** Whether the form differs from the loaded table at all. */
export function formHasChanges(table: DiningTableDTO, form: EditTableForm): boolean {
  const payload = buildUpdatePayload(table, form);
  return Object.keys(payload).some((k) => k !== "id" && k !== "expectedUpdatedAt");
}

/** Validate the edit form, returning a safe user-facing message or null. */
export function validateEditForm(form: EditTableForm): string | null {
  if (!form.label.trim()) return "Label is required.";
  if (form.label.trim().length > 120) return "Label must be 120 characters or fewer.";
  if (form.zone.trim().length > 120) return "Zone must be 120 characters or fewer.";
  return null;
}

/** A conflict result means another user changed the table before this save. */
export function isConflict(result: DiningTableOperationResult): boolean {
  return result.conflict === true;
}
