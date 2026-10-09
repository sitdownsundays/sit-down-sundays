// Admin reservation detail — party feast summary grouping/display tests.
//
// These are STRUCTURAL / CONTRACT tests against the production grouping logic
// (isSharedFeast, hasIndividualAddons, hasMixedPackages, extractSharedFeast,
// groupSelectionsByCategory) and the ReservationDetailDTO guest shape.
//
// NOT rendered-component tests — the vitest config runs in the `node`
// environment with no DOM/testing-library dependency.
import { describe, it, expect } from "vitest";

import {
  isSharedFeast,
  hasIndividualAddons,
  hasMixedPackages,
  extractSharedFeast,
  groupSelectionsByCategory,
} from "@/components/admin/party-feast-summary-helpers";
import type { ReservationDetailDTO } from "@/lib/reservation/types";

type Guest = ReservationDetailDTO["guests"][number];

function makeGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    id: "g-1",
    guestIndex: 0,
    guestCategory: "adult",
    guestName: null,
    packageId: "pkg-basic",
    packageNameSnapshot: "Basic Meal",
    packagePriceSnapshot: 2950,
    includedSelections: [],
    addons: [],
    foodAllergies: "",
    dietaryPreferences: "",
    mealRequests: "",
    ...overrides,
  };
}

/* ---- isSharedFeast ---- */

describe("party feast — isSharedFeast", () => {
  it("returns true for a uniform party (same package + same selections)", () => {
    const sel = [
      { menuItemId: "m-beef", selectionCategory: "meat", name: "Slow Roasted Beef" },
      { menuItemId: "m-chicken", selectionCategory: "meat", name: "D.A.'s Fried or Baked Chicken" },
      { menuItemId: "s-green", selectionCategory: "side", name: "Green Beans" },
      { menuItemId: "s-cabbage", selectionCategory: "side", name: "Steamed Cabbage" },
      { menuItemId: "b-rolls", selectionCategory: "bread", name: "Dinner Rolls" },
    ] as const;
    const guests = [
      makeGuest({ id: "g-1", guestIndex: 0, includedSelections: [...sel] }),
      makeGuest({ id: "g-2", guestIndex: 1, includedSelections: [...sel] }),
      makeGuest({
        id: "g-3",
        guestIndex: 2,
        guestCategory: "child",
        includedSelections: [...sel],
      }),
    ];
    expect(isSharedFeast(guests)).toBe(true);
  });

  it("returns true even when selections are in different array order", () => {
    const selA = [
      { menuItemId: "m-beef", selectionCategory: "meat", name: "Beef" },
      { menuItemId: "s-green", selectionCategory: "side", name: "Green Beans" },
    ];
    const selB = [
      { menuItemId: "s-green", selectionCategory: "side", name: "Green Beans" },
      { menuItemId: "m-beef", selectionCategory: "meat", name: "Beef" },
    ];
    const guests = [
      makeGuest({ id: "g-1", includedSelections: [...selA] }),
      makeGuest({ id: "g-2", includedSelections: [...selB] }),
    ];
    expect(isSharedFeast(guests)).toBe(true);
  });

  it("returns false when guests have different packages", () => {
    const guests = [
      makeGuest({ id: "g-1", packageId: "pkg-basic", packageNameSnapshot: "Basic Meal" }),
      makeGuest({ id: "g-2", packageId: "pkg-premium", packageNameSnapshot: "Premium Meal" }),
    ];
    expect(isSharedFeast(guests)).toBe(false);
  });

  it("returns false when guests have the same package but different selections", () => {
    const guests = [
      makeGuest({
        id: "g-1",
        includedSelections: [{ menuItemId: "m-beef", selectionCategory: "meat", name: "Beef" }],
      }),
      makeGuest({
        id: "g-2",
        includedSelections: [
          { menuItemId: "m-chicken", selectionCategory: "meat", name: "Chicken" },
        ],
      }),
    ];
    expect(isSharedFeast(guests)).toBe(false);
  });

  it("returns false for empty guests array", () => {
    expect(isSharedFeast([])).toBe(false);
  });

  it("returns false for a single guest (not a shared feast)", () => {
    const guests = [makeGuest()];
    expect(isSharedFeast(guests)).toBe(false);
  });
});

/* ---- hasIndividualAddons ---- */

describe("party feast — hasIndividualAddons", () => {
  it("returns false when no guests have add-ons", () => {
    expect(hasIndividualAddons([makeGuest(), makeGuest()])).toBe(false);
  });

  it("returns true when at least one guest has add-ons", () => {
    const guests = [
      makeGuest({ id: "g-1" }),
      makeGuest({
        id: "g-2",
        addons: [
          {
            id: "a-1",
            addonId: "addon-1",
            addonNameSnapshot: "Extra Cornbread",
            pricePerUnitSnapshot: 350,
            quantity: 1,
          },
        ],
      }),
    ];
    expect(hasIndividualAddons(guests)).toBe(true);
  });
});

/* ---- hasMixedPackages ---- */

describe("party feast — hasMixedPackages", () => {
  it("returns false when all guests share a package", () => {
    expect(hasMixedPackages([makeGuest(), makeGuest()])).toBe(false);
  });

  it("returns true when guests have different packages", () => {
    const guests = [
      makeGuest({ id: "g-1", packageId: "pkg-basic" }),
      makeGuest({ id: "g-2", packageId: "pkg-premium" }),
    ];
    expect(hasMixedPackages(guests)).toBe(true);
  });

  it("returns false for a single guest", () => {
    expect(hasMixedPackages([makeGuest()])).toBe(false);
  });
});

