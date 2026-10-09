/**
 * SERVER-ONLY — party-wide meal validation helper.
 *
 * The business rule (confirmed by the owner) for public party ordering is:
 * ONE package for the entire party, with SHARED included selections (meats,
 * sides, and one bread). Everyone eats the same meal. Adult/senior/child
 * counts remain for per-person pricing, but the included dishes are chosen
 * once for the party, not per guest.
 *
 * This helper validates that a set of existing guest allocations conforms to
 * the party-wide rule against authoritative OrderingConfigDTO. It does NOT
 * perform database writes, does NOT accept an admin-override flag, and does
 * NOT mutate the input. It returns a typed result with a safe error code so
 * the caller can map it to a proven_rejection outcome.
 *
 * The staff preview (calculateOrderPreview in ordering.functions.ts) remains
 * independently flexible — it uses its own role-gated schema and is NOT bound
 * by this party-wide constraint. This helper is the enforcement for PUBLIC
 * reservation submissions only.
 *
 * GUEST-SPECIFIC INFORMATION:
 *  - Guest name, category, and personal notes are NOT compared — only the
 *    shared package + included selections are. A party may include adults,
 *    seniors, and children with different (optional) names; those differences
 *    are irrelevant to the shared meal.
 *  - This helper does not copy one guest's notes to another.
 *
 * SHARED PLATTERS:
 *  - Platters are validated separately by their existing path. This helper
 *    focuses on the per-guest package + included-selection uniformity.
 */
import type { OrderingConfigDTO, MealPackageDTO, EligibleItemDTO } from "@/lib/ordering/types";
import type { ReservationGuestInput } from "@/lib/reservation/types";
import type { SelectionCategory } from "@/lib/ordering/constants";

/** Safe, non-leaking error codes for proven pre-write rejection. */
export type PartyMealErrorCode =
  | "empty_party"
  | "missing_package"
  | "mixed_packages"
  | "mismatched_selections"
  | "duplicate_selections"
  | "invalid_meat_count"
  | "invalid_side_count"
  | "missing_bread"
  | "multiple_bread"
  | "ineligible_selection"
  | "individual_addons_not_allowed";

export interface PartyMealValidationError {
  ok: false;
  error: { code: PartyMealErrorCode; message: string };
}

export interface PartyMealValidationOk {
  ok: true;
  /** The validated shared package (authoritative). */
  packageId: string;
}

export type PartyMealValidationResult = PartyMealValidationOk | PartyMealValidationError;

const MESSAGES: Record<PartyMealErrorCode, string> = {
  empty_party: "Your party must include at least one guest.",
  missing_package: "Please select a meal package for your party.",
  mixed_packages: "Your party must choose the same meal package for every guest.",
  mismatched_selections: "Your party must choose the same included dishes for every guest.",
  duplicate_selections: "Each dish may only be selected once within its category.",
  invalid_meat_count: "Please select the correct number of meats for your package.",
  invalid_side_count: "Please select the correct number of sides for your package.",
  missing_bread: "Please select a bread choice for your party.",
  multiple_bread: "Please choose only one bread option for your party.",
  ineligible_selection: "One or more selected dishes are not available for this package.",
  individual_addons_not_allowed:
    "Individual add-ons are not available for party online ordering. Please call us to customize.",
};

/**
 * Build a stable key for an included selection, independent of array order.
 * Compares selectionCategory + menuItemId.
 */
function selectionKey(s: { menuItemId: string; selectionCategory: SelectionCategory }): string {
  return `${s.selectionCategory}:${s.menuItemId}`;
}

/**
 * Validate that all guests in a party share the same active package and the
 * same included selections, that the shared selections meet the package's
 * configured meat/side counts, exactly one eligible bread is selected, every
 * selected dish is eligible for that package/category, and no individual paid
 * add-ons are present.
 *
 * @param guests  The existing guest allocations.
 * @param config  Authoritative ordering configuration (refetched server-side).
 * @returns A typed validation result. Never throws. Never mutates input.
 */
