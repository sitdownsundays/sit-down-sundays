/**
 * Pure helpers for filtering menu items into a package's selection-category
 * buckets (meat / side / bread / drink).
 *
 * The package's `selectionCategory` is an INDEPENDENT classification from the
 * menu_item's own `category` column. A menu_item's authoritative category
 * (MenuCategory: starter / main / side / dessert / beverage / children) is the
 * only reliable signal for which selection bucket it belongs in. This helper
 * maps each SelectionCategory to the set of MenuCategory values that fill it.
 *
 * Client-safe: no server-only imports.
 */
import type { MenuItemDTO } from "@/lib/menu/types";
import type { SelectionCategory } from "@/lib/ordering/constants";

/**
 * The narrow catalog-item shape these helpers actually read. Full MenuItemDTO
 * inputs remain structurally compatible; lightweight catalog projections
 * (e.g. { id, name, menuName, category, isActive }) are accepted too.
 */
export type CatalogItemInput = Pick<MenuItemDTO, "id" | "name" | "category" | "isActive">;

/**
 * Maps a package selection category to the menu-item categories that are
 * eligible to fill it. This is the authoritative, name-independent mapping
 * derived from the stored menu_item.category column.
 *
 *   meat  → main (the Sunday roast mains)
 *   side  → side
 *   bread → starter (the bread / rolls starter course)
 *   drink → beverage
 *
 * dessert and children have no package selection bucket — a guest's dessert
 * and child items are handled outside the included-selection model.
 */
export const SELECTION_TO_MENU_CATEGORIES: Record<
  SelectionCategory,
  readonly MenuItemDTO["category"][]
> = {
  meat: ["main"],
  side: ["side"],
  bread: ["starter"],
  drink: ["beverage"],
} as const;

/**
 * Items eligible for a given selection category — active items only, since an
 * inactive menu item should not be offered for new selection.
 *
 * A menu item that is not active is excluded from new-selection candidates but
 * is NOT removed from an existing saved selection (the caller handles that).
 *
 * The generic preserves the caller's item type so lightweight catalog
 * projections (with extra fields like menuName) flow through unchanged.
 */
export function itemsForSelectionCategory<T extends CatalogItemInput>(
  items: readonly T[],
  selectionCategory: SelectionCategory,
): T[] {
  const cats = SELECTION_TO_MENU_CATEGORIES[selectionCategory];
  return items.filter((item) => cats.includes(item.category) && item.isActive);
}

/**
 * Split a set of saved menu-item IDs into those that match the requested
 * selection category, those that don't (mismatched), and those whose catalog
 * record is missing entirely (unknown).
 *
 * Mismatched and unknown selections are NEVER silently deleted — they are
 * returned so the editor can display a warning with a Remove button and let
 * the administrator correct them before saving.
 *
 * The generic preserves the caller's item type in the `mismatched` bucket.
 */
export function partitionSavedSelection<T extends CatalogItemInput>(
  savedItemIds: ReadonlySet<string>,
  catalogItems: readonly T[],
  selectionCategory: SelectionCategory,
): {
  matching: string[];
  mismatched: T[];
  unknown: string[];
} {
  const cats = SELECTION_TO_MENU_CATEGORIES[selectionCategory];
  const matching: string[] = [];
  const mismatched: T[] = [];
  const unknown: string[] = [];
  for (const id of savedItemIds) {
    const item = catalogItems.find((c) => c.id === id);
    if (!item) {
      unknown.push(id);
      continue;
    }
    if (cats.includes(item.category)) {
      matching.push(id);
    } else {
      mismatched.push(item);
    }
  }
  return { matching, mismatched, unknown };
}

/**
 * Toggle a menu item's membership in a selection-category set.
 *
 * - If the item is already selected, removes it (always allowed, even if it
 *   no longer matches the category or is missing from the catalog).
 * - If the item is not selected, adds it ONLY if it is an active,
 *   category-matching catalog item. Cross-category additions are rejected.
 *
 * Returns the updated set, or the same set reference if no change occurred.
 */
export function toggleSelectionSet(
  current: ReadonlySet<string>,
  catalogItems: readonly CatalogItemInput[],
  selectionCategory: SelectionCategory,
  itemId: string,
): Set<string> {
  if (current.has(itemId)) {
    const next = new Set(current);
    next.delete(itemId);
    return next;
  }
  const item = catalogItems.find((c) => c.id === itemId);
  if (!item || !item.isActive || !itemMatchesSelectionCategory(item, selectionCategory)) {
    return current as Set<string>;
  }
  const next = new Set(current);
  next.add(itemId);
  return next;
}

/**
 * Remove a saved item from a selection-category set, regardless of catalog
 * match. This is the explicit Remove path for mismatched or unavailable items.
 *
 * Returns the updated set, or the same set reference if the item was not
 * present (no change).
 */
export function removeFromSelectionSet(current: ReadonlySet<string>, itemId: string): Set<string> {
  if (!current.has(itemId)) return current as Set<string>;
  const next = new Set(current);
  next.delete(itemId);
  return next;
}

/**
 * Whether a single menu item belongs in the given selection category. Used to
 * guard new cross-category selections in the editor.
 */
export function itemMatchesSelectionCategory(
  item: CatalogItemInput,
  selectionCategory: SelectionCategory,
): boolean {
  return SELECTION_TO_MENU_CATEGORIES[selectionCategory].includes(item.category);
}

const ALL_SELECTION_CATEGORIES: readonly SelectionCategory[] = ["meat", "side", "bread", "drink"];

/** Catalog query status used by eligibility validation. */
export type CatalogLoadState = {
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
};

/**
 * Validate the eligible-item section against the catalog load state.
 *
 * Returns an error message string when saving must be blocked, or undefined
 * when the section is valid. The paths are mutually exclusive:
 *
 * - Loading or idle (not yet successful): a wait message — never a removal
 *   message against missing catalog data.
 * - Failed read: a retry message.
 * - Successful read: a mismatched/unavailable-selection message, or undefined
 *   when all saved selections are clean.
 *
 * Saved selections are only classified against a successfully loaded catalog.
 */
export function validateCatalogEligibility(
  catalog: CatalogLoadState,
  eligible: Record<SelectionCategory, ReadonlySet<string>>,
  catalogItems: readonly CatalogItemInput[],
): string | undefined {
  if (!catalog.isSuccess) {
    return catalog.isError
      ? "Couldn't load the menu catalog. Retry before saving."
      : "Wait for the menu catalog to load before saving.";
  }
  for (const cat of ALL_SELECTION_CATEGORIES) {
    const { mismatched, unknown } = partitionSavedSelection(eligible[cat], catalogItems, cat);
    if (mismatched.length > 0 || unknown.length > 0) {
      return "Remove mismatched or unavailable items before saving.";
    }
  }
  return undefined;
}
