/**
 * SERVER-ONLY — shared reservation-request eligibility helper.
 *
 * Used by BOTH the public availability builder and the reservation submission
 * path so the filtering rules are identical. A NEW request must satisfy every
 * rule below; availability surfaces the requestable options, submission
 * re-validates the chosen option against live configuration.
 *
 * ELIGIBILITY RULES (request-based — NOT a guaranteed booking, NOT live
 * inventory enforcement):
 *  - Existing, active GENERAL-DINING venue space (spaceType === "general_dining").
 *    Request-only and not-bookable spaces (Mayoral Rooms, suites) are excluded
 *    from public self-booking.
 *  - Existing, active Sunday service whose status is intentionally "open" for
 *    requests. "scheduled" alone does NOT open requests.
 *  - Existing, active seating time belonging to that service.
 *  - A POSITIVE online booking limit at the SPACE, service, AND seating level.
 *    NULL or zero limits mean NOT FOR SALE — never unlimited availability.
 *  - A valid configured restaurant timezone (required for the seating instant).
 *  - The seating start instant (computed in the restaurant timezone) must be
 *    strictly in the future.
 *
 * This does NOT enforce real-time capacity against existing reservations
 * (that is a future phase). Overlapping seating starts are NOT independent
 * room capacity pools. The configured ceiling is a request limit, not
 * remaining seats.
 */
import type { SundayServiceDTO, SeatingTimeDTO, PaymentPolicyDTO } from "@/lib/sundays/types";
import type { VenueSpaceDTO } from "@/lib/spaces/types";
import type { PublicAvailabilityOption } from "@/lib/reservation/types";
import { isValidTimezone, seatingStartISO } from "@/lib/reservation/timezone";

/** Only the "open" status is intentionally open for public requests. */
const OPEN_STATUS = "open";

/** A positive limit (> 0). Null, zero, or negative means not for sale. */
function isPositiveLimit(limit: number | null | undefined): limit is number {
  return typeof limit === "number" && limit > 0;
}

/**
 * Result of evaluating a single (service, seating) pair against the
 * eligibility rules. `ceiling` is the smallest of the three configured limits
 * — a request ceiling, NOT remaining capacity.
 */
export interface EligibilityResult {
  eligible: boolean;
  /** Smallest of the space/service/seating configured limits, when eligible. */
  ceiling?: number;
  /** The UTC seating-start instant, when eligible. */
  seatingInstant?: string;
  /** Safe, actionable reason when ineligible (never exposes internal data). */
  reason?: string;
}

/**
 * Evaluate a single service + seating pair against the full eligibility rules.
 * Pure: takes already-loaded config, returns a decision. Both availability and
 * submission call this so the rules cannot drift.
 */
export function evaluateEligibility(
  service: SundayServiceDTO | null,
  seating: SeatingTimeDTO | null,
  space: VenueSpaceDTO | null,
  policy: PaymentPolicyDTO,
  now: Date = new Date(),
): EligibilityResult {
  if (!service)
    return { eligible: false, reason: "Selected Sunday service is no longer available." };
  if (!seating) return { eligible: false, reason: "Selected seating time is no longer available." };
  if (!space) return { eligible: false, reason: "Selected venue space is no longer available." };

  // Space: active general dining only.
  if (!space.isActive)
    return { eligible: false, reason: "Selected venue space is no longer available." };
  if (space.spaceType !== "general_dining") {
    return { eligible: false, reason: "This space is not available for online requests." };
  }

  // Service: active and intentionally "open".
  if (!service.isActive)
    return { eligible: false, reason: "Selected Sunday service is no longer available." };
  if (service.status !== OPEN_STATUS) {
    return { eligible: false, reason: "Selected Sunday service is not yet open for requests." };
  }
  if (service.spaceId !== space.id) {
    return { eligible: false, reason: "Selected Sunday service is no longer available." };
  }

  // Seating: active and belongs to the selected service.
  if (!seating.isActive)
    return { eligible: false, reason: "Selected seating time is no longer available." };
  if (seating.sundayServiceId !== service.id) {
    return { eligible: false, reason: "Selected seating time is no longer available." };
  }

  // Positive configured limits at all three levels.
  if (!isPositiveLimit(space.onlineBookingLimit)) {
    return {
      eligible: false,
      reason: "This space is not currently available for online requests.",
    };
  }
  if (!isPositiveLimit(service.onlineBookingLimit)) {
    return {
      eligible: false,
      reason: "This service is not currently available for online requests.",
    };
  }
  if (!isPositiveLimit(seating.onlineBookingLimit)) {
    return {
      eligible: false,
      reason: "This seating time is not currently available for online requests.",
    };
  }

  // Valid configured restaurant timezone.
  const tz = policy.restaurantTimezone;
  if (!tz || !isValidTimezone(tz)) {
    return { eligible: false, reason: "Scheduling is not yet configured for this service." };
  }

  // Seating instant in the restaurant timezone, strictly in the future.
  const seatingInstant = seatingStartISO(service.date, seating.startTime, tz);
  if (!seatingInstant) {
    return { eligible: false, reason: "Selected seating time is no longer available." };
  }
  if (new Date(seatingInstant).getTime() <= now.getTime()) {
    return { eligible: false, reason: "Selected seating time is no longer available." };
  }

  return {
    eligible: true,
    ceiling: Math.min(
      space.onlineBookingLimit,
      service.onlineBookingLimit,
      seating.onlineBookingLimit,
    ),
    seatingInstant,
  };
}

