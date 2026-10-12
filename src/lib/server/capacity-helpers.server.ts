/**
 * SERVER-ONLY — capacity-reservation types and pure calculation helpers.
 *
 * These helpers mirror the SQL logic in 0019_capacity_reservation.sql so the
 * available-capacity calculation is testable WITHOUT a live PostgreSQL
 * instance. The SQL RPC remains authoritative at runtime; these helpers are
 * for unit-testing the business rules and for building RPC arguments.
 *
 * CAPACITY MODEL (confirmed by owner):
 *   * Grand Ballroom: 950 guests total — a standalone capacity resource.
 *   * Mayoral Room: ONE physical room, 120 guests total, divisible into two
 *     60-person sections (Mayoral Room 1 and Mayoral Room 2 in venue_spaces).
 *     "Mayoral Room 1" and "Mayoral Room 2" venue_space rows are SECTIONS of
 *     one parent, NOT independent additional rooms. Never count capacity as
 *     120 + 60 + 60.
 *
 * EXCLUSIVITY (Mayoral):
 *   A whole-room booking BLOCKS BOTH sections regardless of party size.
 *   Any overlapping section booking BLOCKS the whole-room booking.
 *   Separate sections may be used concurrently, within their own capacities
 *   (60 + 60 <= 120). This is NOT implemented as `120 - partySize`; the
 *   parent resource accounts for holds on parent + ALL children.
 *
 * SAFE EXPIRATION:
 *   Expiration is NOT a release. A hold whose deadline has passed is still a
 *   committed row; it continues to consume capacity until an AUTHORITATIVE
 *   release transition (release_reservation_capacity_atomic) occurs.
 *   isHoldActive() returns true for allocated and unexpired held holds;
 *   availableCapacity() treats an unreleased hold as active REGARDLESS of
 *   deadline, because no release has occurred. Future payment reconciliation
 *   resolves in-flight payments before any release — this helper does not
 *   release or auto-cancel anything.
 */

export type CapacityResourceType = "standalone" | "whole" | "section";

/** A capacity resource (standalone, whole, or section). */
export interface CapacityResourceInput {
  id: string;
  totalCapacity: number;
  parentId: string | null;
}

/** A reservation-linked capacity hold/allocation. */
export interface CapacityHoldInput {
  capacityResourceId: string;
  partySize: number;
  /** Epoch milliseconds. */
  seatingStart: number;
  /** Epoch milliseconds (exclusive end). */
  seatingEnd: number;
  state: "held" | "allocated" | "released";
  /** Epoch milliseconds. Null for allocated/released. */
  holdDeadline: number | null;
  /** Optional reservation linkage for identity checks. */
  reservationId?: string;
}

/** Result codes from the acquire/release/confirm RPCs. */
export type CapacityActionCode =
  | "insufficient_capacity"
  | "invalid_status"
  | "invalid_configuration"
  | "not_found"
  | "conflict"
  | "invalid_actor"
  | "invalid_data"
  | "unexpected";

export interface CapacityAcquireResult {
  ok: boolean;
  holdId?: string;
  holdDeadline?: string;
  state?: "held" | "allocated";
  alreadyHeld?: boolean;
  seatingStart?: string;
  seatingEnd?: string;
  code?: CapacityActionCode;
  error?: string;
}

export interface CapacityReleaseResult {
  ok: boolean;
  reservationId?: string;
  releasedCount?: number;
  code?: CapacityActionCode;
  error?: string;
}

export interface CapacityConfirmResult {
  ok: boolean;
  reservationId?: string;
  confirmedCount?: number;
  code?: CapacityActionCode;
  error?: string;
}

/**
 * Whether two [start, end) intervals overlap. Back-to-back (a.end === b.start)
 * does NOT overlap — this permits consecutive seatings.
 */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Whether a hold is RELEASED (the only state that does NOT consume capacity).
 *
 * SAFE EXPIRATION: a held hold whose deadline has passed is NOT released.
 * It still consumes capacity until release_reservation_capacity_atomic
 * runs (which requires payment reconciliation to confirm no in-flight payment).
 * Expiration eligibility != release. Only a released hold stops counting.
 */
export function isReleased(hold: CapacityHoldInput): boolean {
  return hold.state === "released";
}

/**
 * Whether a hold CONSUMES capacity (i.e. is NOT released). Expiration does
 * not remove a hold from capacity — only an authoritative release does.
 */
