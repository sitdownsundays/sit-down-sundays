/**
 * Per-package child and senior pricing — real shared order-pricing engine.
 *
 * Exercises the actual calculateOrder engine with MealPackageDTO objects
 * that carry per-package overrides (migration 0024 fields).
 */
import { describe, it, expect } from "vitest";
import { calculateOrder, roundCents } from "@/lib/ordering/pricing";
import type { OrderGuest, PricingConfigSnapshot } from "@/lib/ordering/pricing";
import type { MealPackageDTO, GuestPricingRulesDTO } from "@/lib/ordering/types";

const MEAT_A = "11111111-0000-4000-8000-000000000001";
const MEAT_B = "11111111-0000-4000-8000-000000000002";
const SIDE_A = "22222222-0000-4000-8000-000000000001";
const SIDE_B = "22222222-0000-4000-8000-000000000002";

function mkPackage(overrides: Partial<MealPackageDTO> = {}): MealPackageDTO {
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

const defaultRules: GuestPricingRulesDTO = {
  seniorDiscountPercent: 5,
  seniorMinAge: 65,
  seniorAppliesToPackages: true,
  seniorAppliesToAddons: false,
  seniorAppliesToPlatters: false,
  childRuleType: "none",
  childDiscountPercent: null,
  childFixedPackagePriceCents: null,
  childMaxAge: 12,
  childAppliesToPackages: true,
  childAppliesToAddons: false,
  childAppliesToPlatters: false,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function mkConfig(
  packages: MealPackageDTO[],
  rules: GuestPricingRulesDTO = defaultRules,
): PricingConfigSnapshot {
  return { packages, addons: [], platters: [], rules };
}

function adultGuest(pkgId = "pkg-001"): OrderGuest {
  return {
    id: "g-adult",
    category: "adult",
    packageId: pkgId,
    includedSelections: [
      { menuItemId: MEAT_A, selectionCategory: "meat" },
      { menuItemId: MEAT_B, selectionCategory: "meat" },
      { menuItemId: SIDE_A, selectionCategory: "side" },
      { menuItemId: SIDE_B, selectionCategory: "side" },
    ],
    addons: [],
  };
}
function childGuest(pkgId = "pkg-001"): OrderGuest {
  return {
    id: "g-child",
    category: "child",
    packageId: pkgId,
    includedSelections: [
      { menuItemId: MEAT_A, selectionCategory: "meat" },
      { menuItemId: MEAT_B, selectionCategory: "meat" },
      { menuItemId: SIDE_A, selectionCategory: "side" },
      { menuItemId: SIDE_B, selectionCategory: "side" },
    ],
    addons: [],
  };
}
function seniorGuest(pkgId = "pkg-001"): OrderGuest {
  return {
    id: "g-senior",
    category: "senior",
    packageId: pkgId,
    includedSelections: [
      { menuItemId: MEAT_A, selectionCategory: "meat" },
      { menuItemId: MEAT_B, selectionCategory: "meat" },
      { menuItemId: SIDE_A, selectionCategory: "side" },
      { menuItemId: SIDE_B, selectionCategory: "side" },
    ],
    addons: [],
  };
}

describe("per-package pricing — real engine", () => {
  it("null rules preserve existing global behavior", () => {
    const pkg = mkPackage();
    const result = calculateOrder([seniorGuest()], [], mkConfig([pkg]));
    // 5% senior global: 2950 * 0.05 = 147.5 → 148
    expect(result.subtotalCents).toBe(2950 - 148);
    expect(result.hasUnresolvedRules).toBe(false);
  });

  it("fixed child price overrides a global percentage", () => {
    const globalPct: GuestPricingRulesDTO = {
      ...defaultRules,
      childRuleType: "percentage_discount",
      childDiscountPercent: 50,
      childMaxAge: 12,
    };
    const pkg = mkPackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 1000,
      childDiscountBasisPoints: null,
    });
    const result = calculateOrder([childGuest()], [], mkConfig([pkg], globalPct));
    // fixed child price 1000 overrides global 50%
    expect(result.subtotalCents).toBe(1000);
    expect(result.hasUnresolvedRules).toBe(false);
  });

  it("package percentage overrides a global fixed child price", () => {
    const globalFixed: GuestPricingRulesDTO = {
      ...defaultRules,
      childRuleType: "fixed_package_price",
      childFixedPackagePriceCents: 1000,
      childMaxAge: 12,
    };
    const pkg = mkPackage({
      childRuleType: "percentage_discount",
      childDiscountBasisPoints: 1000,
      childFixedPriceCents: null,
    });
    const result = calculateOrder([childGuest()], [], mkConfig([pkg], globalFixed));
    // 10% of 2950 = 295 → net 2655
    expect(result.subtotalCents).toBe(2950 - 295);
    expect(result.hasUnresolvedRules).toBe(false);
  });

  it("explicit 'none' overrides a global discount", () => {
    const globalPct: GuestPricingRulesDTO = {
      ...defaultRules,
      childRuleType: "percentage_discount",
      childDiscountPercent: 50,
      childMaxAge: 12,
    };
    const pkg = mkPackage({
      childRuleType: "none",
      childFixedPriceCents: null,
      childDiscountBasisPoints: null,
    });
    const result = calculateOrder([childGuest()], [], mkConfig([pkg], globalPct));
    // "none" = explicitly full price, no global 50% discount
    expect(result.subtotalCents).toBe(2950);
    expect(result.hasUnresolvedRules).toBe(false);
  });

  it("senior and child rules work independently on the same package", () => {
    const pkg = mkPackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 1200,
      childDiscountBasisPoints: null,
      seniorRuleType: "percentage_discount",
      seniorFixedPriceCents: null,
      seniorDiscountBasisPoints: 2000,
    });
    const result = calculateOrder([childGuest(), seniorGuest()], [], mkConfig([pkg]));
    // child: 2950 - (2950-1200) = 1200
    // senior: 2950 * 0.20 = 590 → 2360
    expect(result.subtotalCents).toBe(1200 + 2360);
    expect(result.hasUnresolvedRules).toBe(false);
  });

  it("different packages produce independently configured prices", () => {
    const pkgA = mkPackage({
      id: "pkg-a",
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 1000,
    });
    const pkgB = mkPackage({
      id: "pkg-b",
      childRuleType: "percentage_discount",
      childDiscountBasisPoints: 500,
    });
    const result = calculateOrder(
      [childGuest("pkg-a"), childGuest("pkg-b")],
      [],
      mkConfig([pkgA, pkgB]),
    );
    // pkg-a: 2950 - 1950 = 1000
    // pkg-b: 2950 * 0.05 = 147.5 → 148 → 2802
    expect(result.subtotalCents).toBe(1000 + (2950 - 148));
    expect(result.hasUnresolvedRules).toBe(false);
  });

  it("zero fixed price, 0%, and 100% remain valid", () => {
    // zero fixed
    const pkgZero = mkPackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 0,
    });
    const r0 = calculateOrder([childGuest()], [], mkConfig([pkgZero]));
    expect(r0.subtotalCents).toBe(0);
    expect(r0.hasUnresolvedRules).toBe(false);

    // 0% discount
    const pkg0pct = mkPackage({
      childRuleType: "percentage_discount",
      childDiscountBasisPoints: 0,
    });
    const r0pct = calculateOrder([childGuest()], [], mkConfig([pkg0pct]));
    // 0% → discountAmount returns 0 for percent<=0, so full price
    expect(r0pct.subtotalCents).toBe(2950);

    // 100% discount
    const pkg100pct = mkPackage({
      childRuleType: "percentage_discount",
      childDiscountBasisPoints: 10000,
    });
    const r100 = calculateOrder([childGuest()], [], mkConfig([pkg100pct]));
    // 100% of 2950 = 2950 → net 0
    expect(r100.subtotalCents).toBe(0);
  });

  it("fractional-cent percentage rounding follows the existing convention", () => {
    expect(roundCents(147.5)).toBe(148);
    expect(roundCents(147.4)).toBe(147);
    // Verify the engine uses this for a senior percentage override
    const pkg = mkPackage({
      seniorRuleType: "percentage_discount",
      seniorDiscountBasisPoints: 500,
    });
    const result = calculateOrder([seniorGuest()], [], mkConfig([pkg]));
    // 2950 * 0.05 = 147.5 → 148
    expect(result.subtotalCents).toBe(2950 - 148);
  });

  it("malformed explicit configurations fail safely", () => {
    // missing required amount for fixed_package_price
    const pkgMissingFixed = mkPackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: null,
    });
    const r1 = calculateOrder([childGuest()], [], mkConfig([pkgMissingFixed]));
    expect(r1.hasUnresolvedRules).toBe(true);
    expect(r1.subtotalCents).toBe(2950);
    expect(r1.unresolvedNotes.some((n) => n.includes("Child fixed price is not configured"))).toBe(
      true,
    );

    // percentage over 10000
    const pkgOverPct = mkPackage({
      childRuleType: "percentage_discount",
      childDiscountBasisPoints: 10001,
    });
    const r2 = calculateOrder([childGuest()], [], mkConfig([pkgOverPct]));
    expect(r2.hasUnresolvedRules).toBe(true);
    expect(r2.subtotalCents).toBe(2950);
    expect(r2.unresolvedNotes.some((n) => n.includes("exceed 10000"))).toBe(true);

    // fixed above regular price
    const pkgOverFixed = mkPackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 3000,
    });
    const r3 = calculateOrder([childGuest()], [], mkConfig([pkgOverFixed]));
    expect(r3.hasUnresolvedRules).toBe(true);
    expect(r3.subtotalCents).toBe(2950);
    expect(r3.unresolvedNotes.some((n) => n.includes("exceeds the regular package price"))).toBe(
      true,
    );

    // non-integer fixed
    const pkgNonInt = mkPackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 1000.5 as unknown as number,
    });
    const r4 = calculateOrder([childGuest()], [], mkConfig([pkgNonInt]));
    expect(r4.hasUnresolvedRules).toBe(true);
    expect(r4.subtotalCents).toBe(2950);

    // negative fixed
    const pkgNeg = mkPackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: -100 as unknown as number,
    });
    const r5 = calculateOrder([childGuest()], [], mkConfig([pkgNeg]));
    expect(r5.hasUnresolvedRules).toBe(true);
    expect(r5.subtotalCents).toBe(2950);
  });

  it("adults remain unchanged by per-package child/senior overrides", () => {
    const pkg = mkPackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 1000,
      seniorRuleType: "percentage_discount",
      seniorDiscountBasisPoints: 1000,
    });
    const result = calculateOrder([adultGuest()], [], mkConfig([pkg]));
    // adult never gets a discount
    expect(result.subtotalCents).toBe(2950);
    expect(result.hasUnresolvedRules).toBe(false);
  });
});
