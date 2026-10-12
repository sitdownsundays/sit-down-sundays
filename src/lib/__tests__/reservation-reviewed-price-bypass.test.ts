/**
 * Reviewed-price bypass safeguard tests.
 *
 * Exercises the REAL calculateReservationPricing to prove:
 *  - A NEW request without a ReviewedPrice returns reviewRequired (never
 *    passes through to persistence with a subtotal-only or no-preview
 *    fallback).
 *  - A matching ReviewedPrice is accepted.
 *  - Changed tax/gratuity/deposit terms set reviewRequired.
 *  - Legacy subtotal-only preview is still honored (hash compatibility).
 *
 * Mock config only; no database or Supabase.
 */
import { describe, it, expect } from "vitest";
import {
  calculateReservationPricing,
  defaultPaymentPolicy,
  type PaymentPolicyConfig,
} from "@/lib/reservation/pricing";
import type { ReviewedPrice } from "@/lib/reservation/types";
import type { OrderingConfigDTO } from "@/lib/ordering/types";
import type { ReservationGuestInput } from "@/lib/reservation/types";

const MEAT_A = "11111111-0000-4000-8000-000000000001";
const MEAT_B = "11111111-0000-4000-8000-000000000002";
const SIDE_A = "22222222-0000-4000-8000-000000000001";
const SIDE_B = "22222222-0000-4000-8000-000000000002";