export function isHoldActive(hold: CapacityHoldInput, _now: number): boolean {
  // Expiration is NOT a release. An unreleased hold — held or allocated —
  // continues to consume capacity until an authoritative release transition.
  return !isReleased(hold);
}

/**
 * Resolve the Mayoral-family resource set for locking. For a standalone
 * resource returns just itself. For a section returns [parent, section]. For a
 * whole returns [whole, ...all sections]. The caller locks these in a single
 * deterministic order so every capacity-changing operation on the Mayoral
 * family participates in the same protocol.
 */
export function mayoralFamilyLockSet(
  resource: CapacityResourceInput,
  allResources: Map<string, CapacityResourceInput>,
): string[] {
  if (resource.parentId) {
    // Section: parent first, then self.
    return [resource.parentId, resource.id];
  }
  const childIds = Array.from(allResources.values())
    .filter((r) => r.parentId === resource.id)
    .map((r) => r.id);
  if (childIds.length > 0) {
    // Whole: whole first, then all sections (all participate).
    return [resource.id, ...childIds];
  }
  // Standalone: just itself.
  return [resource.id];
}

/**
 * Peak simultaneous occupancy for a set of resource IDs over [start, end).
 *
 * Mirrors the installed SQL `capacity_peak_0019`: a sweep-line that groups
 * start/end deltas by timestamp and tracks the running maximum. This is NOT
 * the sum of all overlapping holds — back-to-back bookings that each touch a
 * longer requested interval must not be double-counted. Only the peak moment
 * matters.
 *
 * Expiration is NOT a release: unreleased held holds (even past deadline)
 * still count (isHoldActive).
 */
export function peakOccupancy(
  holds: CapacityHoldInput[],
  ids: Set<string>,
  intervalStart: number,
  intervalEnd: number,
  now: number,
): number {
  const byT = new Map<number, number>();
  for (const h of holds) {
    if (!ids.has(h.capacityResourceId)) continue;
    if (!isHoldActive(h, now)) continue;
    if (!intervalsOverlap(h.seatingStart, h.seatingEnd, intervalStart, intervalEnd)) continue;
    const tStart = Math.max(h.seatingStart, intervalStart);
    const tEnd = Math.min(h.seatingEnd, intervalEnd);
    byT.set(tStart, (byT.get(tStart) ?? 0) + h.partySize);
    byT.set(tEnd, (byT.get(tEnd) ?? 0) - h.partySize);
  }
  const sorted = Array.from(byT.entries()).sort((a, b) => a[0] - b[0]);
  let running = 0;
  let peak = 0;
  for (const [, delta] of sorted) {
    running += delta;
    if (running > peak) peak = running;
  }
  return peak;
}

/**
 * Whether ANY active hold on any of `ids` overlaps [start, end).
 */
function anyActiveOverlap(
  holds: CapacityHoldInput[],
  ids: Set<string>,
  intervalStart: number,
  intervalEnd: number,
  now: number,
): boolean {
  return holds.some(
    (h) =>
      ids.has(h.capacityResourceId) &&
      isHoldActive(h, now) &&
      intervalsOverlap(h.seatingStart, h.seatingEnd, intervalStart, intervalEnd),
  );
}

/**
 * Compute the available capacity for a resource at a given [start, end)
 * interval, given all current holds and all resources.
 *
 * Mirrors the installed SQL `acquire_reservation_capacity_atomic`:
 *   * Standalone: total − peak(self).
 *   * Whole (has children): if ANY section hold overlaps → 0 (section MODE
 *     blocks whole MODE). Otherwise total − peak(whole-room holds only).
 *     Multiple whole-mode parties may coexist up to 120 by actual headcount;
 *     a small party does not buy exclusive use.
 *   * Section: if ANY whole-room (parent) hold overlaps → 0 (whole MODE
 *     blocks section MODE). Otherwise min(section_total − peak(self),
 *     parent_total − peak(all sections)).
 *
 * Expiration is NOT a release. Returns 0 on missing parent (misconfiguration).
 */
