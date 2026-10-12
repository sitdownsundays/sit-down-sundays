/**
 * Reservation deposit calculation — behavioral tests.
 *
 * Exercises the real calculateReservationPricing function to prove the
 * configured deposit percentage is applied exactly ONCE (the prior defect
 * passed the percentage result through depositForSubtotal, which halved it
 * again — a configured 50% deposit became ~25%).
 *
 * Mock config only; no database or Supabase involved.
 */
import { describe, it, expect } from "vitest";
import {
  calculateReservationPricing,
  defaultPaymentPolicy,
  type PaymentPolicyConfig,
} from "@/lib/reservation/pricing";
import type { OrderingConfigDTO } from "@/lib/ordering/types";
import type { ReservationGuestInput } from "@/lib/reservation/types";

const MEAT_A = "11111111-0000-4000-8000-000000000001";
const MEAT_B = "11111111-0000-4000-8000-000000000002";
const SIDE_A = "22222222-0000-4000-8000-000000000001";
const SIDE_B = "22222222-0000-4000-8000-000000000002";

function makeConfig(packagePriceCents: number): OrderingConfigDTO {
  const pkgId = "pkg-basic";
  return {
    packages: [
      {
        id: pkgId,
        name: "Basic Meal",
        slug: "basic-meal",
        description: "",
        pricePerPersonCents: packagePriceCents,
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

function policy(depositPercent: number): PaymentPolicyConfig {
  return {
    ...defaultPaymentPolicy(),
    depositPercent,
    balanceDeadlineHours: 72,
    restaurantTimezone: "America/New_York",
    // Explicit "no charges" — these are deposit-only tests. 0/0/false is a
    // valid configured policy (food-only total), distinct from null (not
    // configured). NULL must fail; explicit zero must succeed.
    taxRateBasisPoints: 0,
    gratuityRateBasisPoints: 0,
    taxOnGratuity: false,
  };
}

describe("calculateReservationPricing — deposit applied exactly once", () => {
  it("10,000 cents at 50% → 5,000 deposit, 10,000 outstanding (unpaid)", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      policy(50),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.success).toBe(true);
    expect(result.subtotalCents).toBe(10000);
    expect(result.depositRequiredCents).toBe(5000);
    // Nothing has been paid: outstanding balance is the FULL total.
    expect(result.remainingBalanceCents).toBe(10000);
    // Guard against the old double-application bug (50% → ~25%).
    expect(result.depositRequiredCents).not.toBe(2500);
    // The required deposit is NOT money received.
    expect(result.depositRequiredCents).not.toBe(result.remainingBalanceCents);
  });

  it("10,000 cents at 30% → 3,000 deposit, 10,000 outstanding (unpaid)", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      policy(30),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.subtotalCents).toBe(10000);
    expect(result.depositRequiredCents).toBe(3000);
    // Unpaid: outstanding balance is the full total, not total minus deposit.
    expect(result.remainingBalanceCents).toBe(10000);
  });

  it("0% deposit → 0 deposit, full total outstanding", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      policy(0),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.depositRequiredCents).toBe(0);
    expect(result.remainingBalanceCents).toBe(10000);
  });

  it("100% deposit → full total as required deposit, but still unpaid so full total outstanding", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      policy(100),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.depositRequiredCents).toBe(10000);
    // A 100% required deposit does NOT mean the reservation is paid.
    expect(result.remainingBalanceCents).toBe(10000);
  });

  it("odd-cent total: deposit is rounded, outstanding balance equals the full total", () => {
    const config = makeConfig(3333);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      policy(50),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.subtotalCents).toBe(3333);
    // 50% of 3333 = round(1666.5) = 1667.
    expect(result.depositRequiredCents).toBe(1667);
    // Unpaid: outstanding balance is the full total regardless of deposit.
    expect(result.remainingBalanceCents).toBe(3333);
  });
});

// ---------------------------------------------------------------------------
// Tax & gratuity integration through calculateReservationPricing
// ---------------------------------------------------------------------------

function policyWithCharges(
  depositPercent: number,
  taxRateBasisPoints: number | null,
  gratuityRateBasisPoints: number | null,
  taxOnGratuity: boolean | null,
): PaymentPolicyConfig {
  return {
    ...defaultPaymentPolicy(),
    depositPercent,
    balanceDeadlineHours: 72,
    restaurantTimezone: "America/New_York",
    taxRateBasisPoints,
    gratuityRateBasisPoints,
    taxOnGratuity,
  };
}

