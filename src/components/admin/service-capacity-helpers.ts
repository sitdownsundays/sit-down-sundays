/**
 * Service capacity panel — pure helpers.
 *
 * Client-safe. No server imports. The panel loads capacity options from the
 * listServiceCapacityOptions endpoint and saves through updateSundayService.
 * These helpers handle sentinel ↔ null conversion, saved-value initialization,
 * change detection, and save-payload construction so they can be tested without
 * rendering.
 */
import type { SundayServiceDTO } from "@/lib/sundays/types";
import type { ServiceCapacityOption } from "@/lib/sundays/service-capacity-options";

/** Nonempty sentinel for the default/null capacity mode. */
export const DEFAULT_SENTINEL = "__default__";

/**
 * Convert a capacityResourceId (string | null) to a select value.
 * null → DEFAULT_SENTINEL; a UUID → itself.
 */
export function capacityValueToSelection(value: string | null): string {
  return value === null ? DEFAULT_SENTINEL : value;
}

/**
 * Convert a select value back to a capacityResourceId.
 * DEFAULT_SENTINEL → null; any other string → that string.
 */
export function selectionToCapacityValue(selection: string): string | null {
  return selection === DEFAULT_SENTINEL ? null : selection;
}

/**
 * Initialize the select value from the saved capacityResourceId and loaded
 * options.
 *
 * - null → DEFAULT_SENTINEL (the default mapped resource).
 * - A UUID matching a whole-parent option → that option's value.
 * - A UUID that does NOT match any offered option → null (no selection).
 *   The manager must explicitly choose an offered option before saving.
 *   Never silently replace a saved UUID with the default.
 */
export function initializeSelection(
  savedCapacityResourceId: string | null,
  options: ServiceCapacityOption[],
): string | null {
  if (savedCapacityResourceId === null) return DEFAULT_SENTINEL;
  const offered = options.some((opt) => opt.capacityResourceId === savedCapacityResourceId);
  if (offered) return savedCapacityResourceId;
  // Saved UUID is not in the returned choices — do not silently convert.
  return null;
}

/**
 * Determine whether the current selection represents an actual change from
 * the saved value. A null selection (no choice) is never an actionable change.
 */
export function hasActualChange(
  savedCapacityResourceId: string | null,
  selection: string | null,
): boolean {
  if (selection === null) return false;
  const targetValue = selectionToCapacityValue(selection);
  return targetValue !== savedCapacityResourceId;
}

/**
 * Build the save payload for updateSundayService — ONLY capacity mode fields.
 * Uses the original expectedUpdatedAt verbatim. Does not forward or modify
 * spaceId, date, status, booking limits, seating times, or other fields.
 *
 * Returns null when the selection is invalid (null), no options are loaded,
 * or the selected value is not in the offered options.
 */
export function buildCapacitySavePayload(
  baseService: SundayServiceDTO,
  selection: string | null,
  options: ServiceCapacityOption[],
): {
  id: string;
  expectedUpdatedAt: string;
  capacityResourceId: string | null;
} | null {
  if (selection === null) return null;
  if (options.length === 0) return null;
  const capacityResourceId = selectionToCapacityValue(selection);
  // Validate that the selected value (null or UUID) is an offered option.
  const valid = options.some((opt) => opt.capacityResourceId === capacityResourceId);
  if (!valid) return null;
  return {
    id: baseService.id,
    expectedUpdatedAt: baseService.updatedAt,
    capacityResourceId,
  };
}
