/**
 * Focused tests for per-guest note fields (foodAllergies, dietaryPreferences,
 * mealRequests).
 *
 * Exercises the REAL production helpers: buildAllocations, reconcileAllocations,
 * reconcileSharedFeast, copyMealToGuests, applyPackage, toggleSharedSelection,
 * and buildSubmissionPayload. Also tests the reservation submission schema's
 * validation of these fields.
 *
 * Helper-level tests, NOT rendered component tests and NOT live server tests.
 */
import { describe, it, expect } from "vitest";
import {
  buildAllocations,
  reconcileAllocations,
  reconcileSharedFeast,
  copyMealToGuests,
  applyPackage,
  toggleSharedSelection,
  type GuestAllocation,
} from "@/lib/booking/meals-helpers";
import { buildSubmissionPayload } from "@/lib/booking/submit-helpers";
import { initialWizardState } from "@/lib/booking/wizard-helpers";
import type { BookWizardState } from "@/lib/booking/wizard-helpers";
import { submitReservationRequestSchema } from "@/lib/reservation/schema";
import type { PublicMealPackage } from "@/lib/booking/public-catalog";

const PKG: PublicMealPackage = {
  id: "pkg-basic",
  name: "Basic Meal",
  description: "",
  pricePerPersonCents: 2950,
  includedMeatsCount: 2,
  includedSidesCount: 2,
  includesBread: true,
  includesSoftDrink: true,
  displayOrder: 0,
  eligibleItems: [
    { menuItemId: "m1", menuItemName: "Beef", selectionCategory: "meat" },
    { menuItemId: "m2", menuItemName: "Chicken", selectionCategory: "meat" },
    { menuItemId: "s1", menuItemName: "Beans", selectionCategory: "side" },
    { menuItemId: "s2", menuItemName: "Corn", selectionCategory: "side" },
    { menuItemId: "b1", menuItemName: "Rolls", selectionCategory: "bread" },
  ],
};

function makeState(allocations: GuestAllocation[]): BookWizardState {
  const s = initialWizardState();
  return {
    ...s,
    adults: allocations.length,
    seniors: 0,
    children: 0,
    sundayServiceId: "svc-1",
    seatingTimeId: "seat-1",
    meals: { allocations, platters: [] },
    contact: {
      ...s.contact,
      contactFirstName: "Test",
      contactLastName: "User",
      contactEmail: "test@example.com",
      contactPhone: "555-0100",
    },
  };
}

describe("per-guest notes — buildAllocations", () => {
  it("initializes new guests with empty note strings", () => {
    const allocs = buildAllocations(2, 0, 0);
    for (const a of allocs) {
      expect(a.foodAllergies).toBe("");
      expect(a.dietaryPreferences).toBe("");
      expect(a.mealRequests).toBe("");
    }
  });
});

describe("per-guest notes — reconcileAllocations", () => {
  it("preserves personal notes on retained guests", () => {
    const initial = buildAllocations(2, 0, 0);
    const withNotes = initial.map((a, i) =>
      i === 0
        ? {
            ...a,
            foodAllergies: "peanuts",
            dietaryPreferences: "vegetarian",
            mealRequests: "no salt",
          }
        : a,
    );
    const result = reconcileAllocations(withNotes, 2, 0, 0);
    expect(result.allocations[0]?.foodAllergies).toBe("peanuts");
    expect(result.allocations[0]?.dietaryPreferences).toBe("vegetarian");
    expect(result.allocations[0]?.mealRequests).toBe("no salt");
  });

  it("newly added guests start with empty notes (do not inherit)", () => {
    const initial = buildAllocations(1, 0, 0);
    const withNotes = initial.map((a) => ({
      ...a,
      foodAllergies: "shellfish",
      dietaryPreferences: "gluten-free",
      mealRequests: "extra gravy",
    }));
    const result = reconcileAllocations(withNotes, 2, 0, 0);
    // New guest (index 1) has empty notes — did NOT inherit from guest 0.
    expect(result.allocations[1]?.foodAllergies).toBe("");
    expect(result.allocations[1]?.dietaryPreferences).toBe("");
    expect(result.allocations[1]?.mealRequests).toBe("");
  });
});