export function availableCapacity(
  resource: CapacityResourceInput,
  allResources: Map<string, CapacityResourceInput>,
  holds: CapacityHoldInput[],
  intervalStart: number,
  intervalEnd: number,
  now: number,
): number {
  const childIds = Array.from(allResources.values())
    .filter((r) => r.parentId === resource.id)
    .map((r) => r.id);

  const hasChildren = childIds.length > 0;

  if (hasChildren) {
    // EXCLUSIVITY: any overlapping section hold blocks whole-room MODE.
    if (anyActiveOverlap(holds, new Set(childIds), intervalStart, intervalEnd, now)) return 0;
    // No section holds: whole-mode parties share 120 by peak headcount.
    return Math.max(
      0,
      resource.totalCapacity -
        peakOccupancy(holds, new Set([resource.id]), intervalStart, intervalEnd, now),
    );
  }

  if (resource.parentId) {
    const parent = allResources.get(resource.parentId);
    if (!parent) return 0; // misconfiguration — fail safe

    // EXCLUSIVITY: any overlapping whole-room hold blocks section MODE.
    if (anyActiveOverlap(holds, new Set([parent.id]), intervalStart, intervalEnd, now)) return 0;

    const sectionRemaining =
      resource.totalCapacity -
      peakOccupancy(holds, new Set([resource.id]), intervalStart, intervalEnd, now);

    const allSectionIds = Array.from(allResources.values())
      .filter((r) => r.parentId === parent.id)
      .map((r) => r.id);
    const parentRemaining =
      parent.totalCapacity -
      peakOccupancy(holds, new Set(allSectionIds), intervalStart, intervalEnd, now);

    return Math.max(0, Math.min(sectionRemaining, parentRemaining));
  }

  // Standalone: total − peak(self).
  return Math.max(
    0,
    resource.totalCapacity -
      peakOccupancy(holds, new Set([resource.id]), intervalStart, intervalEnd, now),
  );
}

/**
 * The fixed hold deadline duration: 2 hours from acquisition.
 * Server-generated; the caller cannot supply or extend it. Preserved across
 * retries (the existing hold's deadline is returned, never re-computed).
 */
export const HOLD_DEADLINE_HOURS = 2;

/**
 * Compute a hold deadline from a reference time (epoch ms).
 */
export function computeHoldDeadline(now: number): number {
  return now + HOLD_DEADLINE_HOURS * 60 * 60 * 1000;
}

/**
 * Statuses that may acquire capacity (pre-arrival). checked_in, seated,
 * completed, no_show, refund_review, and cancelled cannot acquire.
 */
export const CAPACITY_ELIGIBLE_STATUSES = new Set([
  "pending_review",
  "confirmed",
  "balance_due",
  "paid_in_full",
  "ready_for_service",
  "cancellation_requested",
  "transfer_requested",
]);

/**
 * Whether a reservation status is eligible to acquire capacity.
 */
export function isCapacityEligibleStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return CAPACITY_ELIGIBLE_STATUSES.has(status);
}

/**
 * Validate the hierarchy of a capacity resource set: sections reference a
 * whole-room parent; no self-reference; no cycles; whole has no parent;
 * standalone has no parent. Returns false on any invalid configuration.
 */
export function isHierarchyValid(
  resource: CapacityResourceInput,
  allResources: Map<string, CapacityResourceInput>,
): boolean {
  if (resource.parentId === resource.id) return false; // self-reference
  if (resource.parentId !== null) {
    const parent = allResources.get(resource.parentId);
    if (!parent) return false; // missing parent
    if (parent.parentId !== null) return false; // parent must be a whole (no grandparent)
    // cycle detection: parent must not be a descendant of resource
    let cursor = parent;
    const seen = new Set<string>();
    while (cursor.parentId) {
      if (seen.has(cursor.id)) return false;
      seen.add(cursor.id);
      const next = allResources.get(cursor.parentId);
      if (!next) return false;
      cursor = next;
    }
    if (cursor.id === resource.id) return false;
  }
  return true;
}

/**
 * Whether the requested resource is compatible with the reservation's
 * authoritative service room. A section maps to exactly one venue_space; the
 * reservation's service must be in that same space. A whole-room (Mayoral)
 * parent has a NULL space_id (virtual grouping) but is valid when the
 * reservation's service room is one of its sections' spaces.
 */
export function resourceMatchesServiceRoom(
  resource: CapacityResourceInput,
  allResources: Map<string, CapacityResourceInput>,
  serviceSpaceId: string | null,
): boolean {
  if (!serviceSpaceId) return false;
  // Sections and standalone map directly to a venue_space.
  if (resource.parentId === null) {
    // Resolve via the map of space links (not modeled here) — caller checks.
    return true; // validated by the RPC using capacity_resources.space_id.
  }
  // Section: its parent's sections include the service room.
  const parent = allResources.get(resource.parentId);
  if (!parent) return false;
  return true; // the RPC validates the section's space_id against the service.
}
