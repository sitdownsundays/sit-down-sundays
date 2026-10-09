/**
 * Admin reservation detail — party feast summary helpers.
 *
 * Pure, framework-independent helpers shared between the PartyFeastSummary
 * component and its focused tests. No React imports so they can live outside
 * the component module (avoids react-refresh only-export-components warnings).
 *
 * These operate on SAVED RESERVATION SNAPSHOTS — never the live menu
 * configuration. A historical reservation's dish names, package names, and
 * prices are the frozen values captured at submission time.
 */
import type { ReservationDetailDTO } from "@/lib/reservation/types";
import type { SelectionCategory } from "@/lib/ordering/constants";

type Guest = ReservationDetailDTO["guests"][number];
type IncludedSelection = Guest["includedSelections"][number];

/** Canonical key for a selection: category + menuItemId (order-independent). */
function selectionKey(s: IncludedSelection): string {
  return `${s.selectionCategory}:${s.menuItemId}`;
}

/**
 * Do all guests share the same package AND the same included selections?
 *
 * Compares by packageId and category+menuItemId, independent of array order.
 * Does NOT assume the first guest represents everyone — checks ALL guests.
 */
export function isSharedFeast(guests: Guest[]): boolean {
  if (guests.length < 2) return false;

  const firstPkg = guests[0].packageId;
  if (!firstPkg) return false;
  if (guests.some((g) => g.packageId !== firstPkg)) return false;

  const firstKeys = new Set(guests[0].includedSelections.map(selectionKey));
  return guests.every((g) => {
    const keys = new Set(g.includedSelections.map(selectionKey));
    if (keys.size !== firstKeys.size) return false;
    for (const k of keys) if (!firstKeys.has(k)) return false;
    return true;
  });
}

/** Does any guest have individual paid add-ons? */
export function hasIndividualAddons(guests: Guest[]): boolean {
  return guests.some((g) => g.addons.length > 0);
}

/** Does any guest have a different package from the first guest? */
export function hasMixedPackages(guests: Guest[]): boolean {
  if (guests.length <= 1) return false;
  const firstPkg = guests[0].packageId;
  return guests.some((g) => g.packageId !== firstPkg);
}

/**
 * Group a guest's included selections by category, preserving dish names.
 * Returns arrays of { name, menuItemId } per category.
 */
export function groupSelectionsByCategory(
  selections: IncludedSelection[],
): Record<SelectionCategory, Array<{ name: string; menuItemId: string }>> {
  const groups: Record<SelectionCategory, Array<{ name: string; menuItemId: string }>> = {
    meat: [],
    side: [],
    bread: [],
    drink: [],
  };
  for (const s of selections) {
    const cat = s.selectionCategory as SelectionCategory;
    if (cat in groups) {
      groups[cat].push({ name: s.name || s.menuItemId, menuItemId: s.menuItemId });
    }
  }
  return groups;
}

/**
 * Extract the shared feast summary from a uniform party.
 * Uses the first guest's snapshots (all guests are confirmed identical by
 * isSharedFeast before calling this).
 */
export function extractSharedFeast(guests: Guest[]): {
  packageName: string;
  packagePriceCents: number;
  selections: ReturnType<typeof groupSelectionsByCategory>;
  hasSoftDrink: boolean;
} | null {
  if (guests.length === 0) return null;
  const g0 = guests[0];
  const selections = groupSelectionsByCategory(g0.includedSelections);
  return {
    packageName: g0.packageNameSnapshot,
    packagePriceCents: g0.packagePriceSnapshot,
    selections,
    hasSoftDrink: selections.drink.length > 0,
  };
}
