/**
 * Submission boundary normalization regression tests — exercises the REAL
 * production submitReservationRequestSchema + normalizeSubmitRequest.
 *
 * Covers the TS2379 mismatch between the parsed schema (optionals may be
 * explicitly undefined) and SubmitReservationRequestInput (exact optional
 * properties), and verifies values are preserved by identity, not truthiness.
 *
 * Pure schema/normalizer tests — no database or Supabase involvement.
 */
import { describe, it, expect } from "vitest";
import { submitReservationRequestSchema } from "@/lib/reservation/schema";
import { normalizeSubmitRequest } from "@/lib/server/reservation-submit-normalize.server";

const SERVICE_ID = "11111111-0000-4000-8000-0000000000aa";
const SEATING_ID = "22222222-0000-4000-8000-0000000000bb";
const PKG_ID = "33333333-0000-4000-8000-0000000000cc";
const MEAT_A = "44444444-0000-4000-8000-0000000000aa";
const MEAT_B = "44444444-0000-4000-8000-0000000000bb";
const SIDE_A = "55555555-0000-4000-8000-0000000000aa";
const SIDE_B = "55555555-0000-4000-8000-0000000000bb";
const ADDON = "66666666-0000-4000-8000-0000000000aa";

function validGuest(overrides: Record<string, unknown> = {}) {
  return {
    guestIndex: 0,
    category: "adult",
    packageId: PKG_ID,
    included: [
      { menuItemId: MEAT_A, selectionCategory: "meat" },
      { menuItemId: MEAT_B, selectionCategory: "meat" },
      { menuItemId: SIDE_A, selectionCategory: "side" },
      { menuItemId: SIDE_B, selectionCategory: "side" },
    ],
    addons: [{ addonId: ADDON, quantity: 2 }],
    ...overrides,
  };
}

function validSubmission(guests: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    sundayServiceId: SERVICE_ID,
    seatingTimeId: SEATING_ID,
    experienceType: "standard",
    partySize: guests.length,
    adults: guests.filter((g) => (g as Record<string, unknown>)["category"] === "adult").length,
    seniors: 0,
    children: 0,
    contactFirstName: "Jane",
    contactLastName: "Doe",
    contactEmail: "jane@example.com",
    contactPhone: "+13125550000",
    guests,
    platters: [],
    idempotencyKey: "idem-key-abc-1234",
    ...overrides,
  };
}