describe("per-guest notes — reconcileSharedFeast", () => {
  it("preserves personal notes when new guests inherit the shared feast", () => {
    const initial = buildAllocations(2, 0, 0);
    // Give both guests a uniform package + selections + personal notes.
    const withFeast = initial.map((a, i) => ({
      ...a,
      packageId: "pkg-basic",
      included: [
        { menuItemId: "m1", selectionCategory: "meat" },
        { menuItemId: "m2", selectionCategory: "meat" },
        { menuItemId: "s1", selectionCategory: "side" },
        { menuItemId: "s2", selectionCategory: "side" },
        { menuItemId: "b1", selectionCategory: "bread" },
      ],
      foodAllergies: i === 0 ? "peanuts" : "dairy",
      dietaryPreferences: i === 0 ? "vegetarian" : "",
      mealRequests: i === 0 ? "no salt" : "",
    }));

    // Add a third guest — should inherit the shared feast but NOT notes.
    const result = reconcileSharedFeast(withFeast, 3, 0, 0);
    expect(result.allocations).toHaveLength(3);

    // New guest (index 2) inherits the package + selections.
    expect(result.allocations[2]?.packageId).toBe("pkg-basic");
    expect(result.allocations[2]?.included).toHaveLength(5);
    // But does NOT inherit any notes.
    expect(result.allocations[2]?.foodAllergies).toBe("");
    expect(result.allocations[2]?.dietaryPreferences).toBe("");
    expect(result.allocations[2]?.mealRequests).toBe("");

    // Existing guests keep their own notes.
    expect(result.allocations[0]?.foodAllergies).toBe("peanuts");
    expect(result.allocations[1]?.foodAllergies).toBe("dairy");
  });
});

describe("per-guest notes — copyMealToGuests", () => {
  it("copies package + selections but NOT personal notes", () => {
    const allocs = buildAllocations(2, 0, 0);
    const source = {
      ...allocs[0]!,
      packageId: "pkg-basic",
      included: [{ menuItemId: "m1", selectionCategory: "meat" }],
      foodAllergies: "peanuts",
      dietaryPreferences: "vegetarian",
      mealRequests: "no salt",
    };
    const target = {
      ...allocs[1]!,
      foodAllergies: "dairy",
      dietaryPreferences: "keto",
      mealRequests: "well done",
    };
    const result = copyMealToGuests([source, target], 0, [1]);

    // Target gets the source's package + selections.
    expect(result[1]?.packageId).toBe("pkg-basic");
    expect(result[1]?.included).toHaveLength(1);
    // But keeps its OWN notes — does NOT copy source's notes.
    expect(result[1]?.foodAllergies).toBe("dairy");
    expect(result[1]?.dietaryPreferences).toBe("keto");
    expect(result[1]?.mealRequests).toBe("well done");
  });
});

describe("per-guest notes — applyPackage / toggleSharedSelection", () => {
  it("applyPackage preserves personal notes", () => {
    const alloc = {
      ...buildAllocations(1, 0, 0)[0]!,
      foodAllergies: "peanuts",
      dietaryPreferences: "vegetarian",
      mealRequests: "no salt",
    };
    const result = applyPackage(alloc, PKG);
    expect(result.foodAllergies).toBe("peanuts");
    expect(result.dietaryPreferences).toBe("vegetarian");
    expect(result.mealRequests).toBe("no salt");
  });

  it("toggleSharedSelection preserves personal notes on all guests", () => {
    const allocs = buildAllocations(2, 0, 0).map((a, i) => ({
      ...a,
      packageId: "pkg-basic",
      foodAllergies: i === 0 ? "peanuts" : "dairy",
    }));
    const result = toggleSharedSelection(allocs, PKG, "m1", "meat");
    expect(result[0]?.foodAllergies).toBe("peanuts");
    expect(result[1]?.foodAllergies).toBe("dairy");
  });
});

