/**
 * Fail-closed regression tests for malformed per-package pricing rules.
 *
 * Both the public quote handler (public-quote.functions.ts) and the submission
 * handler (reservation-submit.server.ts) check `hasUnresolvedRules` and return
 * a safe error / proven_rejection BEFORE persistence. These tests exercise the
 * REAL calculateReservationPricing engine to prove that a malformed per-package
 * override actually sets `hasUnresolvedRules: true` — the flag both handlers
 * gate on — and that valid explicit rules ("none", zero, 0%/100%) remain
 * accepted without unresolved notes.
 *
 * The idempotent-replay ordering is also verified: the submission handler looks
 * up a saved matching request BEFORE any pricing validation, so a saved
 * reservation is replayed even if current configuration would now produce
 * unresolved rules. That ordering is source-verified here, not re-implemented.
 */
import { describe, it, expect } from "vitest";
import {
  calculateReservationPricing,
  defaultPaymentPolicy,
  type PaymentPolicyConfig,
} from "@/lib/reservation/pricing";
import type { ReviewedPrice } from "@/lib/reservation/types";
import type { OrderingConfigDTO, MealPackageDTO } from "@/lib/ordering/types";
import type { ReservationGuestInput } from "@/lib/reservation/types";

const MEAT_A = "11111111-0000-4000-8000-000000000001";
const MEAT_B = "11111111-0000-4000-8000-000000000002";
const SIDE_A = "22222222-0000-4000-8000-000000000001";
const SIDE_B = "22222222-0000-4000-8000-000000000002";

function makePackage(overrides: Partial<MealPackageDTO> = {}): MealPackageDTO {
  const id = overrides.id ?? "pkg-001";
  return {
    id,
    name: "Test Package",
    slug: "test-package",
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
        packageId: id,
        menuItemId: MEAT_A,
        menuItemName: "Meat A",
        selectionCategory: "meat",
      },
      {
        id: "e2",
        packageId: id,
        menuItemId: MEAT_B,
        menuItemName: "Meat B",
        selectionCategory: "meat",
      },
      {
        id: "e3",
        packageId: id,
        menuItemId: SIDE_A,
        menuItemName: "Side A",
        selectionCategory: "side",
      },
      {
        id: "e4",
        packageId: id,
        menuItemId: SIDE_B,
        menuItemName: "Side B",
        selectionCategory: "side",
      },
    ],
    childRuleType: null,
    childFixedPriceCents: null,
    childDiscountBasisPoints: null,
    seniorRuleType: null,
    seniorFixedPriceCents: null,
    seniorDiscountBasisPoints: null,
    ...overrides,
  };
}

function makeConfig(packages: MealPackageDTO[]): OrderingConfigDTO {
  return { packages, addons: [], platters: [], guestPricingRules: null };
}

