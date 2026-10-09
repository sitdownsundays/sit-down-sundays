/**
 * Party-wide meal validation — behavioral tests.
 *
 * Exercises the REAL production helper validatePartyWideMeal against
 * authoritative OrderingConfigDTO fixtures. No database, no Supabase, no
 * endpoint wiring — the helper exists; public endpoints are NOT yet enforcing
 * it.
 *
 * These are MOCKED-CONFIG tests (no real database). They prove the validation
 * logic, NOT PostgreSQL execution.
 */
import { describe, it, expect } from "vitest";
import {
  validatePartyWideMeal,
  type PartyMealValidationResult,
} from "@/lib/server/party-meal-validation.server";
import type { OrderingConfigDTO } from "@/lib/ordering/types";
import type { ReservationGuestInput } from "@/lib/reservation/types";

const PKG_BASIC = "11111111-0000-4000-8000-000000000001";
const PKG_PREMIUM = "11111111-0000-4000-8000-000000000002";
const MEAT_A = "22222222-0000-4000-8000-000000000001";
const MEAT_B = "22222222-0000-4000-8000-000000000002";
const MEAT_C = "22222222-0000-4000-8000-000000000003";
const SIDE_A = "33333333-0000-4000-8000-000000000001";
const SIDE_B = "33333333-0000-4000-8000-000000000002";
const SIDE_C = "33333333-0000-4000-8000-000000000003";
const BREAD_A = "44444444-0000-4000-8000-000000000001";
const BREAD_B = "44444444-0000-4000-8000-000000000002";

function makeBasicConfig(): OrderingConfigDTO {
  return {
    packages: [
      {
        id: PKG_BASIC,
        name: "Basic Meal",
        slug: "basic-meal",
        description: "",
        pricePerPersonCents: 2950,
        includedMeatsCount: 2,
        includedSidesCount: 2,
        includesBread: true,
        includesSoftDrink: true,
        isActive: true,
        displayOrder: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdBy: null,
        updatedBy: null,
        eligibleItems: [
          {
            id: "e1",
            packageId: PKG_BASIC,
            menuItemId: MEAT_A,
            menuItemName: "Beef",
            selectionCategory: "meat",
          },
          {
            id: "e2",
            packageId: PKG_BASIC,
            menuItemId: MEAT_B,
            menuItemName: "Chicken",
            selectionCategory: "meat",
          },
          {
            id: "e3",
            packageId: PKG_BASIC,
            menuItemId: MEAT_C,
            menuItemName: "Meatballs",
            selectionCategory: "meat",
          },
          {
            id: "e4",
            packageId: PKG_BASIC,
            menuItemId: SIDE_A,
            menuItemName: "Green Beans",
            selectionCategory: "side",
          },
          {
            id: "e5",
            packageId: PKG_BASIC,
            menuItemId: SIDE_B,
            menuItemName: "Cabbage",
            selectionCategory: "side",
          },
          {
            id: "e6",
            packageId: PKG_BASIC,
            menuItemId: BREAD_A,
            menuItemName: "Rolls",
            selectionCategory: "bread",
          },
          {
            id: "e7",
            packageId: PKG_BASIC,
            menuItemId: BREAD_B,
            menuItemName: "Cornbread",
            selectionCategory: "bread",
          },
        ],
      },
      {
        id: PKG_PREMIUM,
        name: "Premium Meal",
        slug: "premium-meal",
        description: "",
        pricePerPersonCents: 4450,
        includedMeatsCount: 2,
        includedSidesCount: 3,
        includesBread: true,
        includesSoftDrink: true,
        isActive: true,
        displayOrder: 30,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdBy: null,
        updatedBy: null,
        eligibleItems: [
          {
            id: "p1",
            packageId: PKG_PREMIUM,
            menuItemId: MEAT_A,
            menuItemName: "Beef",
            selectionCategory: "meat",
          },
          {
            id: "p2",
            packageId: PKG_PREMIUM,
            menuItemId: MEAT_B,
            menuItemName: "Chicken",
            selectionCategory: "meat",
          },
          {
            id: "p3",
            packageId: PKG_PREMIUM,
            menuItemId: SIDE_A,
            menuItemName: "Green Beans",
            selectionCategory: "side",
          },
          {
            id: "p4",
            packageId: PKG_PREMIUM,
            menuItemId: SIDE_B,
            menuItemName: "Cabbage",
            selectionCategory: "side",
          },
          {
            id: "p5",
            packageId: PKG_PREMIUM,
            menuItemId: SIDE_C,
            menuItemName: "Corn",
            selectionCategory: "side",
          },
          {
            id: "p6",
            packageId: PKG_PREMIUM,
            menuItemId: BREAD_A,
            menuItemName: "Rolls",
            selectionCategory: "bread",
          },
        ],
      },
    ],
    addons: [],
    platters: [],
    guestPricingRules: null,
  };
}

