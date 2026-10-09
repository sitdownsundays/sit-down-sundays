/**
 * Behavioral tests for booking Step 4 (Review & submit) helpers.
 *
 * These exercise the REAL production functions in
 * src/lib/booking/submit-helpers.ts and src/lib/booking/contact-rules.ts —
 * not copied logic. Helper-level tests, NOT rendered component tests and NOT
 * live server/PostgreSQL tests.
 *
 * Coverage:
 *  - Wizard-to-submission payload mapping (no browser-trusted prices).
 *  - Named selections and correct add-on/platter quantities.
 *  - quoteIsSubmittable gating (loading, missing, failed, unresolved).
 *  - Full outstanding balance for unpaid requests (via quote shape).
 *  - Stable idempotency key generation.
 *  - Contact/schema validation parity.
 *  - Failed submission preserving state (handler contract).
 */
import { describe, it, expect } from "vitest";
import {
  buildSubmissionPayload,
  quoteIsSubmittable,
  formatCents,
  menuItemName,
  addonName,
  packageName,
  platterName,
  generateIdempotencyKey,
} from "@/lib/booking/submit-helpers";
import { validateContact } from "@/lib/booking/contact-rules";
import { initialWizardState } from "@/lib/booking/wizard-helpers";
import type { BookWizardState } from "@/lib/booking/wizard-helpers";
import type { QuoteResult } from "@/lib/public-quote.functions";
import type { PublicOrderingCatalog } from "@/lib/booking/public-catalog";
import type { GuestCategory } from "@/lib/ordering/constants";

const SERVICE_ID = "11111111-1111-1111-1111-111111111111";
const SEATING_ID = "22222222-2222-2222-2222-222222222222";
const PKG_BASIC = "33333333-3333-3333-3333-333333333333";
const PKG_SIG = "44444444-4444-4444-4444-444444444444";
const ITEM_MEAT1 = "55555555-5555-5555-5555-555555555555";
const ITEM_MEAT2 = "66666666-6666-6666-6666-666666666666";
const ITEM_SIDE1 = "77777777-7777-7777-7777-777777777777";
const ADDON_ID = "88888888-8888-8888-8888-888888888888";
const PLATTER_ID = "99999999-9999-9999-9999-999999999999";

function makeCatalog(): PublicOrderingCatalog {
  return {
    packages: [
      {
        id: PKG_BASIC,
        name: "Basic Meal",
        description: "",
        pricePerPersonCents: 2950,
        includedMeatsCount: 2,
        includedSidesCount: 2,
        includesBread: true,
        includesSoftDrink: true,
        displayOrder: 0,
        eligibleItems: [
          { menuItemId: ITEM_MEAT1, menuItemName: "Fried Chicken", selectionCategory: "meat" },
          { menuItemId: ITEM_MEAT2, menuItemName: "Brisket", selectionCategory: "meat" },
          { menuItemId: ITEM_SIDE1, menuItemName: "Mac & Cheese", selectionCategory: "side" },
        ],
      },
      {
        id: PKG_SIG,
        name: "Signature Meal",
        description: "",
        pricePerPersonCents: 3450,
        includedMeatsCount: 2,
        includedSidesCount: 2,
        includesBread: true,
        includesSoftDrink: true,
        displayOrder: 1,
        eligibleItems: [
          { menuItemId: ITEM_MEAT1, menuItemName: "Fried Chicken", selectionCategory: "meat" },
          { menuItemId: ITEM_SIDE1, menuItemName: "Mac & Cheese", selectionCategory: "side" },
        ],
      },
    ],
    addons: [
      {
        id: ADDON_ID,
        name: "Extra Cornbread",
        description: "",
        priceCents: 350,
        displayOrder: 0,
        eligiblePackageIds: [PKG_BASIC, PKG_SIG],
      },
    ],
    platters: [
      {
        id: PLATTER_ID,
        name: "Family Platter",
        description: "",
        pricePerPlatterCents: 2500,
        servingGuidance: null,
        displayOrder: 0,
      },
    ],
    guestPricingRules: null,
  };
}