function makeConfig(priceCents: number): OrderingConfigDTO {
  const pkgId = "pkg-basic";
  return {
    packages: [
      {
        id: pkgId,
        name: "Basic Meal",
        slug: "basic-meal",
        description: "",
        pricePerPersonCents: priceCents,
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
            packageId: pkgId,
            menuItemId: MEAT_A,
            menuItemName: "Meat A",
            selectionCategory: "meat",
          },
          {
            id: "e2",
            packageId: pkgId,
            menuItemId: MEAT_B,
            menuItemName: "Meat B",
            selectionCategory: "meat",
          },
          {
            id: "e3",
            packageId: pkgId,
            menuItemId: SIDE_A,
            menuItemName: "Side A",
            selectionCategory: "side",
          },
          {
            id: "e4",
            packageId: pkgId,
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

function adultGuest(pkgId: string): ReservationGuestInput {
  return {
    guestIndex: 0,
    category: "adult",
    packageId: pkgId,
    included: [
      { menuItemId: MEAT_A, selectionCategory: "meat" },
      { menuItemId: MEAT_B, selectionCategory: "meat" },
      { menuItemId: SIDE_A, selectionCategory: "side" },
      { menuItemId: SIDE_B, selectionCategory: "side" },
    ],
    addons: [],
  };
}

function fullPolicy(opts?: Partial<PaymentPolicyConfig>): PaymentPolicyConfig {
  return {
    ...defaultPaymentPolicy(),
    depositPercent: 50,
    balanceDeadlineHours: 72,
    restaurantTimezone: "America/New_York",
    taxRateBasisPoints: 1000,
    gratuityRateBasisPoints: 1800,
    taxOnGratuity: true,
    ...opts,
  };
}

describe("calculateReservationPricing — reviewed-price bypass safeguard", () => {
  it("NEW request without ReviewedPrice → reviewRequired, no persistence bypass", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      fullPolicy(),
      "2026-11-01T12:00:00-04:00",
      undefined, // legacy subtotal — but no ReviewedPrice
      undefined, // no ReviewedPrice
    );
    expect(result.success).toBe(true);
    expect(result.reviewRequired).toBe(true);
  });

  it("NEW request with neither ReviewedPrice nor legacy subtotal → reviewRequired", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      fullPolicy(),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.success).toBe(true);
    expect(result.reviewRequired).toBe(true);
  });

  it("matching full ReviewedPrice → accepted (not reviewRequired)", () => {
    const config = makeConfig(10000);
    const p = fullPolicy();
    // First compute the authoritative price to get the exact ReviewedPrice.
    const base = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      p,
      "2026-11-01T12:00:00-04:00",
      undefined,
      undefined,
    );
    expect(base.success).toBe(true);
    expect(base.reviewedPrice).toBeDefined();
    const rp = base.reviewedPrice!;

    // Re-submit with the matching ReviewedPrice — no drift.
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      p,
      "2026-11-01T12:00:00-04:00",
      undefined,
      rp,
    );
    expect(result.success).toBe(true);
    expect(result.reviewRequired).toBe(false);
  });

  it("changed gratuity rate → reviewRequired (same subtotal, different terms)", () => {
    const config = makeConfig(10000);
    const base = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      fullPolicy(),
      "2026-11-01T12:00:00-04:00",
      undefined,
      undefined,
    );
    const rp = base.reviewedPrice!;

    // Now the policy changed: gratuity 20% instead of 18%.
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      fullPolicy({ gratuityRateBasisPoints: 2000 }),
      "2026-11-01T12:00:00-04:00",
      undefined,
      rp,
    );
    expect(result.success).toBe(true);
    expect(result.reviewRequired).toBe(true);
  });

  it("changed tax rate → reviewRequired (same subtotal, different terms)", () => {
    const config = makeConfig(10000);
    const base = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      fullPolicy(),
      "2026-11-01T12:00:00-04:00",
      undefined,
      undefined,
    );
    const rp = base.reviewedPrice!;

    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      fullPolicy({ taxRateBasisPoints: 1100 }),
      "2026-11-01T12:00:00-04:00",
      undefined,
      rp,
    );
    expect(result.success).toBe(true);
    expect(result.reviewRequired).toBe(true);
  });

  it("changed deposit percent → reviewRequired (same subtotal/gratuity/tax)", () => {
    const config = makeConfig(10000);
    const base = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      fullPolicy(),
      "2026-11-01T12:00:00-04:00",
      undefined,
      undefined,
    );
    const rp = base.reviewedPrice!;

    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      fullPolicy({ depositPercent: 75 }),
      "2026-11-01T12:00:00-04:00",
      undefined,
      rp,
    );
    expect(result.success).toBe(true);
    expect(result.reviewRequired).toBe(true);
  });

  it("changed taxOnGratuity → reviewRequired", () => {
    const config = makeConfig(10000);
    const base = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      fullPolicy(),
      "2026-11-01T12:00:00-04:00",
      undefined,
      undefined,
    );
    const rp = base.reviewedPrice!;

    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      fullPolicy({ taxOnGratuity: false }),
      "2026-11-01T12:00:00-04:00",
      undefined,
      rp,
    );
    expect(result.success).toBe(true);
    expect(result.reviewRequired).toBe(true);
  });

  it("legacy subtotal-only preview is honored (hash compatibility) when no ReviewedPrice", () => {
    const config = makeConfig(10000);
    const p = fullPolicy();
    // Legacy: only a subtotal is supplied, no ReviewedPrice.
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      p,
      "2026-11-01T12:00:00-04:00",
      10000, // matching subtotal
      undefined, // no ReviewedPrice
    );
    expect(result.success).toBe(true);
    expect(result.reviewRequired).toBe(false);
  });

  it("legacy subtotal mismatch → reviewRequired (hash compatibility path)", () => {
    const config = makeConfig(10000);
    const p = fullPolicy();
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      p,
      "2026-11-01T12:00:00-04:00",
      9999, // mismatched subtotal
      undefined,
    );
    expect(result.success).toBe(true);
    expect(result.reviewRequired).toBe(true);
  });

  it("ReviewedPrice snapshot contains all reviewed terms", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      fullPolicy(),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.success).toBe(true);
    const rp = result.reviewedPrice!;
    expect(rp).toBeDefined();
    // $100 food, 18% gratuity, 10% tax incl gratuity, 50% deposit.
    expect(rp.subtotalCents).toBe(10000);
    expect(rp.gratuityCents).toBe(1800);
    expect(rp.taxCents).toBe(1180); // (10000 + 1800) * 0.10
    expect(rp.grandTotalCents).toBe(12980);
    expect(rp.depositRequiredCents).toBe(5000);
    expect(rp.appliedGratuityRateBasisPoints).toBe(1800);
    expect(rp.appliedTaxRateBasisPoints).toBe(1000);
    expect(rp.appliedTaxOnGratuity).toBe(true);
    expect(rp.appliedDepositPercent).toBe(50);
  });

  // ---- Defect 1: separate actual vs projected balance ----
  it("remainingBalanceCents is the full unpaid grand total, not the projected-after-deposit", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      fullPolicy(),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.success).toBe(true);
    // Grand total = 10000 + 1800 + 1180 = 12980
    expect(result.grandTotalCents).toBe(12980);
    // Actual unpaid balance for a new request = full grand total
    expect(result.remainingBalanceCents).toBe(12980);
    // Projected balance after the $50 deposit is paid = 12980 − 5000 = 7980
    expect(result.projectedBalanceAfterDepositCents).toBe(7980);
    // The two values must be distinct
    expect(result.remainingBalanceCents).not.toBe(result.projectedBalanceAfterDepositCents);
  });

  it("taxOnGratuity=false changes the grand total and projected balance but not the deposit", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      fullPolicy({ taxOnGratuity: false }),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.success).toBe(true);
    // Tax = 10000 * 0.10 = 1000 (not (10000+1800)*0.10)
    expect(result.grandTotalCents).toBe(12800);
    expect(result.remainingBalanceCents).toBe(12800);
    expect(result.projectedBalanceAfterDepositCents).toBe(7800);
    // Deposit is always food-only: 10000 * 50% = 5000
    expect(result.depositRequiredCents).toBe(5000);
  });

  it("explicit zero rates and false taxOnGratuity produce a valid zero-charge policy", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      fullPolicy({
        taxRateBasisPoints: 0,
        gratuityRateBasisPoints: 0,
        taxOnGratuity: false,
      }),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.success).toBe(true);
    expect(result.grandTotalCents).toBe(10000);
    expect(result.remainingBalanceCents).toBe(10000);
    expect(result.projectedBalanceAfterDepositCents).toBe(5000);
  });
});