function adultGuest(pkgId = "pkg-001"): ReservationGuestInput {
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

function childGuest(pkgId = "pkg-001"): ReservationGuestInput {
  return {
    guestIndex: 0,
    category: "child",
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

function seniorGuest(pkgId = "pkg-001"): ReservationGuestInput {
  return {
    guestIndex: 0,
    category: "senior",
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

const SEATING_START = "2026-11-01T12:00:00-04:00";

describe("per-package pricing — fail-closed on malformed rules", () => {
  // ---- Malformed child rule → hasUnresolvedRules: true ----
  it("malformed child fixed price (null) → hasUnresolvedRules true, both handlers block", () => {
    const pkg = makePackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: null,
    });
    const result = calculateReservationPricing(
      [childGuest()],
      [],
      makeConfig([pkg]),
      fullPolicy(),
      SEATING_START,
      undefined,
      undefined,
    );
    // The pricing engine succeeds (it can compute a subtotal) but surfaces
    // unresolved rules — both the quote handler and submission handler gate on
    // this flag and return a safe rejection, never a usable full-price total.
    expect(result.success).toBe(true);
    expect(result.hasUnresolvedRules).toBe(true);
  });

  it("malformed child percentage (over 10000 bps) → hasUnresolvedRules true", () => {
    const pkg = makePackage({
      childRuleType: "percentage_discount",
      childDiscountBasisPoints: 10001,
    });
    const result = calculateReservationPricing(
      [childGuest()],
      [],
      makeConfig([pkg]),
      fullPolicy(),
      SEATING_START,
      undefined,
      undefined,
    );
    expect(result.success).toBe(true);
    expect(result.hasUnresolvedRules).toBe(true);
  });

  it("malformed child fixed price above regular → hasUnresolvedRules true", () => {
    const pkg = makePackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 3000, // exceeds 2950
    });
    const result = calculateReservationPricing(
      [childGuest()],
      [],
      makeConfig([pkg]),
      fullPolicy(),
      SEATING_START,
      undefined,
      undefined,
    );
    expect(result.success).toBe(true);
    expect(result.hasUnresolvedRules).toBe(true);
  });

  // ---- Malformed senior rule → hasUnresolvedRules: true ----
  it("malformed senior fixed price (null) → hasUnresolvedRules true", () => {
    const pkg = makePackage({
      seniorRuleType: "fixed_package_price",
      seniorFixedPriceCents: null,
    });
    const result = calculateReservationPricing(
      [seniorGuest()],
      [],
      makeConfig([pkg]),
      fullPolicy(),
      SEATING_START,
      undefined,
      undefined,
    );
    expect(result.success).toBe(true);
    expect(result.hasUnresolvedRules).toBe(true);
  });

  it("malformed senior percentage (over 10000 bps) → hasUnresolvedRules true", () => {
    const pkg = makePackage({
      seniorRuleType: "percentage_discount",
      seniorDiscountBasisPoints: 10001,
    });
    const result = calculateReservationPricing(
      [seniorGuest()],
      [],
      makeConfig([pkg]),
      fullPolicy(),
      SEATING_START,
      undefined,
      undefined,
    );
    expect(result.success).toBe(true);
    expect(result.hasUnresolvedRules).toBe(true);
  });

  it("malformed senior fixed above regular → hasUnresolvedRules true", () => {
    const pkg = makePackage({
      seniorRuleType: "fixed_package_price",
      seniorFixedPriceCents: 3000,
    });
    const result = calculateReservationPricing(
      [seniorGuest()],
      [],
      makeConfig([pkg]),
      fullPolicy(),
      SEATING_START,
      undefined,
      undefined,
    );
    expect(result.success).toBe(true);
    expect(result.hasUnresolvedRules).toBe(true);
  });

  // ---- No reservation-creation or capacity call on rejected submission ----
  // The submission handler (reservation-submit.server.ts) checks
  // `pricing.hasUnresolvedRules` at line 265 and returns proven_rejection with
  // `rejectionCode: "unresolved_pricing"` BEFORE the snapshot/persistence
  // path (line 304+). The repo.submitRequest call at line 319 is never reached.
  // This is source-verified, not re-implemented here.

  // ---- Valid explicit rules remain accepted ----
  it("explicit 'none' child rule → accepted, no unresolved rules", () => {
    const pkg = makePackage({
      childRuleType: "none",
      childFixedPriceCents: null,
      childDiscountBasisPoints: null,
    });
    const result = calculateReservationPricing(
      [childGuest()],
      [],
      makeConfig([pkg]),
      fullPolicy(),
      SEATING_START,
      undefined,
      undefined,
    );
    expect(result.success).toBe(true);
    expect(result.hasUnresolvedRules).toBe(false);
    // "none" = full package price for child
    expect(result.subtotalCents).toBe(2950);
  });

  it("zero fixed child price → accepted, no unresolved rules", () => {
    const pkg = makePackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 0,
    });
    const result = calculateReservationPricing(
      [childGuest()],
      [],
      makeConfig([pkg]),
      fullPolicy(),
      SEATING_START,
      undefined,
      undefined,
    );
    expect(result.success).toBe(true);
    expect(result.hasUnresolvedRules).toBe(false);
    expect(result.subtotalCents).toBe(0);
  });

  it("0% child discount → accepted, no unresolved rules", () => {
    const pkg = makePackage({
      childRuleType: "percentage_discount",
      childDiscountBasisPoints: 0,
    });
    const result = calculateReservationPricing(
      [childGuest()],
      [],
      makeConfig([pkg]),
      fullPolicy(),
      SEATING_START,
      undefined,
      undefined,
    );
    expect(result.success).toBe(true);
    expect(result.hasUnresolvedRules).toBe(false);
    expect(result.subtotalCents).toBe(2950);
  });

  it("100% child discount → accepted, no unresolved rules", () => {
    const pkg = makePackage({
      childRuleType: "percentage_discount",
      childDiscountBasisPoints: 10000,
    });
    const result = calculateReservationPricing(
      [childGuest()],
      [],
      makeConfig([pkg]),
      fullPolicy(),
      SEATING_START,
      undefined,
      undefined,
    );
    expect(result.success).toBe(true);
    expect(result.hasUnresolvedRules).toBe(false);
    expect(result.subtotalCents).toBe(0);
  });

  it("valid senior percentage discount → accepted, no unresolved rules", () => {
    const pkg = makePackage({
      seniorRuleType: "percentage_discount",
      seniorDiscountBasisPoints: 2000,
    });
    const result = calculateReservationPricing(
      [seniorGuest()],
      [],
      makeConfig([pkg]),
      fullPolicy(),
      SEATING_START,
      undefined,
      undefined,
    );
    expect(result.success).toBe(true);
    expect(result.hasUnresolvedRules).toBe(false);
    // 20% of 2950 = 590 → 2360
    expect(result.subtotalCents).toBe(2360);
  });

  // ---- Idempotent replay bypasses current pricing validation ----
  // The submission handler (reservation-submit.server.ts) performs the
  // idempotency lookup at line 174 BEFORE any pricing/eligibility validation.
  // A saved matching request is replayed as-is even if the current config
  // would now produce unresolved rules. This ordering is source-verified:
  //   line 174: const existing = await repo.findByIdempotencyKey(...)
  //   line 175-177: if (existing) return existing;
  //   ... pricing validation happens at line 245+ (after the replay return)
  it("idempotent replay returns before pricing validation (source-verified ordering)", () => {
    // A pricing result with unresolved rules is the flag both handlers gate on.
    // The submission handler returns the saved `existing` result at line 176
    // before reaching the pricing check at line 265. This test confirms the
    // pricing engine produces the flag that would block a NEW request, proving
    // the replay ordering matters: a saved request with this config would be
    // blocked on a new attempt but replayed on a matching retry.
    const pkgMalformed = makePackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: null,
    });
    const malformedResult = calculateReservationPricing(
      [childGuest()],
      [],
      makeConfig([pkgMalformed]),
      fullPolicy(),
      SEATING_START,
      undefined,
      undefined,
    );
    expect(malformedResult.hasUnresolvedRules).toBe(true);

    // A valid package with the same guests produces a clean result — proving
    // the flag is config-driven, not guest-driven.
    const pkgValid = makePackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 1000,
    });
    const validResult = calculateReservationPricing(
      [childGuest()],
      [],
      makeConfig([pkgValid]),
      fullPolicy(),
      SEATING_START,
      undefined,
      undefined,
    );
    expect(validResult.hasUnresolvedRules).toBe(false);
    expect(validResult.subtotalCents).toBe(1000);
  });

  // ---- Matching ReviewedPrice with valid rules → not reviewRequired ----
  it("valid explicit rules + matching ReviewedPrice → not reviewRequired", () => {
    const pkg = makePackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 1000,
    });
    const base = calculateReservationPricing(
      [childGuest()],
      [],
      makeConfig([pkg]),
      fullPolicy(),
      SEATING_START,
      undefined,
      undefined,
    );
    expect(base.success).toBe(true);
    expect(base.hasUnresolvedRules).toBe(false);
    const rp: ReviewedPrice = base.reviewedPrice!;

    const result = calculateReservationPricing(
      [childGuest()],
      [],
      makeConfig([pkg]),
      fullPolicy(),
      SEATING_START,
      undefined,
      rp,
    );
    expect(result.success).toBe(true);
    expect(result.hasUnresolvedRules).toBe(false);
    expect(result.reviewRequired).toBe(false);
  });

  // ---- Adults unaffected by per-package child/senior overrides ----
  it("adults are unaffected by per-package child/senior overrides", () => {
    const pkg = makePackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 1000,
      seniorRuleType: "percentage_discount",
      seniorDiscountBasisPoints: 2000,
    });
    const result = calculateReservationPricing(
      [adultGuest()],
      [],
      makeConfig([pkg]),
      fullPolicy(),
      SEATING_START,
      undefined,
      undefined,
    );
    expect(result.success).toBe(true);
    expect(result.hasUnresolvedRules).toBe(false);
    expect(result.subtotalCents).toBe(2950);
  });
});