describe("submitReservationRequestSchema + normalizeSubmitRequest boundary", () => {
  it("parses and normalizes a minimal submission (missing optionals)", () => {
    const parsed = submitReservationRequestSchema.parse(validSubmission([validGuest()]));
    const normalized = normalizeSubmitRequest(parsed);
    expect(normalized.idempotencyKey).toBe("idem-key-abc-1234");
    expect(normalized.guests).toHaveLength(1);
    expect("guestNotes" in normalized).toBe(false);
    expect("dietaryNotes" in normalized).toBe(false);
    expect("accessibilityRequests" in normalized).toBe(false);
    expect("occasion" in normalized).toBe(false);
    expect("clientPreviewSubtotalCents" in normalized).toBe(false);
    const g0 = normalized.guests[0];
    expect(g0).toBeDefined();
    if (g0) {
      expect("name" in g0).toBe(false);
      expect("foodAllergies" in g0).toBe(false);
    }
  });

  it("preserves supplied empty-string party notes (not truthiness)", () => {
    const parsed = submitReservationRequestSchema.parse(
      validSubmission([validGuest()], {
        guestNotes: "",
        dietaryNotes: "",
        accessibilityRequests: "",
        occasion: "",
      }),
    );
    const normalized = normalizeSubmitRequest(parsed);
    expect(normalized.guestNotes).toBe("");
    expect(normalized.dietaryNotes).toBe("");
    expect(normalized.accessibilityRequests).toBe("");
    expect(normalized.occasion).toBe("");
  });

  it("preserves a zero clientPreviewSubtotalCents (not truthiness)", () => {
    const parsed = submitReservationRequestSchema.parse(
      validSubmission([validGuest()], { clientPreviewSubtotalCents: 0 }),
    );
    const normalized = normalizeSubmitRequest(parsed);
    expect(normalized.clientPreviewSubtotalCents).toBe(0);
  });

  it("preserves a non-zero clientPreviewSubtotalCents", () => {
    const parsed = submitReservationRequestSchema.parse(
      validSubmission([validGuest()], { clientPreviewSubtotalCents: 29500 }),
    );
    const normalized = normalizeSubmitRequest(parsed);
    expect(normalized.clientPreviewSubtotalCents).toBe(29500);
  });

  it("preserves supplied empty-string guest name and notes (not truthiness)", () => {
    const parsed = submitReservationRequestSchema.parse(
      validSubmission([
        validGuest({ name: "", foodAllergies: "", dietaryPreferences: "", mealRequests: "" }),
      ]),
    );
    const normalized = normalizeSubmitRequest(parsed);
    const g0 = normalized.guests[0];
    expect(g0).toBeDefined();
    if (g0) {
      expect(g0.name).toBe("");
      expect(g0.foodAllergies).toBe("");
      expect(g0.dietaryPreferences).toBe("");
      expect(g0.mealRequests).toBe("");
    }
  });

  it("preserves distinct non-empty guest notes across multiple guests", () => {
    const parsed = submitReservationRequestSchema.parse(
      validSubmission(
        [
          validGuest({ guestIndex: 0, foodAllergies: "peanuts", mealRequests: "no ice" }),
          validGuest({ guestIndex: 1, foodAllergies: "shellfish", mealRequests: "extra gravy" }),
        ],
        { partySize: 2, adults: 2 },
      ),
    );
    const normalized = normalizeSubmitRequest(parsed);
    const g0 = normalized.guests[0];
    const g1 = normalized.guests[1];
    expect(g0).toBeDefined();
    expect(g1).toBeDefined();
    if (g0) {
      expect(g0.foodAllergies).toBe("peanuts");
      expect(g0.mealRequests).toBe("no ice");
    }
    if (g1) {
      expect(g1.foodAllergies).toBe("shellfish");
      expect(g1.mealRequests).toBe("extra gravy");
    }
  });

  it("preserves categories, selections, add-ons, and platters", () => {
    const parsed = submitReservationRequestSchema.parse(
      validSubmission([validGuest({ category: "senior" })], {
        seniors: 1,
        adults: 0,
        platters: [{ platterId: "77777777-0000-4000-8000-0000000000aa", quantity: 3 }],
      }),
    );
    const normalized = normalizeSubmitRequest(parsed);
    const g0 = normalized.guests[0];
    expect(g0).toBeDefined();
    if (g0) {
      expect(g0.category).toBe("senior");
      expect(g0.included).toHaveLength(4);
      const first = g0.included[0];
      expect(first).toEqual({ menuItemId: MEAT_A, selectionCategory: "meat" });
      expect(g0.addons).toEqual([{ addonId: ADDON, quantity: 2 }]);
    }
    expect(normalized.platters).toEqual([
      { platterId: "77777777-0000-4000-8000-0000000000aa", quantity: 3 },
    ]);
  });

  it("preserves contact details and idempotency key exactly", () => {
    const parsed = submitReservationRequestSchema.parse(validSubmission([validGuest()]));
    const normalized = normalizeSubmitRequest(parsed);
    expect(normalized.contactFirstName).toBe("Jane");
    expect(normalized.contactLastName).toBe("Doe");
    expect(normalized.contactEmail).toBe("jane@example.com");
    expect(normalized.contactPhone).toBe("+13125550000");
    expect(normalized.idempotencyKey).toBe("idem-key-abc-1234");
  });

  it("does not mutate the parsed input", () => {
    const parsed = submitReservationRequestSchema.parse(validSubmission([validGuest()]));
    const snapshot = JSON.parse(JSON.stringify(parsed));
    normalizeSubmitRequest(parsed);
    expect(parsed).toEqual(snapshot);
  });

  it("result is assignable to SubmitReservationRequestInput (no TS2379)", () => {
    const parsed = submitReservationRequestSchema.parse(validSubmission([validGuest()]));
    const normalized = normalizeSubmitRequest(parsed);
    // Structural check mirroring the handler call shape.
    expect(normalized).toMatchObject({
      sundayServiceId: SERVICE_ID,
      seatingTimeId: SEATING_ID,
      experienceType: "standard",
      guests: expect.any(Array),
    });
  });

  it("rejects unknown guest category at the schema layer", () => {
    expect(() =>
      submitReservationRequestSchema.parse(validSubmission([validGuest({ category: "toddler" })])),
    ).toThrow();
  });

  it("explicit undefined optionals in the input contract are omitted by the normalizer", () => {
    // The SubmitRequestInput contract permits `field: undefined` for each
    // optional (Zod infers `T | undefined`). Constructing the shape directly
    // exercises the input type without bypassing validation. The normalizer
    // must omit each key whose value is `undefined`.
    const input: Parameters<typeof normalizeSubmitRequest>[0] = {
      sundayServiceId: SERVICE_ID,
      seatingTimeId: SEATING_ID,
      experienceType: "standard",
      partySize: 1,
      adults: 1,
      seniors: 0,
      children: 0,
      contactFirstName: "Jane",
      contactLastName: "Doe",
      contactEmail: "jane@example.com",
      contactPhone: "+13125550000",
      guestNotes: undefined,
      dietaryNotes: undefined,
      accessibilityRequests: undefined,
      occasion: undefined,
      guests: [
        {
          guestIndex: 0,
          category: "adult",
          name: undefined,
          packageId: PKG_ID,
          included: [],
          addons: [],
          foodAllergies: undefined,
          dietaryPreferences: undefined,
          mealRequests: undefined,
        },
      ],
      platters: [],
      idempotencyKey: "idem-key-abc-1234",
      clientPreviewSubtotalCents: undefined,
      clientPreviewPrice: undefined,
    };
    const normalized = normalizeSubmitRequest(input);
    expect("guestNotes" in normalized).toBe(false);
    expect("dietaryNotes" in normalized).toBe(false);
    expect("accessibilityRequests" in normalized).toBe(false);
    expect("occasion" in normalized).toBe(false);
    expect("clientPreviewSubtotalCents" in normalized).toBe(false);
    expect("clientPreviewPrice" in normalized).toBe(false);
    const g0 = normalized.guests[0];
    expect(g0).toBeDefined();
    if (g0) {
      expect("name" in g0).toBe(false);
      expect("foodAllergies" in g0).toBe(false);
      expect("dietaryPreferences" in g0).toBe(false);
      expect("mealRequests" in g0).toBe(false);
    }
  });

  it("preserves a supplied clientPreviewPrice snapshot end-to-end", () => {
    const reviewedPrice = {
      subtotalCents: 10000,
      gratuityCents: 1800,
      taxCents: 1180,
      grandTotalCents: 12980,
      depositRequiredCents: 5000,
      appliedGratuityRateBasisPoints: 1800,
      appliedTaxRateBasisPoints: 1000,
      appliedTaxOnGratuity: true,
      appliedDepositPercent: 50,
    };
    const parsed = submitReservationRequestSchema.parse(
      validSubmission([validGuest()], {
        clientPreviewPrice: reviewedPrice,
        clientPreviewSubtotalCents: 10000,
      }),
    );
    const normalized = normalizeSubmitRequest(parsed);
    expect(normalized.clientPreviewPrice).toEqual(reviewedPrice);
    expect(normalized.clientPreviewSubtotalCents).toBe(10000);
  });

  it("omits clientPreviewPrice when absent (legacy compatibility)", () => {
    const parsed = submitReservationRequestSchema.parse(validSubmission([validGuest()]));
    const normalized = normalizeSubmitRequest(parsed);
    expect("clientPreviewPrice" in normalized).toBe(false);
  });
});
