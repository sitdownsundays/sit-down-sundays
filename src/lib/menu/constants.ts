/**
 * Menu CMS — centralized constants & validation rules.
 *
 * Framework-independent. No server-only imports. No mock data.
 * These mirror the database CHECK constraints in 0003_menu_catalog.sql.
 */

/** Menu lifecycle status. */
export type MenuStatus = "draft" | "published" | "archived";

export const MENU_STATUSES: MenuStatus[] = ["draft", "published", "archived"];

/**
 * Menu item course/category. Must stay in sync with the application
 * MenuCategory union and the database category CHECK constraint.
 */
export const MENU_CATEGORIES = [
  "starter",
  "main",
  "side",
  "dessert",
  "beverage",
  "children",
] as const;

export type MenuCategory = (typeof MENU_CATEGORIES)[number];

/** Length limits aligned with the database varchar constraints. */
export const MENU_LIMITS = {
  menuName: 160,
  menuSlug: 160,
  menuItemName: 160,
  category: 40,
  imageUrl: 2048,
  imageAlt: 300,
  sectionName: 160,
  description: 4000,
} as const;

/** Maximum supported price in cents (a safety ceiling, not a business price). */
export const MAX_PRICE_CENTS = 1_000_000;

/** Roles permitted to perform CMS mutations (server-enforced). */
export const MENU_MUTATION_ROLES = ["content_manager", "ops_manager", "administrator"] as const;

/** Roles permitted to read draft content (server-enforced). */
export const MENU_DRAFT_READ_ROLES = ["content_manager", "ops_manager", "administrator"] as const;

/** Lowercase + trim a slug; collapse runs of invalid chars to a single dash. */
export function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A slug is valid when it is non-empty and matches the allowed pattern. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= MENU_LIMITS.menuSlug;
}