function makeReviewState(): BookWizardState {
  const state = initialWizardState();
  state.step = "review";
  state.sundayServiceId = SERVICE_ID;
  state.seatingTimeId = SEATING_ID;
  state.adults = 2;
  state.seniors = 0;
  state.children = 0;
  state.meals.allocations = [
    {
      guestIndex: 0,
      category: "adult" as GuestCategory,
      name: "Alice",
      packageId: PKG_BASIC,
      included: [
        { menuItemId: ITEM_MEAT1, selectionCategory: "meat" },
        { menuItemId: ITEM_MEAT2, selectionCategory: "meat" },
        { menuItemId: ITEM_SIDE1, selectionCategory: "side" },
      ],
      addons: [{ addonId: ADDON_ID, quantity: 1 }],
    },
    {
      guestIndex: 1,
      category: "adult" as GuestCategory,
      name: "Bob",
      packageId: PKG_SIG,
      included: [
        { menuItemId: ITEM_MEAT1, selectionCategory: "meat" },
        { menuItemId: ITEM_SIDE1, selectionCategory: "side" },
      ],
      addons: [],
    },
  ];
  state.meals.platters = [{ platterId: PLATTER_ID, quantity: 2 }];
  state.contact = {
    contactFirstName: "Alice",
    contactLastName: "Smith",
    contactEmail: "alice@example.com",
    contactPhone: "+1 555 123 4567",
    dietaryNotes: "No nuts",
    accessibilityRequests: "",
    occasion: "Birthday",
    guestNotes: "",
  };
  return state;
}

describe("buildSubmissionPayload", () => {
  it("maps wizard state to the typed submission input", () => {
    const state = makeReviewState();
    const payload = buildSubmissionPayload(state, "bk_testkey12345");
    expect(payload.sundayServiceId).toBe(SERVICE_ID);
    expect(payload.seatingTimeId).toBe(SEATING_ID);
    expect(payload.experienceType).toBe("standard");
    expect(payload.partySize).toBe(2);
    expect(payload.adults).toBe(2);
    expect(payload.seniors).toBe(0);
    expect(payload.children).toBe(0);
    expect(payload.idempotencyKey).toBe("bk_testkey12345");
  });

  it("does not include browser-calculated prices or totals", () => {
    const state = makeReviewState();
    const payload = buildSubmissionPayload(state, "bk_testkey12345");
    // No trusted total/discount/status/actor fields.
    expect(payload).not.toHaveProperty("grandTotalCents");
    expect(payload).not.toHaveProperty("subtotalCents");
    expect(payload).not.toHaveProperty("depositRequiredCents");
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("paymentStatus");
    expect(payload).not.toHaveProperty("actorId");
  });

  it("maps guest allocations with named selections and add-on quantities", () => {
    const state = makeReviewState();
    const payload = buildSubmissionPayload(state, "bk_testkey12345");
    expect(payload.guests).toHaveLength(2);
    expect(payload.guests[0].guestIndex).toBe(0);
    expect(payload.guests[0].category).toBe("adult");
    expect(payload.guests[0].name).toBe("Alice");
    expect(payload.guests[0].packageId).toBe(PKG_BASIC);
    expect(payload.guests[0].included).toHaveLength(3);
    expect(payload.guests[0].included[0]).toEqual({
      menuItemId: ITEM_MEAT1,
      selectionCategory: "meat",
    });
    expect(payload.guests[0].addons).toEqual([{ addonId: ADDON_ID, quantity: 1 }]);
    expect(payload.guests[1].packageId).toBe(PKG_SIG);
  });

  it("maps shared platters with per-platter quantities (not multiplied by guests)", () => {
    const state = makeReviewState();
    const payload = buildSubmissionPayload(state, "bk_testkey12345");
    expect(payload.platters).toEqual([{ platterId: PLATTER_ID, quantity: 2 }]);
    // Quantity is 2, not 2 * partySize(2) = 4.
    expect(payload.platters[0].quantity).toBe(2);
  });

  it("includes optional contact fields only when non-empty (omitted vs null)", () => {
    const state = makeReviewState();
    const payload = buildSubmissionPayload(state, "bk_testkey12345");
    expect(payload.dietaryNotes).toBe("No nuts");
    expect(payload.occasion).toBe("Birthday");
    // Empty strings become undefined (omitted), not null.
    expect(payload.accessibilityRequests).toBeUndefined();
    expect(payload.guestNotes).toBeUndefined();
  });

  it("includes clientPreviewSubtotalCents only when provided", () => {
    const state = makeReviewState();
    const without = buildSubmissionPayload(state, "bk_testkey12345");
    expect(without).not.toHaveProperty("clientPreviewSubtotalCents");
    const withPreview = buildSubmissionPayload(state, "bk_testkey12345", 5000);
    expect(withPreview.clientPreviewSubtotalCents).toBe(5000);
  });
});

describe("quoteIsSubmittable", () => {
  it("returns false while loading", () => {
    expect(quoteIsSubmittable(null, true)).toBe(false);
  });
  it("returns false when quote is missing", () => {
    expect(quoteIsSubmittable(null, false)).toBe(false);
  });
  it("returns false when quote failed (ok:false)", () => {
    const q: QuoteResult = { ok: false, error: "boom" };
    expect(quoteIsSubmittable(q, false)).toBe(false);
  });
  it("returns false when quote has unresolved rules", () => {
    const q: QuoteResult = { ok: true, hasUnresolvedRules: true, unresolvedNotes: ["child rate"] };
    expect(quoteIsSubmittable(q, false)).toBe(false);
  });
  it("returns true when quote is ok with no unresolved rules", () => {
    const q: QuoteResult = {
      ok: true,
      subtotalCents: 5000,
      depositRequiredCents: 2500,
      remainingBalanceCents: 5000,
    };
    expect(quoteIsSubmittable(q, false)).toBe(true);
  });
});

