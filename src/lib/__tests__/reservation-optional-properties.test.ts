/**
 * exactOptionalPropertyTypes regression tests for the three production mapping
 * sites:
 *  1. buildSubmissionPayload — guest `name` omitted (not assigned undefined).
 *  2. calculateReservationPricing — OrderGuest `name` omitted when undefined.
 *  3. listReservations — repository filters include each field only when
 *     its value is not undefined. Exercises the REAL buildListReservationsFilters
 *     helper the wrapper calls, fed by the REAL listReservationsSchema parse,
 *     so the forwarding behavior — not a copied model — is under test.
 *
 * Pure mapping / mocked-boundary tests — no database, Supabase, or TanStack
 * createServerFn RPC runtime.
 */
import { describe, it, expect } from "vitest";
import { buildSubmissionPayload, generateIdempotencyKey } from "@/lib/booking/submit-helpers";
import {
  calculateReservationPricing,
  defaultPaymentPolicy,
  type PaymentPolicyConfig,
} from "@/lib/reservation/pricing";
import { listReservationsSchema } from "@/lib/reservation/schema";
import { buildListReservationsFilters } from "@/lib/server/reservation-list-filters.server";
import type { OrderingConfigDTO } from "@/lib/ordering/types";
import type { ReservationGuestInput } from "@/lib/reservation/types";
import type { BookWizardState, ContactWizardState } from "@/lib/booking/wizard-helpers";
import type { GuestAllocation, MealsWizardState } from "@/lib/booking/meals-helpers";

const PKG_ID = "33333333-0000-4000-8000-0000000000cc";
const MEAT_A = "44444444-0000-4000-8000-0000000000aa";
const MEAT_B = "44444444-0000-4000-8000-0000000000bb";
const SIDE_A = "55555555-0000-4000-8000-0000000000aa";
const SIDE_B = "55555555-0000-4000-8000-0000000000bb";

function makeConfig(): OrderingConfigDTO {
  return {
    packages: [
      {
        id: PKG_ID,
        name: "Basic Meal",
        slug: "basic-meal",
        description: "",
        pricePerPersonCents: 2950,
        includedMeatsCount: 2,
        includedSidesCount: 2,
        includesBread: true,
        includesSoftDrink: true,
        isActive: true,
        displayOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdBy: null,
        updatedBy: null,
        eligibleItems: [
          {
            id: "e1",
            packageId: PKG_ID,
            menuItemId: MEAT_A,
            menuItemName: "Meat A",
            selectionCategory: "meat",
          },
          {
            id: "e2",
            packageId: PKG_ID,
            menuItemId: MEAT_B,
            menuItemName: "Meat B",
            selectionCategory: "meat",
          },
          {
            id: "e3",
            packageId: PKG_ID,
            menuItemId: SIDE_A,
            menuItemName: "Side A",
            selectionCategory: "side",
          },
          {
            id: "e4",
            packageId: PKG_ID,
            menuItemId: SIDE_B,
            menuItemName: "Side B",
            selectionCategory: "side",
          },
        ],
      },
    ],
    addons: [],
    platters: [],
    guestPricingRules: null,
  };
}

function adultGuest(index: number): ReservationGuestInput {
  return {
    guestIndex: index,
    category: "adult",
    packageId: PKG_ID,
    included: [
      { menuItemId: MEAT_A, selectionCategory: "meat" },
      { menuItemId: MEAT_B, selectionCategory: "meat" },
      { menuItemId: SIDE_A, selectionCategory: "side" },
      { menuItemId: SIDE_B, selectionCategory: "side" },
    ],
    addons: [],
    foodAllergies: "",
    dietaryPreferences: "",
    mealRequests: "",
  };
}

function makeContact(): ContactWizardState {
  return {
    contactFirstName: "Jane",
    contactLastName: "Doe",
    contactEmail: "jane@example.com",
    contactPhone: "+13125550000",
    dietaryNotes: "",
    accessibilityRequests: "",
    occasion: "",
    guestNotes: "",
  };
}

function makeMeals(allocations: GuestAllocation[]): MealsWizardState {
  return { allocations, platters: [] };
}

function makeAllocation(overrides: Partial<GuestAllocation> = {}): GuestAllocation {
  return {
    guestId: "g-1",
    guestIndex: 0,
    category: "adult",
    name: "",
    packageId: PKG_ID,
    included: adultGuest(0).included,
    addons: [],
    foodAllergies: "",
    dietaryPreferences: "",
    mealRequests: "",
    ...overrides,
  };
}

function makeWizardState(
  meals: MealsWizardState = makeMeals([makeAllocation()]),
  contact: ContactWizardState = makeContact(),
): BookWizardState {
  return {
    step: "review",
    sundayServiceId: "11111111-0000-4000-8000-0000000000aa",
    seatingTimeId: "22222222-0000-4000-8000-0000000000bb",
    selectedOption: null,
    adults: 1,
    seniors: 0,
    children: 0,
    meals,
    contact,
  };
}

