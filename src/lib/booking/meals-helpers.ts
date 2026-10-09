/**
 * Booking wizard Step 2 (Meals & extras) helpers — client-safe, pure.
 *
 * Guest allocation management, selection-count tracking, apply-to-all, package
 * reconciliation, and party-change preservation. No server-only imports, no I/O.
 *
 * These mirror the server-authoritative validation in ordering/pricing.ts but
 * are for client-side UX guidance only; the server revalidates everything at
 * submission.
 */
import type { GuestCategory, SelectionCategory } from "@/lib/ordering/constants";
import type {
  PublicMealPackage,
  PublicIndividualAddon,
  PublicOrderingCatalog,
} from "@/lib/booking/public-catalog";

/** One guest's meal allocation. */
export interface GuestAllocation {
  /**
   * Stable client-only guest identifier. Generated once when a new guest
   * allocation is created and preserved across party reconciliation, package
   * changes, copy-meal, and step navigation. Never sent to the server — the
   * server uses guestIndex (the submission/order position) which may change.
   */
  guestId: string;
  /** Submission/order position (0-based). May change during reconciliation. */
  guestIndex: number;
  category: GuestCategory;
  name: string;
  packageId: string | null;
  /** Included selections: { menuItemId, selectionCategory }. */
  included: Array<{ menuItemId: string; selectionCategory: SelectionCategory }>;
  /** Individual add-ons: { addonId, quantity }. */
  addons: Array<{ addonId: string; quantity: number }>;
  /** Per-guest food allergies. Initialized to empty string for new guests. */
  foodAllergies: string;
  /** Per-guest dietary preferences/restrictions. Initialized to empty string. */
  dietaryPreferences: string;
  /** Per-guest meal-specific requests. Initialized to empty string. */
  mealRequests: string;
}

export interface MealsWizardState {
  allocations: GuestAllocation[];
  /** Shared platter lines: { platterId, quantity }. */
  platters: Array<{ platterId: string; quantity: number }>;
}

/**
 * Generate a cryptographically random guest identifier using the Web Crypto
 * API. Returns null if secure generation is unavailable. No Math.random
 * fallback — callers must handle null safely.
 */
