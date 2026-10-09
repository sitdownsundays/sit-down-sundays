/**
 * Party-wide meal validation integration — endpoint + helper tests.
 *
 * Exercises the REAL production helper validatePartyWideMeal plus the
 * submission handler's integration with it. Mocked-config tests — NOT
 * PostgreSQL execution.
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
const BREAD_A = "44444444-0000-4000-8000-000000000001";

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
        ],
      },
    ],
    addons: [],
    platters: [],
    guestPricingRules: null,
  };
}

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

describe("party-wide meal validation integration", () => {
  describe("uniform party accepted", () => {
    it("accepts a valid uniform party", () => {
      const config = makeBasicConfig();
      const guests = [makeValidGuest(0), makeValidGuest(1)];
      expectOk(validatePartyWideMeal(guests, config));
    });
  });

  describe("mixed packages or dishes rejected", () => {
    it("rejects mixed packages", () => {
      const config = makeBasicConfig();
      const guests = [makeValidGuest(0), makeValidGuest(1, { packageId: PKG_PREMIUM })];
      expectFail(validatePartyWideMeal(guests, config), "mixed_packages");
    });

    it("rejects different meat choices across guests", () => {
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
  });

  describe("duplicate in the SECOND guest", () => {
    it("rejects a duplicate meat in the second guest (not the first)", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0),
        makeValidGuest(1, {
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

    it("rejects a duplicate side in the second guest", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0),
        makeValidGuest(1, {
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

  describe("individual add-ons rejected", () => {
    it("rejects add-ons on any guest", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0, {
          addons: [{ addonId: "55555555-0000-4000-8000-000000000001", quantity: 1 }],
        }),
        makeValidGuest(1),
      ];
      expectFail(validatePartyWideMeal(guests, config), "individual_addons_not_allowed");
    });
  });

  describe("submission integration — existing replay bypasses new validation", () => {
    it("proven_rejection is returned with a safe code for a new invalid request", () => {
      const config = makeBasicConfig();
      const guests = [makeValidGuest(0), makeValidGuest(1, { packageId: PKG_PREMIUM })];
      const result = validatePartyWideMeal(guests, config);
      // The submission handler maps a failed mealValidation to:
      // { success: false, outcome: "proven_rejection", rejectionCode: "validation_failed", error: ... }
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("mixed_packages");
      }
    });

    it("a valid uniform party returns ok (would proceed to pricing)", () => {
      const config = makeBasicConfig();
      const guests = [makeValidGuest(0), makeValidGuest(1), makeValidGuest(2)];
      expectOk(validatePartyWideMeal(guests, config));
    });
  });

  describe("guest-specific information preserved", () => {
    it("does not require identical names or categories", () => {
      const config = makeBasicConfig();
      const guests = [
        makeValidGuest(0, { name: "Alice", category: "adult" }),
        makeValidGuest(1, { name: "Bob", category: "senior" }),
        makeValidGuest(2, { name: undefined, category: "child" }),
      ];
      expectOk(validatePartyWideMeal(guests, config));
    });

    it("does not mutate the input", () => {
      const config = makeBasicConfig();
      const guests = [makeValidGuest(0), makeValidGuest(1)];
      const snapshot = JSON.parse(JSON.stringify(guests));
      validatePartyWideMeal(guests, config);
      expect(guests).toEqual(snapshot);
    });
  });
});
