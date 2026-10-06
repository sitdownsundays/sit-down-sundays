/**
 * Venue Spaces — centralized constants & validation rules.
 *
 * Framework-independent. No server-only imports. No mock data.
 * These mirror the database CHECK constraints in 0008_venue_spaces.sql.
 */
import { normalizeSlug, isValidSlug } from "@/lib/menu/constants";

export const SPACE_TYPES = ["general_dining", "request_only", "not_bookable"] as const;
export type SpaceType = (typeof SPACE_TYPES)[number];

export const SPACE_TYPE_LABELS: Record<SpaceType, string> = {
  general_dining: "General dining",
  request_only: "Request only",
  not_bookable: "Not bookable",
};

/**
 * Plain-language explanation of each space type, shown to staff so they
 * understand that setting a booking limit does not by itself open bookings.
 */
export const SPACE_TYPE_DESCRIPTIONS: Record<SpaceType, string> = {
  general_dining:
    "Open general dining. Bookings stay disabled until an online booking limit is set and Sunday services and seating times are configured.",
  request_only:
    "Staff-approval-only for large gatherings. No online self-booking, no shared seating, no exclusivity promise, no capacity pooling.",
  not_bookable: "Not exposed for booking.",
};

/** Length limits aligned with the database varchar constraints. */
export const VENUE_SPACE_LIMITS = {
  name: 120,
  slug: 120,
  description: 2000,
  spaceType: 40,
} as const;

/** Re-export the canonical slug helpers so spaces stay in sync with the app format. */
export { normalizeSlug, isValidSlug };
