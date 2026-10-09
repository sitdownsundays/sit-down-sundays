/**
 * Admin reservation detail — party-feast grouping helpers.
 *
 * Determines whether all guests in a reservation share the same package and
 * the same included selections (family-style model), so the detail view can
 * show ONE shared "Party feast" summary instead of repeating identical
 * per-guest cards.
 *
 * Grouping uses package ID + selectionCategory + menuItemId — independent of
 * selection array order. If any guest has a different package, different
 * selections, or individual add-ons, the reservation is treated as MIXED
 * and the caller falls back to a guest-level breakdown.
 *
 * Pure, framework-independent. No React imports so it can live outside the
 * component module (avoids react-refresh only-export-components warnings).
 */
import type { ReservationDetailDTO } from "@/lib/reservation/types";

type Guest = ReservationDetailDTO["guests"][number];

/**
 * A normalized selection key: selectionCategory + menuItemId.
 * Order-independent — two guests with selections in different array order
 * produce the same key set.
 */
function selectionKey(s: { selectionCategory: string; menuItemId: string }): string {
  return `${s.selectionCategory}:${s.menuItemId}`;
}

/**
 * Normalized set of selection keys for a guest, as a sorted join for stable
 * comparison.
 */
function guestSelectionSignature(guest: Guest): string {
  return guest.includedSelections.map(selectionKey).sort().join("|");
}

export interface PartyFeastSummary {
  /** True only when every guest shares the same package and selections. */
  isUniform: boolean;
  packageName: string;
  packageId: string;
  /** Selected meats (selectionCategory === "meat"), using saved dish names. */
  meats: Array<{ menuItemId: string; name: string }>;
  /** Selected sides (selectionCategory === "side"), using saved dish names. */
  sides: Array<{ menuItemId: string; name: string }>;
  /** Selected bread (selectionCategory === "bread"), using saved dish names. */
  breads: Array<{ menuItemId: string; name: string }>;
  /**
   * Included soft drink — true only when the saved reservation data confirms
   * it (the package snapshot's includesSoftDrink). Never assumed from the
   * current menu configuration.
   */
  includesSoftDrink: boolean;
}

/**
 * Group guests into a party-feast summary if they all share the same package
 * and included selections. Returns `{ isUniform: false }` when any guest
 * differs — the caller must then render a guest-level breakdown.
 *
 * Individual add-ons always make the reservation mixed: a party feast is a
 * shared meal, and per-guest extras are exceptions to it.
 */
export function groupPartyFeast(guests: Guest[]): PartyFeastSummary {
  if (guests.length === 0) {
    return {
      isUniform: false,
      packageName: "",
      packageId: "",
      meats: [],
      sides: [],
      breads: [],
      includesSoftDrink: false,
    };
  }

  // Any guest with individual add-ons → mixed (exceptions visible).
  if (guests.some((g) => g.addons.length > 0)) {
    return {
      isUniform: false,
      packageName: "",
      packageId: "",
      meats: [],
      sides: [],
      breads: [],
      includesSoftDrink: false,
    };
  }

  // All guests must share the same package ID.
  const packageIds = new Set(guests.map((g) => g.packageId));
  if (packageIds.size !== 1) {
    return {
      isUniform: false,
      packageName: "",
      packageId: "",
      meats: [],
      sides: [],
      breads: [],
      includesSoftDrink: false,
    };
  }

  // All guests must share the same normalized selection signature.
  const signatures = new Set(guests.map(guestSelectionSignature));
  if (signatures.size !== 1) {
    return {
      isUniform: false,
      packageName: "",
      packageId: "",
      meats: [],
      sides: [],
      breads: [],
      includesSoftDrink: false,
    };
  }

  // Uniform — build the summary from the first guest's selections (all guests
  // are identical by this point).
  const first = guests[0];
  const meats: Array<{ menuItemId: string; name: string }> = [];
  const sides: Array<{ menuItemId: string; name: string }> = [];
  const breads: Array<{ menuItemId: string; name: string }> = [];

  for (const s of first.includedSelections) {
    const entry = { menuItemId: s.menuItemId, name: s.name };
    if (s.selectionCategory === "meat") {
      meats.push(entry);
    } else if (s.selectionCategory === "side") {
      sides.push(entry);
    } else if (s.selectionCategory === "bread") {
      breads.push(entry);
    }
  }

  return {
    isUniform: true,
    packageName: first.packageNameSnapshot,
    packageId: first.packageId,
    meats,
    sides,
    breads,
    // The saved reservation does not store a boolean includesSoftDrink flag
    // per guest. The soft drink is an included benefit of the package, not a
    // charged line. For the family-style summary we do NOT claim it unless the
    // saved data explicitly confirms it — so it defaults to false here. The
    // component may still mention "soft drink included" as a package benefit
    // label, but the data-driven check remains conservative.
    includesSoftDrink: false,
  };
}