// ---- Defect 2: payload hash includes reviewed terms ----
import { buildPayloadHash } from "@/lib/server/reservation-submit.server";

describe("buildPayloadHash — clientPreviewPrice in request identity", () => {
  const baseInput = {
    sundayServiceId: "s1",
    seatingTimeId: "st1",
    experienceType: "standard" as const,
    partySize: 2,
    adults: 2,
    seniors: 0,
    children: 0,
    contactFirstName: "Jane",
    contactLastName: "Doe",
    contactEmail: "jane@example.com",
    contactPhone: "+13125550000",
    guestNotes: "",
    dietaryNotes: "",
    accessibilityRequests: "",
    occasion: "",
    guests: [
      {
        guestIndex: 0,
        category: "adult",
        name: "",
        packageId: "pkg-1",
        included: [],
        addons: [],
        foodAllergies: "",
        dietaryPreferences: "",
        mealRequests: "",
      },
    ],
    platters: [],
  };

  const rpA: ReviewedPrice = {
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

  it("absent clientPreviewPrice preserves the legacy hash (no empty object added)", () => {
    const without: Record<string, unknown> = { ...baseInput };
    const hash1 = buildPayloadHash(without);
    // A second call with the same input must produce the same hash.
    const hash2 = buildPayloadHash({ ...baseInput });
    expect(hash1).toBe(hash2);
    // Confirm the key is NOT present in the normalized object by checking
    // that adding it changes the hash.
    const withRp = buildPayloadHash({ ...baseInput, clientPreviewPrice: rpA });
    expect(withRp).not.toBe(hash1);
  });

  it("changing a reviewed term changes the hash", () => {
    const rpB: ReviewedPrice = {
      ...rpA,
      gratuityCents: 2000,
      appliedGratuityRateBasisPoints: 2000,
    };
    const hashA = buildPayloadHash({ ...baseInput, clientPreviewPrice: rpA });
    const hashB = buildPayloadHash({ ...baseInput, clientPreviewPrice: rpB });
    expect(hashA).not.toBe(hashB);
  });

  it("identical reviewed terms produce the same hash", () => {
    const hash1 = buildPayloadHash({ ...baseInput, clientPreviewPrice: rpA });
    const hash2 = buildPayloadHash({ ...baseInput, clientPreviewPrice: { ...rpA } });
    expect(hash1).toBe(hash2);
  });
});
