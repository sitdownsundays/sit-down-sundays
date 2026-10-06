/**
 * Ordering model — centralized constants & validation rules.
 *
 * Framework-independent. No server-only imports. No mock data.
 * These mirror the database CHECK constraints in 0009_ordering_model.sql.
 */
import { normalizeSlug, isValidSlug } from "@/lib/menu/constants";

/** Guest category within a party (adults, seniors, children). */
export const GUEST_CATEGORIES = ["adult", "senior", "child"] as const;
export type GuestCategory = (typeof GUEST_CATEGORIES)[number];

export const GUEST_CATEGORY_LABELS: Record<GuestCategory, string> = {
  adult: "Adult",
  senior: "Senior",
  child: "Child",
};

/** Which included-selection bucket a menu_item fills within a package. */
export const SELECTION_CATEGORIES = ["meat", "side", "bread", "drink"] as const;
export type SelectionCategory = (typeof SELECTION_CATEGORIES)[number];

export const SELECTION_CATEGORY_LABELS: Record<SelectionCategory, string> = {
  meat: "Meat",
  side: "Side",
  bread: "Bread / Rolls",
  drink: "Drink",
};

/** Child pricing rule — explicitly selected, never invented. */
export const CHILD_RULE_TYPES = ["none", "fixed_package_price", "percentage_discount"] as const;
export type ChildRuleType = (typeof CHILD_RULE_TYPES)[number];

export const CHILD_RULE_TYPE_LABELS: Record<ChildRuleType, string> = {
  none: "Not configured",
  fixed_package_price: "Fixed child package price",
  percentage_discount: "Percentage discount",
};

/** Length limits aligned with the database varchar constraints. */
export const ORDERING_LIMITS = {
  name: 120,
  slug: 120,
  description: 2000,
  servingGuidance: 2000,
} as const;

/** Maximum supported price in cents (shared safety ceiling with Menu CMS). */
export const MAX_PRICE_CENTS = 1_000_000;

/** Roles permitted to manage ordering configuration (server-enforced). */
export const ORDERING_MUTATION_ROLES = ["content_manager", "ops_manager", "administrator"] as const;

/** Roles permitted to use the admin preview tool (server-enforced). */
export const ORDERING_PREVIEW_ROLES = [
  "content_manager",
  "ops_manager",
  "administrator",
  "foh_staff",
] as const;

/** Re-export the canonical slug helpers so ordering stays in sync. */
export { normalizeSlug, isValidSlug };