describe("calculateReservationPricing — tax & gratuity", () => {
  it("$100 food, 18% gratuity, 10% tax incl gratuity, 50% deposit → $129.80 total, $50 deposit, $129.80 balance", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      policyWithCharges(50, 1000, 1800, true),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.success).toBe(true);
    expect(result.subtotalCents).toBe(10000);
    expect(result.grandTotalCents).toBe(12980);
    // Deposit is food-only, never includes tax or gratuity.
    expect(result.depositRequiredCents).toBe(5000);
    // Unpaid: outstanding balance is the FULL grand total, not grand minus deposit.
    expect(result.remainingBalanceCents).toBe(12980);
    // Gratuity and tax appear as separate labeled lines.
    const gratuityLine = result.lines.find((l) => l.kind === "gratuity");
    const taxLine = result.lines.find((l) => l.kind === "tax");
    expect(gratuityLine).toBeDefined();
    expect(gratuityLine!.amountCents).toBe(1800);
    expect(taxLine).toBeDefined();
    expect(taxLine!.amountCents).toBe(1180);
    expect(taxLine!.label).toContain("incl. gratuity");
  });

  it("tax excluding gratuity produces $128.00 total", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      policyWithCharges(50, 1000, 1800, false),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.success).toBe(true);
    expect(result.grandTotalCents).toBe(12800);
    expect(result.depositRequiredCents).toBe(5000);
    expect(result.remainingBalanceCents).toBe(12800);
    const taxLine = result.lines.find((l) => l.kind === "tax");
    expect(taxLine).toBeDefined();
    expect(taxLine!.amountCents).toBe(1000);
    expect(taxLine!.label).not.toContain("incl. gratuity");
  });

  it("explicit zero rates and false taxability are valid (food-only total)", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      policyWithCharges(50, 0, 0, false),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.success).toBe(true);
    expect(result.subtotalCents).toBe(10000);
    expect(result.grandTotalCents).toBe(10000);
    expect(result.depositRequiredCents).toBe(5000);
    expect(result.remainingBalanceCents).toBe(10000);
    // No gratuity/tax lines when amounts are zero.
    expect(result.lines.find((l) => l.kind === "gratuity")).toBeUndefined();
    expect(result.lines.find((l) => l.kind === "tax")).toBeUndefined();
  });

  it("all-null config (not configured) FAILS — never a food-only total", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      policyWithCharges(50, null, null, null),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("taxRateBasisPoints null alone fails", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      policyWithCharges(50, null, 1800, true),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.success).toBe(false);
  });

  it("gratuityRateBasisPoints null alone fails", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      policyWithCharges(50, 1000, null, true),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.success).toBe(false);
  });

  it("taxOnGratuity null alone fails", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      policyWithCharges(50, 1000, 1800, null),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.success).toBe(false);
  });

  it("odd-cent rounding matches the charge helper", () => {
    const config = makeConfig(3333);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      policyWithCharges(50, 1000, 1800, true),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.success).toBe(true);
    // gratuity: round(3333 * 1800 / 10000) = round(599.94) = 600
    // taxable: 3333 + 600 = 3933
    // tax: round(3933 * 1000 / 10000) = round(393.3) = 393
    // grand total: 3333 + 600 + 393 = 4326
    expect(result.grandTotalCents).toBe(4326);
    // deposit: 50% of 3333 = round(1666.5) = 1667 (half-up)
    expect(result.depositRequiredCents).toBe(1667);
    expect(result.remainingBalanceCents).toBe(4326);
  });

  it("pricing snapshot records applied rates and taxability", () => {
    const config = makeConfig(10000);
    const result = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      policyWithCharges(50, 1000, 1800, true),
      "2026-11-01T12:00:00-04:00",
    );
    expect(result.success).toBe(true);
    const snap = result.pricingSnapshot as Record<string, unknown>;
    expect(snap["appliedGratuityRateBasisPoints"]).toBe(1800);
    expect(snap["appliedTaxRateBasisPoints"]).toBe(1000);
    expect(snap["appliedTaxOnGratuity"]).toBe(true);
    expect(snap["appliedDepositPercent"]).toBe(50);
    expect(snap["gratuityCents"]).toBe(1800);
    expect(snap["taxCents"]).toBe(1180);
    const policySnap = result.policySnapshot as Record<string, unknown>;
    expect(policySnap["taxRateBasisPoints"]).toBe(1000);
    expect(policySnap["gratuityRateBasisPoints"]).toBe(1800);
    expect(policySnap["taxOnGratuity"]).toBe(true);
  });

  it("existing deposit percentages remain correct alongside zero charges", () => {
    const config = makeConfig(10000);
    const r30 = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      policyWithCharges(30, 0, 0, false),
      "2026-11-01T12:00:00-04:00",
    );
    expect(r30.success).toBe(true);
    expect(r30.depositRequiredCents).toBe(3000);
    expect(r30.remainingBalanceCents).toBe(10000);

    const r100 = calculateReservationPricing(
      [adultGuest(config.packages[0]!.id)],
      [],
      config,
      policyWithCharges(100, 0, 0, false),
      "2026-11-01T12:00:00-04:00",
    );
    expect(r100.success).toBe(true);
    expect(r100.depositRequiredCents).toBe(10000);
    // Still unpaid: 100% deposit does NOT mean the reservation is paid.
    expect(r100.remainingBalanceCents).toBe(10000);
  });
});
