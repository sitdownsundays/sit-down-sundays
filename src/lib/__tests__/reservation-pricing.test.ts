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