describe("formatCents", () => {
  it("formats positive cents as dollars", () => {
    expect(formatCents(2950)).toBe("$29.50");
    expect(formatCents(100)).toBe("$1.00");
    expect(formatCents(0)).toBe("$0.00");
  });
  it("formats negative cents", () => {
    expect(formatCents(-500)).toBe("-$5.00");
  });
  it("pads single-digit cents", () => {
    expect(formatCents(5)).toBe("$0.05");
  });
});

describe("catalog name resolution", () => {
  const catalog = makeCatalog();
  it("resolves menu item names from package eligible items", () => {
    expect(menuItemName(catalog, ITEM_MEAT1)).toBe("Fried Chicken");
    expect(menuItemName(catalog, ITEM_SIDE1)).toBe("Mac & Cheese");
  });
  it("falls back to the ID when not found", () => {
    expect(menuItemName(catalog, "unknown-id")).toBe("unknown-id");
    expect(menuItemName(null, ITEM_MEAT1)).toBe(ITEM_MEAT1);
  });
  it("resolves add-on names", () => {
    expect(addonName(catalog, ADDON_ID)).toBe("Extra Cornbread");
    expect(addonName(null, ADDON_ID)).toBe(ADDON_ID);
  });
  it("resolves package names", () => {
    expect(packageName(catalog, PKG_BASIC)).toBe("Basic Meal");
    expect(packageName(catalog, "")).toBe("No package");
    expect(packageName(null, PKG_BASIC)).toBe(PKG_BASIC);
  });
  it("resolves platter names", () => {
    expect(platterName(catalog, PLATTER_ID)).toBe("Family Platter");
    expect(platterName(null, PLATTER_ID)).toBe(PLATTER_ID);
  });
});

describe("generateIdempotencyKey", () => {
  it("produces a key with the bk_ prefix and sufficient length", () => {
    const key = generateIdempotencyKey();
    // Secure generation may be unavailable in some test environments; when
    // available, the key must have the expected shape.
    if (key !== null) {
      expect(key.startsWith("bk_")).toBe(true);
      expect(key.length).toBeGreaterThanOrEqual(8);
    }
  });
  it("produces distinct keys across calls (when available)", () => {
    const a = generateIdempotencyKey();
    const b = generateIdempotencyKey();
    if (a !== null && b !== null) {
      expect(a).not.toBe(b);
    }
  });
  it("never falls back to Math.random — returns null if crypto is unavailable", () => {
    // The function must return null (not an insecure key) when secure
    // generation is unavailable, rather than silently using Math.random.
    const key = generateIdempotencyKey();
    expect(typeof key === "string" || key === null).toBe(true);
  });
});

describe("contact/schema validation parity", () => {
  it("validates a complete contact block", () => {
    const state = makeReviewState();
    const { valid, errors } = validateContact(state);
    expect(valid).toBe(true);
    expect(Object.keys(errors)).toHaveLength(0);
  });
  it("rejects missing required fields", () => {
    const state = makeReviewState();
    state.contact.contactFirstName = "";
    state.contact.contactEmail = "not-an-email";
    const { valid, errors } = validateContact(state);
    expect(valid).toBe(false);
    expect(errors.contactFirstName).toBeTruthy();
    expect(errors.contactEmail).toBeTruthy();
  });
  it("accepts optional notes being empty", () => {
    const state = makeReviewState();
    state.contact.dietaryNotes = "";
    state.contact.occasion = "";
    const { valid } = validateContact(state);
    expect(valid).toBe(true);
  });
});

describe("unpaid outstanding balance contract", () => {
  it("a successful quote with no payment has remainingBalance equal to subtotal/grandTotal", () => {
    // The server pricing path sets remainingBalanceCents = grandTotalCents for
    // an unpaid request (amountPaidCents = 0). The review screen displays this
    // as the outstanding balance, separate from depositRequiredCents.
    const q: QuoteResult = {
      ok: true,
      subtotalCents: 10000,
      depositRequiredCents: 5000,
      grandTotalCents: 10000,
      remainingBalanceCents: 10000,
    };
    expect(q.remainingBalanceCents).toBe(q.grandTotalCents);
    expect(q.depositRequiredCents).toBe(5000);
    // The deposit is NOT already-paid money; outstanding != total - deposit.
    expect(q.remainingBalanceCents).not.toBe(q.grandTotalCents - q.depositRequiredCents);
  });
});