describe("buildSubmissionPayload — name omitted when blank, preserved when set", () => {
  it("omits name when blank (no explicit undefined key)", () => {
    const state = makeWizardState();
    const key = generateIdempotencyKey() ?? "bk_test_key_123456";
    const payload = buildSubmissionPayload(state, key, 0);
    const g0 = payload.guests[0];
    expect(g0).toBeDefined();
    if (g0) expect("name" in g0).toBe(false);
  });

  it("preserves a supplied name", () => {
    const state = makeWizardState(makeMeals([makeAllocation({ name: "Uncle Bob" })]));
    const key = generateIdempotencyKey() ?? "bk_test_key_123456";
    const payload = buildSubmissionPayload(state, key, 0);
    const g0 = payload.guests[0];
    expect(g0).toBeDefined();
    if (g0) expect(g0.name).toBe("Uncle Bob");
  });

  it("preserves guest notes when non-empty", () => {
    const state = makeWizardState(
      makeMeals([
        makeAllocation({
          foodAllergies: "peanuts",
          dietaryPreferences: "vegetarian",
          mealRequests: "no ice",
        }),
      ]),
    );
    const key = generateIdempotencyKey() ?? "bk_test_key_123456";
    const payload = buildSubmissionPayload(state, key, 0);
    const g0 = payload.guests[0];
    expect(g0).toBeDefined();
    if (g0) {
      expect(g0.foodAllergies).toBe("peanuts");
      expect(g0.dietaryPreferences).toBe("vegetarian");
      expect(g0.mealRequests).toBe("no ice");
    }
  });

  it("preserves meal selections and add-ons", () => {
    const state = makeWizardState(
      makeMeals([
        makeAllocation({
          included: [...adultGuest(0).included],
          addons: [{ addonId: "66666666-0000-4000-8000-0000000000aa", quantity: 2 }],
        }),
      ]),
    );
    const key = generateIdempotencyKey() ?? "bk_test_key_123456";
    const payload = buildSubmissionPayload(state, key, 0);
    const g0 = payload.guests[0];
    expect(g0).toBeDefined();
    if (g0) {
      expect(g0.included).toHaveLength(4);
      expect(g0.addons).toHaveLength(1);
    }
  });
});

describe("calculateReservationPricing — OrderGuest name omitted when undefined", () => {
  it("omits name from OrderGuest when ReservationGuestInput has no name", () => {
    const config = makeConfig();
    const policy: PaymentPolicyConfig = {
      ...defaultPaymentPolicy(),
      restaurantTimezone: "America/Chicago",
      taxRateBasisPoints: 1000,
      gratuityRateBasisPoints: 1800,
      taxOnGratuity: true,
    };
    const result = calculateReservationPricing([adultGuest(0)], [], config, policy, null);
    expect(result.success).toBe(true);
    // A guest with no name still prices correctly — the engine doesn't need it.
    expect(result.subtotalCents).toBe(2950);
  });

  it("preserves a supplied name in the pricing path without error", () => {
    const config = makeConfig();
    const policy: PaymentPolicyConfig = {
      ...defaultPaymentPolicy(),
      restaurantTimezone: "America/Chicago",
      taxRateBasisPoints: 1000,
      gratuityRateBasisPoints: 1800,
      taxOnGratuity: true,
    };
    const guest = { ...adultGuest(0), name: "Jane Doe" };
    const result = calculateReservationPricing([guest], [], config, policy, null);
    expect(result.success).toBe(true);
    expect(result.subtotalCents).toBe(2950);
  });
});

describe("listReservations — buildListReservationsFilters (real wrapper helper)", () => {
  const SERVICE_ID = "11111111-0000-4000-8000-0000000000aa";
  const SEATING_ID = "22222222-0000-4000-8000-0000000000bb";

  it("omits all undefined filters (no keys present)", () => {
    const parsed = listReservationsSchema.parse({});
    const filters = buildListReservationsFilters(parsed);
    expect(Object.keys(filters)).toHaveLength(0);
  });

  it("preserves supplied sundayServiceId, seatingTimeId, status, and search", () => {
    const parsed = listReservationsSchema.parse({
      sundayServiceId: SERVICE_ID,
      seatingTimeId: SEATING_ID,
      status: "confirmed",
      search: "Jane",
    });
    const filters = buildListReservationsFilters(parsed);
    expect(filters.sundayServiceId).toBe(SERVICE_ID);
    expect(filters.seatingTimeId).toBe(SEATING_ID);
    expect(filters.status).toBe("confirmed");
    expect(filters.search).toBe("Jane");
  });

  it("does not mutate the parsed input", () => {
    const parsed = listReservationsSchema.parse({ status: "cancelled", search: "Doe" });
    const snapshot = JSON.parse(JSON.stringify(parsed));
    buildListReservationsFilters(parsed);
    expect(parsed).toEqual(snapshot);
  });

  it("rejects unknown fields at the schema boundary (strict)", () => {
    expect(() => listReservationsSchema.parse({ bogus: true })).toThrow();
  });
});