export function generateGuestId(): string {
  if (typeof crypto === "undefined" || !crypto.getRandomValues) {
    throw new Error("Secure random generation is unavailable.");
  }
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Build the initial guest allocations from Step 1 party composition.
 * Each allocation starts with no package and empty selections. A stable
 * guestId is generated once per new allocation.
 */
export function buildAllocations(
  adults: number,
  seniors: number,
  children: number,
): GuestAllocation[] {
  const cats: GuestCategory[] = [
    ...Array.from({ length: adults }, () => "adult" as GuestCategory),
    ...Array.from({ length: seniors }, () => "senior" as GuestCategory),
    ...Array.from({ length: children }, () => "child" as GuestCategory),
  ];
  return cats.map((category, i) => ({
    guestId: generateGuestId(),
    guestIndex: i,
    category,
    name: `Guest ${i + 1}`,
    packageId: null,
    included: [],
    addons: [],
    foodAllergies: "",
    dietaryPreferences: "",
    mealRequests: "",
  }));
}

/**
 * Reconcile allocations when party composition changes.
 *
 * Preserves guests whose CATEGORY still exists in the new composition, keeping
 * their package, included selections, and add-ons intact. Guests are matched
 * by category (not array position), so adding an adult does not erase an
 * existing senior's or child's meal because positions shifted.
 *
 * Returns the new allocations plus a list of removed guest labels for
 * confirmation messaging (guests whose category is no longer present, or whose
 * position exceeds the new count for that category).
 */
export function reconcileAllocations(
  current: GuestAllocation[],
  adults: number,
  seniors: number,
  children: number,
): { allocations: GuestAllocation[]; removed: string[] } {
  const target = buildAllocations(adults, seniors, children);
  const removed: string[] = [];

  // Bucket existing allocations by category, preserving order.
  const byCategory: Record<GuestCategory, GuestAllocation[]> = {
    adult: [],
    senior: [],
    child: [],
  };
  for (const a of current) {
    if (byCategory[a.category]) byCategory[a.category].push(a);
  }

  const next: GuestAllocation[] = target.map((t) => {
    const pool = byCategory[t.category];
    if (pool.length > 0) {
      // Reuse an existing allocation of the same category, re-indexing it.
      // Preserve the stable guestId and the user-entered name (do not
      // overwrite an edited name with a regenerated "Guest N" label).
      const existing = pool.shift()!;
      return { ...existing, guestIndex: t.guestIndex };
    }
    return t;
  });

  // Any leftover allocations (category shrank) are removed.
  for (const cat of Object.keys(byCategory) as GuestCategory[]) {
    for (const leftover of byCategory[cat]) {
      removed.push(leftover.name);
    }
  }

  return { allocations: next, removed };
}

/**
 * Detect whether existing allocations share one uniform package with
 * identical included selections (comparing selectionCategory + menuItemId as
 * a set, independent of array order). Returns the shared feast or null when
 * meals are mixed, incomplete, or there are no allocations.
 */
function detectSharedFeast(allocations: GuestAllocation[]): {
  packageId: string;
  included: Array<{ menuItemId: string; selectionCategory: SelectionCategory }>;
} | null {
  if (allocations.length === 0) return null;
  const first = allocations[0]!;
  if (!first.packageId) return null;
  if (!allocations.every((a) => a.packageId === first.packageId)) return null;
  const key = (
    included: Array<{ menuItemId: string; selectionCategory: SelectionCategory }>,
  ): string =>
    included
      .map((s) => `${s.menuItemId}:${s.selectionCategory}`)
      .sort()
      .join("|");
  const firstKey = key(first.included);
  if (!allocations.every((a) => key(a.included) === firstKey)) return null;
  return { packageId: first.packageId, included: first.included.map((s) => ({ ...s })) };
}

/**
 * Reconcile allocations for PUBLIC party-wide booking. Preserves retained
 * guests' identity, name, category, package, selections, and add-ons via the
 * generic {@link reconcileAllocations}. When existing allocations share one
 * uniform package with identical included selections, NEW guests (added
 * through party composition changes) inherit that package and those selections
 * with independent copies — but NOT another guest's name, notes, or individual
 * add-ons. If existing meals are mixed, new guests get no package (do not
 * silently choose the first guest's meal).
 */
export function reconcileSharedFeast(
  current: GuestAllocation[],
  adults: number,
  seniors: number,
  children: number,
): { allocations: GuestAllocation[]; removed: string[] } {
  const shared = detectSharedFeast(current);
  const result = reconcileAllocations(current, adults, seniors, children);
  if (!shared) return result;
  const allocations = result.allocations.map((a) => {
    if (a.packageId !== null) return a; // retained guest — already has their meal
    return {
      ...a, // preserves new guestId, guestIndex, category, name
      packageId: shared.packageId,
      included: shared.included.map((s) => ({ ...s })),
      addons: [], // never inherit individual add-ons
    };
  });
  return { allocations, removed: result.removed };
}

/** Count selections of a category for a guest. */
export function selectionCount(alloc: GuestAllocation, category: SelectionCategory): number {
  return alloc.included.filter((s) => s.selectionCategory === category).length;
}

/** Eligible items for a package + category. */
export function eligibleFor(
  pkg: PublicMealPackage,
  category: SelectionCategory,
): Array<{ menuItemId: string; menuItemName: string }> {
  return pkg.eligibleItems
    .filter((e) => e.selectionCategory === category)
    .map((e) => ({ menuItemId: e.menuItemId, menuItemName: e.menuItemName }));
}

/** Required count for a category in a package. */
export function requiredCount(pkg: PublicMealPackage, category: SelectionCategory): number {
  if (category === "meat") return pkg.includedMeatsCount;
  if (category === "side") return pkg.includedSidesCount;
  return 0; // bread/drink are optional single inclusions
}

/** Whether a selection is eligible for the package. */
export function isEligible(
  pkg: PublicMealPackage,
  menuItemId: string,
  category: SelectionCategory,
): boolean {
  return pkg.eligibleItems.some(
    (e) => e.menuItemId === menuItemId && e.selectionCategory === category,
  );
}

/**
 * Toggle an included selection for a guest. Enforces the required count: adding
 * beyond the limit replaces the oldest selection of that category. Returns a
 * NEW allocation (no mutation).
 */
export function toggleSelection(
  alloc: GuestAllocation,
  pkg: PublicMealPackage,
  menuItemId: string,
  category: SelectionCategory,
): GuestAllocation {
  const exists = alloc.included.some(
    (s) => s.menuItemId === menuItemId && s.selectionCategory === category,
  );
  if (exists) {
    return {
      ...alloc,
      included: alloc.included.filter(
        (s) => !(s.menuItemId === menuItemId && s.selectionCategory === category),
      ),
    };
  }
  const limit = requiredCount(pkg, category);
  const current = alloc.included.filter((s) => s.selectionCategory === category);
  const others = alloc.included.filter((s) => s.selectionCategory !== category);
  let nextCat: Array<{ menuItemId: string; selectionCategory: SelectionCategory }>;
  if (limit > 0 && current.length >= limit) {
    // Replace oldest: drop first, keep rest, append new.
    nextCat = [...current.slice(1), { menuItemId, selectionCategory: category }];
  } else if (limit > 0) {
    nextCat = [...current, { menuItemId, selectionCategory: category }];
  } else {
    // No count limit (bread/drink): single selection — replace.
    nextCat = [{ menuItemId, selectionCategory: category }];
  }
  return { ...alloc, included: [...others, ...nextCat] };
}

/**
 * Apply a package to all guests. Returns NEW allocations (no shared mutable
 * objects). Clears incompatible selections AND add-ons on each guest.
 *
 * `catalogAddons` is the full active add-on catalog; an existing add-on line is
 * kept only if its add-on is still eligible for the new package. Without the
 * catalog we cannot resolve eligibility, so all add-ons are cleared (safe
 * default — never leave a hidden selected add-on).
 */
export function applyPackageToAll(
  allocations: GuestAllocation[],
  pkg: PublicMealPackage,
  catalogAddons?: PublicIndividualAddon[],
): GuestAllocation[] {
  return allocations.map((a) => applyPackage(a, pkg, catalogAddons));
}

/**
 * Apply a package to one guest. Clears included selections that are no longer
 * eligible for the new package, and clears add-ons that are no longer eligible
 * for the new package. Returns a NEW allocation.
 */
export function applyPackage(
  alloc: GuestAllocation,
  pkg: PublicMealPackage,
  catalogAddons?: PublicIndividualAddon[],
): GuestAllocation {
  const keptIncluded = alloc.included.filter((s) =>
    isEligible(pkg, s.menuItemId, s.selectionCategory),
  );
  // Reconcile add-ons against the new package. An add-on line is kept only if
  // its add-on exists in the active catalog AND is eligible for the new package.
  const keptAddons = alloc.addons.filter((line) => {
    const addon = catalogAddons?.find((a) => a.id === line.addonId);
    if (!addon) return false; // add-on no longer in catalog
    return addonEligibleFor(addon, pkg.id);
  });
  return {
    ...alloc,
    packageId: pkg.id,
    included: keptIncluded,
    addons: keptAddons,
  };
}

/**
 * Whether applying a package to a guest would discard any existing add-ons or
 * included selections (i.e. the change is destructive). Used to gate the
 * apply-to-all confirmation.
 */
export function applyingPackageIsDestructive(
  alloc: GuestAllocation,
  pkg: PublicMealPackage,
  catalogAddons?: PublicIndividualAddon[],
): boolean {
  const hasIneligibleIncluded = alloc.included.some(
    (s) => !isEligible(pkg, s.menuItemId, s.selectionCategory),
  );
  const hasIneligibleAddon = alloc.addons.some((line) => {
    const addon = catalogAddons?.find((a) => a.id === line.addonId);
    if (!addon) return true;
    return !addonEligibleFor(addon, pkg.id);
  });
  return hasIneligibleIncluded || hasIneligibleAddon;
}

/** Whether an add-on is eligible for a package. Empty eligiblePackageIds = all. */
export function addonEligibleFor(addon: PublicIndividualAddon, packageId: string | null): boolean {
  if (!packageId) return false;
  if (addon.eligiblePackageIds.length === 0) return true;
  return addon.eligiblePackageIds.includes(packageId);
}

/**
 * Determine which target guests would have configured meals replaced or
 * incompatible add-ons removed when copying from a source. Returns indices
 * for warning display.
 */
export function copyMealImpact(
  allocations: GuestAllocation[],
  sourceIndex: number,
  targetIndices: number[],
  catalogAddons?: PublicIndividualAddon[],
): { replacingMeals: number[]; removingAddons: number[] } {
  const source = allocations.find((a) => a.guestIndex === sourceIndex);
  if (!source || !source.packageId) {
    return { replacingMeals: [], removingAddons: [] };
  }
  const targets = new Set(targetIndices);
  const replacingMeals: number[] = [];
  const removingAddons: number[] = [];

  for (const a of allocations) {
    if (!targets.has(a.guestIndex)) continue;
    if (a.packageId || a.included.length > 0) replacingMeals.push(a.guestIndex);
    const hasIncompatibleAddon = a.addons.some((line) => {
      const addon = catalogAddons?.find((ad) => ad.id === line.addonId);
      if (!addon) return true;
      return !addonEligibleFor(addon, source.packageId);
    });
    if (hasIncompatibleAddon) removingAddons.push(a.guestIndex);
  }
  return { replacingMeals, removingAddons };
}

/** Set an add-on quantity for a guest. quantity 0 removes it. */
export function setAddonQuantity(
  alloc: GuestAllocation,
  addonId: string,
  quantity: number,
): GuestAllocation {
  const q = Math.max(0, Math.trunc(quantity));
  if (q === 0) {
    return { ...alloc, addons: alloc.addons.filter((a) => a.addonId !== addonId) };
  }
  const exists = alloc.addons.some((a) => a.addonId === addonId);
  if (exists) {
    return {
      ...alloc,
      addons: alloc.addons.map((a) => (a.addonId === addonId ? { ...a, quantity: q } : a)),
    };
  }
  return { ...alloc, addons: [...alloc.addons, { addonId, quantity: q }] };
}

/** Set a shared platter quantity. quantity 0 removes it. */
export function setPlatterQuantity(
  platters: Array<{ platterId: string; quantity: number }>,
  platterId: string,
  quantity: number,
): Array<{ platterId: string; quantity: number }> {
  const q = Math.max(0, Math.trunc(quantity));
  if (q === 0) return platters.filter((p) => p.platterId !== platterId);
  const exists = platters.some((p) => p.platterId === platterId);
  if (exists) return platters.map((p) => (p.platterId === platterId ? { ...p, quantity: q } : p));
  return [...platters, { platterId, quantity: q }];
}

/** Validation notes for a guest's selections against a package. */
export function validateGuestSelections(
  alloc: GuestAllocation,
  pkg: PublicMealPackage | undefined,
): string[] {
  if (!pkg) return ["No meal package selected."];
  const notes: string[] = [];
  const meats = selectionCount(alloc, "meat");
  const sides = selectionCount(alloc, "side");
  if (meats !== pkg.includedMeatsCount) {
    notes.push(`Meats: ${meats} of ${pkg.includedMeatsCount} selected.`);
  }
  if (sides !== pkg.includedSidesCount) {
    notes.push(`Sides: ${sides} of ${pkg.includedSidesCount} selected.`);
  }
  return notes;
}

/** Whether all guests have a complete, valid package selection. */
export function allGuestsComplete(
  allocations: GuestAllocation[],
  catalog: PublicOrderingCatalog,
): boolean {
  return allocations.every((a) => {
    if (!a.packageId) return false;
    const pkg = catalog.packages.find((p) => p.id === a.packageId);
    if (!pkg) return false;
    return validateGuestSelections(a, pkg).length === 0;
  });
}

// ---------------------------------------------------------------------------
// Party-wide feast selector helpers (public ordering: ONE shared package +
// shared included selections for the entire party).
// ---------------------------------------------------------------------------

/** The shared feast state derived from the first guest's allocation. */
export interface SharedFeastState {
  packageId: string | null;
  included: Array<{ menuItemId: string; selectionCategory: SelectionCategory }>;
}

/** Extract the shared feast state from the first guest (or empty if no guests). */
export function getSharedFeast(allocations: GuestAllocation[]): SharedFeastState {
  if (allocations.length === 0) return { packageId: null, included: [] };
  const first = allocations[0]!;
  return { packageId: first.packageId, included: first.included };
}

/**
 * Apply a shared package to ALL guests. Clears incompatible selections and
 * add-ons on each guest, preserving their identity/category/name. Returns NEW
 * allocations (no shared mutable objects).
 */
export function setSharedPackage(
  allocations: GuestAllocation[],
  pkg: PublicMealPackage,
  catalogAddons?: PublicIndividualAddon[],
): GuestAllocation[] {
  return applyPackageToAll(allocations, pkg, catalogAddons);
}

/**
 * Toggle a shared included selection for the ENTIRE party. Toggles on the first
 * guest, then copies the result to all other guests, preserving their
 * identity, category, name, and add-ons. Returns NEW allocations.
 */
export function toggleSharedSelection(
  allocations: GuestAllocation[],
  pkg: PublicMealPackage,
  menuItemId: string,
  category: SelectionCategory,
): GuestAllocation[] {
  if (allocations.length === 0) return allocations;
  const first = allocations[0]!;
  if (!first.packageId) return allocations;
  const toggled = toggleSelection(first, pkg, menuItemId, category);
  return allocations.map((a) => ({
    ...a,
    packageId: first.packageId,
    included: toggled.included.map((s) => ({ ...s })),
  }));
}

/**
 * Whether applying a shared package would discard existing configured meals
 * (for confirmation gating). True if any guest has a package or selections.
 */
export function sharedPackageIsDestructive(
  allocations: GuestAllocation[],
  pkg: PublicMealPackage,
  catalogAddons?: PublicIndividualAddon[],
): boolean {
  return allocations.some((a) => applyingPackageIsDestructive(a, pkg, catalogAddons));
}

/** Count shared selections of a category (from the first guest). */
export function sharedSelectionCount(
  allocations: GuestAllocation[],
  category: SelectionCategory,
): number {
  if (allocations.length === 0) return 0;
  return selectionCount(allocations[0]!, category);
}

/**
 * Result of previewing a copy-meal operation: which recipients would lose
 * configured meals and which would lose add-ons, so the UI can warn before
 * confirming.
 */
export interface CopyMealPreview {
  /** Recipient guest indices that already have a package/selections. */
  replacingMeals: number[];
  /** Recipient guest indices whose existing add-ons are incompatible. */
  removingAddons: number[];
}

/**
 * Preview what a copy-meal operation would change, without mutating state.
 * Used to warn the user before confirming.
 */
export function previewCopyMeal(
  allocations: GuestAllocation[],
  sourceIndex: number,
  targetIndices: number[],
  catalogAddons?: PublicIndividualAddon[],
): CopyMealPreview {
  const source = allocations[sourceIndex];
  if (!source || !source.packageId) return { replacingMeals: [], removingAddons: [] };
  const replacingMeals: number[] = [];
  const removingAddons: number[] = [];
  for (const idx of targetIndices) {
    const target = allocations[idx];
    if (!target) continue;
    if (target.packageId || target.included.length > 0) replacingMeals.push(idx);
    const hasIncompatibleAddon = target.addons.some((line) => {
      const addon = catalogAddons?.find((a) => a.id === line.addonId);
      if (!addon) return true;
      return !addonEligibleFor(addon, source.packageId);
    });
    if (hasIncompatibleAddon) removingAddons.push(idx);
  }
  return { replacingMeals, removingAddons };
}

/**
 * Copy a source guest's package and included meat/side/bread selections to
 * the specified recipient guest indices. Returns NEW allocations (no shared
 * mutable objects).
 *
 * Copies ONLY: packageId and included selections (meat, side, bread).
 * Does NOT copy: guest identity/name/index, category, individual add-ons, or
 * shared platters.
 *
 * For each recipient:
 *  - packageId and included selections are replaced with independent copies.
 *  - existing add-ons are preserved only when active and eligible for the
 *    copied package (reuses applyPackage's reconciliation).
 *  - guest category and identity are preserved.
 */
export function copyMealToGuests(
  allocations: GuestAllocation[],
  sourceIndex: number,
  targetIndices: number[],
  catalogAddons?: PublicIndividualAddon[],
): GuestAllocation[] {
  const source = allocations.find((a) => a.guestIndex === sourceIndex);
  if (!source || !source.packageId) return allocations;
  const sourcePackageId = source.packageId;
  const targets = new Set(targetIndices);
  // Deep-copy the included selections so recipients are independent.
  const sourceIncluded = source.included.map((s) => ({ ...s }));
  return allocations.map((alloc) => {
    if (!targets.has(alloc.guestIndex)) return alloc;
    // Reconcile add-ons against the copied package (same logic as applyPackage).
    const keptAddons = alloc.addons.filter((line) => {
      const addon = catalogAddons?.find((a) => a.id === line.addonId);
      if (!addon) return false;
      return addonEligibleFor(addon, sourcePackageId);
    });
    return {
      ...alloc,
      packageId: sourcePackageId,
      included: sourceIncluded.map((s) => ({ ...s })),
      addons: keptAddons,
    };
  });
}