/**
 * Validate party composition for a NEW request:
 *  - adults + seniors + children === partySize
 *  - guest allocation count === partySize
 *  - guest indices are unique and in range [0, partySize)
 *  - actual guest categories count exactly matches adults/seniors/children
 *
 * Returns a safe, actionable error string when invalid, or null when valid.
 * This mirrors the schema-level superRefine checks but is callable from the
 * server submission path against already-parsed data, and additionally
 * verifies the guest-category counts (a schema-only check cannot cross-check
 * the declared adult/senior/child totals against the per-guest categories).
 */
export function validatePartyComposition(input: {
  partySize: number;
  adults: number;
  seniors: number;
  children: number;
  guests: Array<{ guestIndex: number; category: string }>;
}): string | null {
  const { partySize, adults, seniors, children, guests } = input;

  if (adults + seniors + children !== partySize) {
    return "Adults, seniors, and children must add up to the total party size.";
  }
  if (guests.length !== partySize) {
    return "Each guest must have a meal allocation.";
  }
  const indices = guests.map((g) => g.guestIndex);
  if (new Set(indices).size !== indices.length || indices.some((i) => i < 0 || i >= partySize)) {
    return "Guest allocations must be uniquely indexed.";
  }

  // Actual guest categories must match the declared counts exactly.
  const counts = { adult: 0, senior: 0, child: 0 };
  for (const g of guests) {
    if (g.category !== "adult" && g.category !== "senior" && g.category !== "child") {
      return "Each guest must have a valid category.";
    }
    counts[g.category as "adult" | "senior" | "child"] += 1;
  }
  if (counts.adult !== adults || counts.senior !== seniors || counts.child !== children) {
    return "Guest categories must match the number of adults, seniors, and children.";
  }

  return null;
}

/**
 * Check that a party size fits within a configured request ceiling. The
 * ceiling is the smallest of the three configured limits — NOT remaining
 * capacity. Returns a safe error string when the party is too large.
 */
export function validatePartySizeAgainstCeiling(partySize: number, ceiling: number): string | null {
  if (partySize > ceiling) {
    return "This party size exceeds the configured request limit for this seating.";
  }
  return null;
}

/**
 * Build the sanitized public availability list from loaded config, using the
 * shared eligibility rules. Returns options that are configured and
 * requestable. The `configuredRequestCeiling` is the smallest of the three
 * configured limits — a request ceiling, NOT measured live inventory.
 */
export function buildEligibleOptions(
  services: SundayServiceDTO[],
  seatingsByService: Map<string, SeatingTimeDTO[]>,
  spaces: VenueSpaceDTO[],
  policy: PaymentPolicyDTO,
  now: Date = new Date(),
): PublicAvailabilityOption[] {
  const spaceById = new Map(spaces.map((s) => [s.id, s]));
  const options: PublicAvailabilityOption[] = [];

  for (const svc of services) {
    const space = spaceById.get(svc.spaceId) ?? null;
    const seatings = seatingsByService.get(svc.id) ?? [];
    for (const seat of seatings) {
      const result = evaluateEligibility(svc, seat, space, policy, now);
      if (!result.eligible || result.ceiling === undefined) continue;
      options.push({
        sundayService: { id: svc.id, date: svc.date, label: svc.label },
        seatingTime: {
          id: seat.id,
          label: seat.label,
          startTime: seat.startTime,
          endTime: seat.endTime,
        },
        spaceName: space!.name,
        // This is a configured REQUEST CEILING, not measured live inventory.
        configuredRequestCeiling: result.ceiling,
        // Restaurant wall-clock timezone — never the browser/server host tz.
        restaurantTimezone: policy.restaurantTimezone ?? "",
      });
    }
  }

  return options;
}

/**
 * Validate a NEW reservation request against the full eligibility rules plus
 * party-size limits. Convenience wrapper used by the submission path so it
 * shares the exact same rules as public availability. Returns `{ ok: true,
 * seatingInstant }` when the request may proceed, or `{ ok: false, error }`
 * with a safe, actionable message when it must be rejected with zero writes.
 *
 * This is request eligibility, NOT live inventory enforcement.
 */
export function validateNewRequestEligibility(
  ctx: {
    service: SundayServiceDTO | null;
    seating: SeatingTimeDTO | null;
    space: VenueSpaceDTO | null;
    policy: PaymentPolicyDTO;
  },
  partySize: number,
  now: Date = new Date(),
): { ok: true; seatingInstant: string | null } | { ok: false; error: string } {
  const result = evaluateEligibility(ctx.service, ctx.seating, ctx.space, ctx.policy, now);
  if (!result.eligible || result.ceiling === undefined) {
    return { ok: false, error: result.reason ?? "This reservation is no longer available." };
  }
  const sizeError = validatePartySizeAgainstCeiling(partySize, result.ceiling);
  if (sizeError) {
    return { ok: false, error: sizeError };
  }
  return { ok: true, seatingInstant: result.seatingInstant ?? null };
}