describe("per-guest notes — buildSubmissionPayload", () => {
  it("includes non-empty notes in the submission payload", () => {
    const allocs = buildAllocations(1, 0, 0).map((a) => ({
      ...a,
      packageId: "pkg-basic",
      included: [
        { menuItemId: "m1", selectionCategory: "meat" },
        { menuItemId: "m2", selectionCategory: "meat" },
        { menuItemId: "s1", selectionCategory: "side" },
        { menuItemId: "s2", selectionCategory: "side" },
        { menuItemId: "b1", selectionCategory: "bread" },
      ],
      foodAllergies: "peanuts",
      dietaryPreferences: "vegetarian",
      mealRequests: "no salt",
    }));
    const state = makeState(allocs);
    const payload = buildSubmissionPayload(state, "test-key-12345");
    expect(payload.guests[0]?.foodAllergies).toBe("peanuts");
    expect(payload.guests[0]?.dietaryPreferences).toBe("vegetarian");
    expect(payload.guests[0]?.mealRequests).toBe("no salt");
  });

  it("omits empty notes from the payload (backward compatible)", () => {
    const allocs = buildAllocations(1, 0, 0).map((a) => ({
      ...a,
      packageId: "pkg-basic",
      included: [
        { menuItemId: "m1", selectionCategory: "meat" },
        { menuItemId: "m2", selectionCategory: "meat" },
        { menuItemId: "s1", selectionCategory: "side" },
        { menuItemId: "s2", selectionCategory: "side" },
        { menuItemId: "b1", selectionCategory: "bread" },
      ],
    }));
    const state = makeState(allocs);
    const payload = buildSubmissionPayload(state, "test-key-12345");
    // Empty notes are omitted (not supplied), not sent as empty strings.
    expect(payload.guests[0]?.foodAllergies).toBeUndefined();
    expect(payload.guests[0]?.dietaryPreferences).toBeUndefined();
    expect(payload.guests[0]?.mealRequests).toBeUndefined();
  });
});

describe("per-guest notes — submission schema validation", () => {
  function baseGuest(overrides: Record<string, unknown> = {}) {
    return {
      guestIndex: 0,
      category: "adult",
      packageId: "00000000-0000-0000-0000-000000000001",
      included: [],
      addons: [],
      ...overrides,
    };
  }

  function basePayload(guests: unknown[]) {
    return {
      sundayServiceId: "00000000-0000-0000-0000-000000000010",
      seatingTimeId: "00000000-0000-0000-0000-000000000020",
      experienceType: "standard",
      partySize: guests.length,
      adults: guests.length,
      seniors: 0,
      children: 0,
      contactFirstName: "Test",
      contactLastName: "User",
      contactEmail: "test@example.com",
      contactPhone: "555-0100",
      guests,
      platters: [],
      idempotencyKey: "test-key-12345",
    };
  }

  it("accepts valid notes", () => {
    const result = submitReservationRequestSchema.safeParse(
      basePayload([
        baseGuest({ foodAllergies: "peanuts", dietaryPreferences: "veg", mealRequests: "no salt" }),
      ]),
    );
    expect(result.success).toBe(true);
  });

  it("accepts missing notes (backward compatible)", () => {
    const result = submitReservationRequestSchema.safeParse(basePayload([baseGuest()]));
    expect(result.success).toBe(true);
  });

  it("accepts empty string notes", () => {
    const result = submitReservationRequestSchema.safeParse(
      basePayload([baseGuest({ foodAllergies: "", dietaryPreferences: "", mealRequests: "" })]),
    );
    expect(result.success).toBe(true);
  });

  it("rejects null values", () => {
    const result = submitReservationRequestSchema.safeParse(
      basePayload([baseGuest({ foodAllergies: null })]),
    );
    expect(result.success).toBe(false);
  });

  it("rejects non-string values", () => {
    const result = submitReservationRequestSchema.safeParse(
      basePayload([baseGuest({ foodAllergies: 123 })]),
    );
    expect(result.success).toBe(false);
  });

  it("rejects over-length values (>1000 chars)", () => {
    const long = "a".repeat(1001);
    const result = submitReservationRequestSchema.safeParse(
      basePayload([baseGuest({ foodAllergies: long })]),
    );
    expect(result.success).toBe(false);
  });

  it("accepts exactly 1000 characters", () => {
    const exact = "a".repeat(1000);
    const result = submitReservationRequestSchema.safeParse(
      basePayload([baseGuest({ foodAllergies: exact })]),
    );
    expect(result.success).toBe(true);
  });
});