/* ---- groupSelectionsByCategory ---- */

describe("party feast — groupSelectionsByCategory", () => {
  it("groups selections by category preserving dish names", () => {
    const selections = [
      { menuItemId: "m-beef", selectionCategory: "meat", name: "Slow Roasted Beef" },
      { menuItemId: "m-chicken", selectionCategory: "meat", name: "Fried Chicken" },
      { menuItemId: "s-green", selectionCategory: "side", name: "Green Beans" },
      { menuItemId: "b-rolls", selectionCategory: "bread", name: "Dinner Rolls" },
      { menuItemId: "d-cola", selectionCategory: "drink", name: "Soft Drink" },
    ];
    const grouped = groupSelectionsByCategory(selections);
    expect(grouped.meat).toHaveLength(2);
    expect(grouped.meat[0].name).toBe("Slow Roasted Beef");
    expect(grouped.side).toHaveLength(1);
    expect(grouped.bread).toHaveLength(1);
    expect(grouped.drink).toHaveLength(1);
  });

  it("falls back to menuItemId when name is empty", () => {
    const selections = [{ menuItemId: "m-beef", selectionCategory: "meat", name: "" }];
    const grouped = groupSelectionsByCategory(selections);
    expect(grouped.meat[0].name).toBe("m-beef");
  });
});

/* ---- extractSharedFeast ---- */

describe("party feast — extractSharedFeast", () => {
  it("extracts package name, price, and grouped selections", () => {
    const guests = [
      makeGuest({
        packageNameSnapshot: "Basic Meal",
        packagePriceSnapshot: 2950,
        includedSelections: [
          { menuItemId: "m-beef", selectionCategory: "meat", name: "Slow Roasted Beef" },
          { menuItemId: "m-chicken", selectionCategory: "meat", name: "Fried Chicken" },
          { menuItemId: "s-green", selectionCategory: "side", name: "Green Beans" },
          { menuItemId: "s-cabbage", selectionCategory: "side", name: "Steamed Cabbage" },
          { menuItemId: "b-rolls", selectionCategory: "bread", name: "Dinner Rolls" },
        ],
      }),
      makeGuest({ id: "g-2", guestIndex: 1 }),
    ];
    const feast = extractSharedFeast(guests);
    expect(feast).not.toBeNull();
    expect(feast!.packageName).toBe("Basic Meal");
    expect(feast!.packagePriceCents).toBe(2950);
    expect(feast!.selections.meat).toHaveLength(2);
    expect(feast!.selections.side).toHaveLength(2);
    expect(feast!.selections.bread).toHaveLength(1);
    expect(feast!.hasSoftDrink).toBe(false);
  });

  it("detects soft drink when a drink selection is present", () => {
    const guests = [
      makeGuest({
        includedSelections: [
          { menuItemId: "d-cola", selectionCategory: "drink", name: "Soft Drink" },
        ],
      }),
      makeGuest({ id: "g-2", guestIndex: 1 }),
    ];
    const feast = extractSharedFeast(guests);
    expect(feast!.hasSoftDrink).toBe(true);
  });

  it("returns null for empty guests", () => {
    expect(extractSharedFeast([])).toBeNull();
  });
});

/* ---- Integration: uniform vs mixed display behavior ---- */

describe("party feast — display behavior integration", () => {
  it("uniform party with no add-ons → shared feast path", () => {
    const sel = [
      { menuItemId: "m-beef", selectionCategory: "meat", name: "Beef" },
      { menuItemId: "s-green", selectionCategory: "side", name: "Green Beans" },
    ];
    const guests = [
      makeGuest({ id: "g-1", guestIndex: 0, includedSelections: [...sel] }),
      makeGuest({ id: "g-2", guestIndex: 1, includedSelections: [...sel] }),
    ];
    expect(isSharedFeast(guests)).toBe(true);
    expect(hasIndividualAddons(guests)).toBe(false);
    // PartyFeastSummary renders SharedFeastCard when both are true.
  });

  it("shared feast + individual add-ons → guest breakdown (add-ons visible)", () => {
    const sel = [{ menuItemId: "m-beef", selectionCategory: "meat", name: "Beef" }];
    const guests = [
      makeGuest({ id: "g-1", guestIndex: 0, includedSelections: [...sel] }),
      makeGuest({
        id: "g-2",
        guestIndex: 1,
        includedSelections: [...sel],
        addons: [
          {
            id: "a-1",
            addonId: "addon-1",
            addonNameSnapshot: "Extra Cornbread",
            pricePerUnitSnapshot: 350,
            quantity: 1,
          },
        ],
      }),
    ];
    expect(isSharedFeast(guests)).toBe(true);
    expect(hasIndividualAddons(guests)).toBe(true);
    // PartyFeastSummary renders GuestBreakdown so the add-on stays visible.
  });

  it("mixed packages → guest breakdown (exceptions visible)", () => {
    const guests = [
      makeGuest({ id: "g-1", packageId: "pkg-basic", packageNameSnapshot: "Basic Meal" }),
      makeGuest({ id: "g-2", packageId: "pkg-premium", packageNameSnapshot: "Premium Meal" }),
    ];
    expect(isSharedFeast(guests)).toBe(false);
    expect(hasMixedPackages(guests)).toBe(true);
    // PartyFeastSummary renders GuestBreakdown so the mixed packages stay visible.
  });
});