/** A complete, valid guest allocation for the Basic Meal (2 meats, 2 sides, 1 bread). */
function makeValidGuest(
  index: number,
  overrides: Partial<ReservationGuestInput> = {},
): ReservationGuestInput {
  return {
    guestIndex: index,
    category: "adult",
    name: `Guest ${index + 1}`,
    packageId: PKG_BASIC,
    included: [
      { menuItemId: MEAT_A, selectionCategory: "meat" },
      { menuItemId: MEAT_B, selectionCategory: "meat" },
      { menuItemId: SIDE_A, selectionCategory: "side" },
      { menuItemId: SIDE_B, selectionCategory: "side" },
      { menuItemId: BREAD_A, selectionCategory: "bread" },
    ],
    addons: [],
    ...overrides,
  };
}

function expectOk(result: PartyMealValidationResult): void {
  expect(result.ok).toBe(true);
}

function expectFail(result: PartyMealValidationResult, code: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe(code);
  }
}

describe("validatePartyWideMeal", () => {
  // ------------------------------------------------------------------
  // VALID
  // ------------------------------------------------------------------
  describe("valid party-wide meals", () => {
    it("accepts a valid identical meal across all guests", () => {
      const config = makeBasicConfig();
      const guests = [makeValidGuest(0), makeValidGuest(1), makeValidGuest(2)];
      expectOk(validatePartyWideMeal(guests, config));
    });

    it("accepts identical selections in different array orders across guests", () => {
      const config = makeBasicConfig();
      const reversedIncluded = [
        { menuItemId: BREAD_A, selectionCategory: "bread" as const },
        { menuItemId: SIDE_B, selectionCategory: "side" as const },
        { menuItemId: SIDE_A, selectionCategory: "side" as const },
        { menuItemId: MEAT_B, selectionCategory: "meat" as const },
        { menuItemId: MEAT_A, selectionCategory: "meat" as const },
      ];
      const guests = [makeValidGuest(0), makeValidGuest(1, { included: reversedIncluded })];
      expectOk(validatePartyWideMeal(guests, config));
    });

    it("accepts a premium meal with 3 sides", () => {
      const config = makeBasicConfig();
      const premiumGuest: ReservationGuestInput = {
        guestIndex: 0,
        category: "adult",
        name: "Guest 1",
        packageId: PKG_PREMIUM,
        included: [
          { menuItemId: MEAT_A, selectionCategory: "meat" },
          { menuItemId: MEAT_B, selectionCategory: "meat" },
          { menuItemId: SIDE_A, selectionCategory: "side" },
          { menuItemId: SIDE_B, selectionCategory: "side" },
          { menuItemId: SIDE_C, selectionCategory: "side" },
          { menuItemId: BREAD_A, selectionCategory: "bread" },
        ],
        addons: [],
      };
      const guests = [premiumGuest, { ...premiumGuest, guestIndex: 1, name: "Guest 2" }];
      expectOk(validatePartyWideMeal(guests, config));
    });
  });

  // ------------------------------------------------------------------
  // EMPTY / MISSING PACKAGE
  // ------------------------------------------------------------------
  describe("empty party and missing package", () => {
    it("rejects an empty party", () => {
      const config = makeBasicConfig();
      expectFail(validatePartyWideMeal([], config), "empty_party");
    });

    it("rejects when a guest has no packageId", () => {
      const config = makeBasicConfig();
      const guests = [makeValidGuest(0), makeValidGuest(1, { packageId: "" })];
      expectFail(validatePartyWideMeal(guests, config), "missing_package");
    });

    it("rejects when the package is not found or inactive", () => {
      const config = makeBasicConfig();
      const inactiveConfig: OrderingConfigDTO = {
        ...config,
        packages: config.packages.map((p) => (p.id === PKG_BASIC ? { ...p, isActive: false } : p)),
      };
      const guests = [makeValidGuest(0), makeValidGuest(1)];
      expectFail(validatePartyWideMeal(guests, inactiveConfig), "missing_package");
    });
  });

  // ------------------------------------------------------------------
  // MIXED PACKAGES
  // ------------------------------------------------------------------
  describe("mixed packages", () => {
    it("rejects guests with different packages", () => {
      const config = makeBasicConfig();
      const guests = [makeValidGuest(0), makeValidGuest(1, { packageId: PKG_PREMIUM })];
      expectFail(validatePartyWideMeal(guests, config), "mixed_packages");
    });
  });

  // ------------------------------------------------------------------
  // MISMATCHED SELECTIONS
  // ------------------------------------------------------------------
  describe("mismatched selections across guests", () => {
    it("rejects when guests have different meat choices", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0),
        makeValidGuest(1, {
          included: [
            { menuItemId: MEAT_C, selectionCategory: "meat" },
            { menuItemId: MEAT_B, selectionCategory: "meat" },
            { menuItemId: SIDE_A, selectionCategory: "side" },
            { menuItemId: SIDE_B, selectionCategory: "side" },
            { menuItemId: BREAD_A, selectionCategory: "bread" },
          ],
        }),
      ];
      expectFail(validatePartyWideMeal(guests, config), "mismatched_selections");
    });

    it("rejects when guests have different bread choices", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0),
        makeValidGuest(1, {
          included: [
            { menuItemId: MEAT_A, selectionCategory: "meat" },
            { menuItemId: MEAT_B, selectionCategory: "meat" },
            { menuItemId: SIDE_A, selectionCategory: "side" },
            { menuItemId: SIDE_B, selectionCategory: "side" },
            { menuItemId: BREAD_B, selectionCategory: "bread" },
          ],
        }),
      ];
      expectFail(validatePartyWideMeal(guests, config), "mismatched_selections");
    });

    it("rejects when guests have different selection counts", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0),
        makeValidGuest(1, {
          included: [
            { menuItemId: MEAT_A, selectionCategory: "meat" },
            { menuItemId: MEAT_B, selectionCategory: "meat" },
            { menuItemId: SIDE_A, selectionCategory: "side" },
            { menuItemId: BREAD_A, selectionCategory: "bread" },
          ],
        }),
      ];
      expectFail(validatePartyWideMeal(guests, config), "mismatched_selections");
    });
  });

  // ------------------------------------------------------------------
  // DUPLICATE SELECTIONS
  // ------------------------------------------------------------------
  describe("duplicate selections", () => {
    it("rejects the same meat selected twice within one guest", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0, {
          included: [
            { menuItemId: MEAT_A, selectionCategory: "meat" },
            { menuItemId: MEAT_A, selectionCategory: "meat" },
            { menuItemId: SIDE_A, selectionCategory: "side" },
            { menuItemId: SIDE_B, selectionCategory: "side" },
            { menuItemId: BREAD_A, selectionCategory: "bread" },
          ],
        }),
      ];
      expectFail(validatePartyWideMeal(guests, config), "duplicate_selections");
    });

    it("rejects the same side selected twice within one guest", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0, {
          included: [
            { menuItemId: MEAT_A, selectionCategory: "meat" },
            { menuItemId: MEAT_B, selectionCategory: "meat" },
            { menuItemId: SIDE_A, selectionCategory: "side" },
            { menuItemId: SIDE_A, selectionCategory: "side" },
            { menuItemId: BREAD_A, selectionCategory: "bread" },
          ],
        }),
      ];
      expectFail(validatePartyWideMeal(guests, config), "duplicate_selections");
    });
  });

  // ------------------------------------------------------------------
  // INCORRECT COUNTS
  // ------------------------------------------------------------------
  describe("incorrect meat/side counts", () => {
    it("rejects too few meats (1 of 2)", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0, {
          included: [
            { menuItemId: MEAT_A, selectionCategory: "meat" },
            { menuItemId: SIDE_A, selectionCategory: "side" },
            { menuItemId: SIDE_B, selectionCategory: "side" },
            { menuItemId: BREAD_A, selectionCategory: "bread" },
          ],
        }),
      ];
      expectFail(validatePartyWideMeal(guests, config), "invalid_meat_count");
    });

    it("rejects too many meats (3 of 2)", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0, {
          included: [
            { menuItemId: MEAT_A, selectionCategory: "meat" },
            { menuItemId: MEAT_B, selectionCategory: "meat" },
            { menuItemId: MEAT_C, selectionCategory: "meat" },
            { menuItemId: SIDE_A, selectionCategory: "side" },
            { menuItemId: SIDE_B, selectionCategory: "side" },
            { menuItemId: BREAD_A, selectionCategory: "bread" },
          ],
        }),
      ];
      expectFail(validatePartyWideMeal(guests, config), "invalid_meat_count");
    });

    it("rejects too few sides (1 of 2)", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0, {
          included: [
            { menuItemId: MEAT_A, selectionCategory: "meat" },
            { menuItemId: MEAT_B, selectionCategory: "meat" },
            { menuItemId: SIDE_A, selectionCategory: "side" },
            { menuItemId: BREAD_A, selectionCategory: "bread" },
          ],
        }),
      ];
      expectFail(validatePartyWideMeal(guests, config), "invalid_side_count");
    });

    it("rejects too many sides (3 of 2 for Basic)", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0, {
          included: [
            { menuItemId: MEAT_A, selectionCategory: "meat" },
            { menuItemId: MEAT_B, selectionCategory: "meat" },
            { menuItemId: SIDE_A, selectionCategory: "side" },
            { menuItemId: SIDE_B, selectionCategory: "side" },
            // SIDE_C is not eligible for Basic, but count check fires first
            { menuItemId: SIDE_A, selectionCategory: "side" },
            { menuItemId: BREAD_A, selectionCategory: "bread" },
          ],
        }),
      ];
      // duplicate_selections fires because SIDE_A is listed twice
      expectFail(validatePartyWideMeal(guests, config), "duplicate_selections");
    });

    it("rejects premium with too few sides (2 of 3)", () => {
      const config = makeBasicConfig();
      const premiumGuest: ReservationGuestInput = {
        guestIndex: 0,
        category: "adult",
        name: "Guest 1",
        packageId: PKG_PREMIUM,
        included: [
          { menuItemId: MEAT_A, selectionCategory: "meat" },
          { menuItemId: MEAT_B, selectionCategory: "meat" },
          { menuItemId: SIDE_A, selectionCategory: "side" },
          { menuItemId: SIDE_B, selectionCategory: "side" },
          { menuItemId: BREAD_A, selectionCategory: "bread" },
        ],
        addons: [],
      };
      expectFail(validatePartyWideMeal([premiumGuest], config), "invalid_side_count");
    });
  });

  // ------------------------------------------------------------------
  // BREAD
  // ------------------------------------------------------------------
  describe("bread selections", () => {
    it("rejects missing bread when the package includes bread", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0, {
          included: [
            { menuItemId: MEAT_A, selectionCategory: "meat" },
            { menuItemId: MEAT_B, selectionCategory: "meat" },
            { menuItemId: SIDE_A, selectionCategory: "side" },
            { menuItemId: SIDE_B, selectionCategory: "side" },
          ],
        }),
      ];
      expectFail(validatePartyWideMeal(guests, config), "missing_bread");
    });

    it("rejects multiple bread selections", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0, {
          included: [
            { menuItemId: MEAT_A, selectionCategory: "meat" },
            { menuItemId: MEAT_B, selectionCategory: "meat" },
            { menuItemId: SIDE_A, selectionCategory: "side" },
            { menuItemId: SIDE_B, selectionCategory: "side" },
            { menuItemId: BREAD_A, selectionCategory: "bread" },
            { menuItemId: BREAD_B, selectionCategory: "bread" },
          ],
        }),
      ];
      expectFail(validatePartyWideMeal(guests, config), "multiple_bread");
    });

    it("rejects bread when the package does not include bread", () => {
      const config = makeBasicConfig();
      const noBreadConfig: OrderingConfigDTO = {
        ...config,
        packages: config.packages.map((p) =>
          p.id === PKG_BASIC ? { ...p, includesBread: false } : p,
        ),
      };
      const guests = [
        makeValidGuest(0, {
          included: [
            { menuItemId: MEAT_A, selectionCategory: "meat" },
            { menuItemId: MEAT_B, selectionCategory: "meat" },
            { menuItemId: SIDE_A, selectionCategory: "side" },
            { menuItemId: SIDE_B, selectionCategory: "side" },
            { menuItemId: BREAD_A, selectionCategory: "bread" },
          ],
        }),
      ];
      expectFail(validatePartyWideMeal(guests, noBreadConfig), "multiple_bread");
    });
  });

  // ------------------------------------------------------------------
  // INELIGIBLE SELECTIONS
  // ------------------------------------------------------------------
  describe("ineligible selections", () => {
    it("rejects a meat not eligible for the package", () => {
      const config = makeBasicConfig();
      const ineligibleMeat = "99999999-0000-4000-8000-000000000001";
      const guests = [
        makeValidGuest(0, {
          included: [
            { menuItemId: ineligibleMeat, selectionCategory: "meat" },
            { menuItemId: MEAT_B, selectionCategory: "meat" },
            { menuItemId: SIDE_A, selectionCategory: "side" },
            { menuItemId: SIDE_B, selectionCategory: "side" },
            { menuItemId: BREAD_A, selectionCategory: "bread" },
          ],
        }),
      ];
      expectFail(validatePartyWideMeal(guests, config), "ineligible_selection");
    });

    it("rejects a side not eligible for the package", () => {
      const config = makeBasicConfig();
      // SIDE_C is eligible for Premium but not Basic
      const guests = [
        makeValidGuest(0, {
          included: [
            { menuItemId: MEAT_A, selectionCategory: "meat" },
            { menuItemId: MEAT_B, selectionCategory: "meat" },
            { menuItemId: SIDE_C, selectionCategory: "side" },
            { menuItemId: SIDE_B, selectionCategory: "side" },
            { menuItemId: BREAD_A, selectionCategory: "bread" },
          ],
        }),
      ];
      expectFail(validatePartyWideMeal(guests, config), "ineligible_selection");
    });

    it("rejects a bread not eligible for the package", () => {
      const config = makeBasicConfig();
      const ineligibleBread = "99999999-0000-4000-8000-000000000002";
      const guests = [
        makeValidGuest(0, {
          included: [
            { menuItemId: MEAT_A, selectionCategory: "meat" },
            { menuItemId: MEAT_B, selectionCategory: "meat" },
            { menuItemId: SIDE_A, selectionCategory: "side" },
            { menuItemId: SIDE_B, selectionCategory: "side" },
            { menuItemId: ineligibleBread, selectionCategory: "bread" },
          ],
        }),
      ];
      expectFail(validatePartyWideMeal(guests, config), "ineligible_selection");
    });

    it("rejects a selection in the wrong category (side submitted as meat)", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0, {
          included: [
            { menuItemId: SIDE_A, selectionCategory: "meat" },
            { menuItemId: MEAT_B, selectionCategory: "meat" },
            { menuItemId: SIDE_A, selectionCategory: "side" },
            { menuItemId: SIDE_B, selectionCategory: "side" },
            { menuItemId: BREAD_A, selectionCategory: "bread" },
          ],
        }),
      ];
      // SIDE_A is eligible as "side" but not as "meat"
      expectFail(validatePartyWideMeal(guests, config), "ineligible_selection");
    });
  });

  // ------------------------------------------------------------------
  // INDIVIDUAL ADD-ONS
  // ------------------------------------------------------------------
  describe("individual paid add-ons", () => {
    it("rejects any individual add-on in public party ordering", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0, {
          addons: [{ addonId: "55555555-0000-4000-8000-000000000001", quantity: 1 }],
        }),
        makeValidGuest(1),
      ];
      expectFail(validatePartyWideMeal(guests, config), "individual_addons_not_allowed");
    });

    it("rejects add-ons even on a single guest", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0, {
          addons: [{ addonId: "55555555-0000-4000-8000-000000000001", quantity: 2 }],
        }),
      ];
      expectFail(validatePartyWideMeal(guests, config), "individual_addons_not_allowed");
    });
  });

  // ------------------------------------------------------------------
  // GUEST-SPECIFIC INFORMATION
  // ------------------------------------------------------------------
  describe("guest-specific information", () => {
    it("does not require identical guest names or categories", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0, { name: "Alice", category: "adult" }),
        makeValidGuest(1, { name: "Bob", category: "senior" }),
        makeValidGuest(2, { name: undefined, category: "child" }),
      ];
      expectOk(validatePartyWideMeal(guests, config));
    });

    it("does not mutate the input guest allocations", () => {
      const config = makeBasicConfig();
      const guests = [makeValidGuest(0), makeValidGuest(1)];
      const snapshot = JSON.parse(JSON.stringify(guests));
      validatePartyWideMeal(guests, config);
      expect(guests).toEqual(snapshot);
    });
  });
});