export function validatePartyWideMeal(
  guests: ReservationGuestInput[],
  config: OrderingConfigDTO,
): PartyMealValidationResult {
  // ----------------------------------------------------------------
  // 1. At least one guest.
  // ----------------------------------------------------------------
  if (guests.length === 0) {
    return { ok: false, error: { code: "empty_party", message: MESSAGES.empty_party } };
  }

  // ----------------------------------------------------------------
  // 2. Every guest has the SAME package, and it must be active.
  // ----------------------------------------------------------------
  // Every guest must have a non-empty packageId before checking uniformity.
  for (const g of guests) {
    if (!g.packageId) {
      return { ok: false, error: { code: "missing_package", message: MESSAGES.missing_package } };
    }
  }

  const firstPackageId = guests[0]!.packageId;

  for (const g of guests) {
    if (g.packageId !== firstPackageId) {
      return { ok: false, error: { code: "mixed_packages", message: MESSAGES.mixed_packages } };
    }
  }

  const pkg: MealPackageDTO | undefined = config.packages.find((p) => p.id === firstPackageId);
  if (!pkg || !pkg.isActive) {
    return { ok: false, error: { code: "missing_package", message: MESSAGES.missing_package } };
  }

  // ----------------------------------------------------------------
  // 3. No duplicate selections within ANY guest allocation (per
  //    category+item). This runs BEFORE the set-comparison so a
  //    duplicate in a later guest is reported as duplicate_selections,
  //    not swallowed by a size mismatch (mismatched_selections).
  // ----------------------------------------------------------------
  for (const g of guests) {
    const seenKeys = new Set<string>();
    for (const s of g.included) {
      const k = selectionKey(s);
      if (seenKeys.has(k)) {
        return {
          ok: false,
          error: { code: "duplicate_selections", message: MESSAGES.duplicate_selections },
        };
      }
      seenKeys.add(k);
    }
  }

  // ----------------------------------------------------------------
  // 4. Every guest has the SAME included selections (order-independent).
  //    Compare selectionCategory + menuItemId as a set.
  // ----------------------------------------------------------------
  const firstSelectionKeys = new Set(guests[0]!.included.map(selectionKey));

  for (const g of guests) {
    const keys = new Set(g.included.map(selectionKey));
    if (keys.size !== firstSelectionKeys.size) {
      return {
        ok: false,
        error: { code: "mismatched_selections", message: MESSAGES.mismatched_selections },
      };
    }
    for (const k of keys) {
      if (!firstSelectionKeys.has(k)) {
        return {
          ok: false,
          error: { code: "mismatched_selections", message: MESSAGES.mismatched_selections },
        };
      }
    }
  }

  // Use the first guest's selections as the canonical shared set.
  const shared = guests[0]!.included;

  // ----------------------------------------------------------------
  // 5. Count meats and sides against the package's configured counts.
  // ----------------------------------------------------------------
  let meatCount = 0;
  let sideCount = 0;
  let breadCount = 0;
  for (const s of shared) {
    if (s.selectionCategory === "meat") meatCount++;
    else if (s.selectionCategory === "side") sideCount++;
    else if (s.selectionCategory === "bread") breadCount++;
  }

  if (meatCount !== pkg.includedMeatsCount) {
    return {
      ok: false,
      error: { code: "invalid_meat_count", message: MESSAGES.invalid_meat_count },
    };
  }
  if (sideCount !== pkg.includedSidesCount) {
    return {
      ok: false,
      error: { code: "invalid_side_count", message: MESSAGES.invalid_side_count },
    };
  }

  // ----------------------------------------------------------------
  // 6. Bread: exactly one eligible bread when the package includes bread.
  //    When the package does NOT include bread, no bread selections allowed.
  // ----------------------------------------------------------------
  if (pkg.includesBread) {
    if (breadCount < 1) {
      return { ok: false, error: { code: "missing_bread", message: MESSAGES.missing_bread } };
    }
    if (breadCount > 1) {
      return { ok: false, error: { code: "multiple_bread", message: MESSAGES.multiple_bread } };
    }
  } else {
    if (breadCount > 0) {
      return { ok: false, error: { code: "multiple_bread", message: MESSAGES.multiple_bread } };
    }
  }

  // ----------------------------------------------------------------
  // 7. Every selected dish is eligible for this package + category.
  // ----------------------------------------------------------------
  const eligibleByItemCategory = new Map<string, EligibleItemDTO>();
  for (const e of pkg.eligibleItems) {
    eligibleByItemCategory.set(`${e.selectionCategory}:${e.menuItemId}`, e);
  }

  for (const s of shared) {
    if (!eligibleByItemCategory.has(selectionKey(s))) {
      return {
        ok: false,
        error: { code: "ineligible_selection", message: MESSAGES.ineligible_selection },
      };
    }
  }

  // ----------------------------------------------------------------
  // 8. No individual paid add-ons in public party ordering.
  //    Shared platters are separate and validated by their existing path.
  // ----------------------------------------------------------------
  for (const g of guests) {
    if (g.addons && g.addons.length > 0) {
      return {
        ok: false,
        error: {
          code: "individual_addons_not_allowed",
          message: MESSAGES.individual_addons_not_allowed,
        },
      };
    }
  }

  return { ok: true, packageId: pkg.id };
}
