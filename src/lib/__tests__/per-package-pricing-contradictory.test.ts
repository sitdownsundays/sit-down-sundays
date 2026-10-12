/**
 * Focused tests for malformed per-package child/senior pricing-rule handling.
 *
 * The engine must validate its inputs independently of database constraints:
 * contradictory combinations (e.g. fixed_package_price WITH a percentage value,
 * none WITH a fixed price) must produce an unresolved-pricing signal — not
 * silently choose one value, fall back globally, or return an unmarked total.
 *
 * Exercises the real calculateOrder engine.
 */
import { describe, it, expect } from "vitest";
import { calculateOrder } from "@/lib/ordering/pricing";
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

// Global rules fully configured so a null per-package override falls through
// to a VALID global rule — no unresolved notes from the global path itself.
// Global childRuleType "none" means "Not configured" and produces a note, so
// we use a valid percentage_discount (0%) instead.
const defaultRules: GuestPricingRulesDTO = {
  seniorDiscountPercent: 5,
  seniorMinAge: 65,
  seniorAppliesToPackages: true,
  seniorAppliesToAddons: false,
  seniorAppliesToPlatters: false,
  childRuleType: "percentage_discount",
  childDiscountPercent: 0,
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

function mkGuest(category: "child" | "senior", pkgId = "pkg-001"): OrderGuest {
  return {
    id: `g-${category}`,
    category,
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

describe("contradictory per-package pricing rules", () => {
  // ── Fixed rule with a percentage value ──────────────────────────────────

  it("child: fixed_package_price with a percentage value → unresolved", () => {
    const pkg = mkPackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 1000,
      childDiscountBasisPoints: 500,
    });
    const result = calculateOrder([mkGuest("child")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => /percentage/i.test(n))).toBe(true);
  });

  it("senior: fixed_package_price with a percentage value → unresolved", () => {
    const pkg = mkPackage({
      seniorRuleType: "fixed_package_price",
      seniorFixedPriceCents: 1000,
      seniorDiscountBasisPoints: 500,
    });
    const result = calculateOrder([mkGuest("senior")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => /percentage/i.test(n))).toBe(true);
  });

  // ── Percentage rule with a fixed value ───────────────────────────────────

  it("child: percentage_discount with a fixed value → unresolved", () => {
    const pkg = mkPackage({
      childRuleType: "percentage_discount",
      childFixedPriceCents: 1000,
      childDiscountBasisPoints: 1000,
    });
    const result = calculateOrder([mkGuest("child")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => /fixed/i.test(n))).toBe(true);
  });

  it("senior: percentage_discount with a fixed value → unresolved", () => {
    const pkg = mkPackage({
      seniorRuleType: "percentage_discount",
      seniorFixedPriceCents: 1000,
      seniorDiscountBasisPoints: 1000,
    });
    const result = calculateOrder([mkGuest("senior")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => /fixed/i.test(n))).toBe(true);
  });

  // ── "none" with a numeric value ──────────────────────────────────────────

  it("child: none with a fixed price → unresolved", () => {
    const pkg = mkPackage({
      childRuleType: "none",
      childFixedPriceCents: 1000,
      childDiscountBasisPoints: null,
    });
    const result = calculateOrder([mkGuest("child")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => /amount is present/i.test(n))).toBe(true);
  });

  it("child: none with a percentage value → unresolved", () => {
    const pkg = mkPackage({
      childRuleType: "none",
      childFixedPriceCents: null,
      childDiscountBasisPoints: 500,
    });
    const result = calculateOrder([mkGuest("child")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => /amount is present/i.test(n))).toBe(true);
  });

  it("senior: none with a fixed price → unresolved", () => {
    const pkg = mkPackage({
      seniorRuleType: "none",
      seniorFixedPriceCents: 1000,
      seniorDiscountBasisPoints: null,
    });
    const result = calculateOrder([mkGuest("senior")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => /amount is present/i.test(n))).toBe(true);
  });

  it("senior: none with a percentage value → unresolved", () => {
    const pkg = mkPackage({
      seniorRuleType: "none",
      seniorFixedPriceCents: null,
      seniorDiscountBasisPoints: 500,
    });
    const result = calculateOrder([mkGuest("senior")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => /amount is present/i.test(n))).toBe(true);
  });

  // ── null rule with a numeric value ───────────────────────────────────────
  // The critical case: validation must occur BEFORE the global-fallback branch.

  it("child: null rule with a fixed price → unresolved (not global fallback)", () => {
    const pkg = mkPackage({
      childRuleType: null,
      childFixedPriceCents: 1000,
      childDiscountBasisPoints: null,
    });
    const result = calculateOrder([mkGuest("child")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => /not set but an amount/i.test(n))).toBe(true);
  });

  it("child: null rule with a percentage value → unresolved (not global fallback)", () => {
    const pkg = mkPackage({
      childRuleType: null,
      childFixedPriceCents: null,
      childDiscountBasisPoints: 500,
    });
    const result = calculateOrder([mkGuest("child")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => /not set but an amount/i.test(n))).toBe(true);
  });

  it("senior: null rule with a fixed price → unresolved (not global fallback)", () => {
    const pkg = mkPackage({
      seniorRuleType: null,
      seniorFixedPriceCents: 1000,
      seniorDiscountBasisPoints: null,
    });
    const result = calculateOrder([mkGuest("senior")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => /not set but an amount/i.test(n))).toBe(true);
  });

  it("senior: null rule with a percentage value → unresolved (not global fallback)", () => {
    const pkg = mkPackage({
      seniorRuleType: null,
      seniorFixedPriceCents: null,
      seniorDiscountBasisPoints: 500,
    });
    const result = calculateOrder([mkGuest("senior")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(true);
    expect(result.unresolvedNotes.some((n) => /not set but an amount/i.test(n))).toBe(true);
  });

  // ── Valid configurations remain accepted ────────────────────────────────

  it("child: valid all-null fallback → no unresolved rules", () => {
    const pkg = mkPackage();
    const result = calculateOrder([mkGuest("child")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(false);
  });

  it("senior: valid all-null fallback → no unresolved rules", () => {
    const pkg = mkPackage();
    const result = calculateOrder([mkGuest("senior")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(false);
  });

  it("child: valid none → no unresolved rules, full price", () => {
    const pkg = mkPackage({
      childRuleType: "none",
      childFixedPriceCents: null,
      childDiscountBasisPoints: null,
    });
    const result = calculateOrder([mkGuest("child")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(false);
    expect(result.subtotalCents).toBe(2950);
  });

  it("senior: valid none → no unresolved rules, full price", () => {
    const pkg = mkPackage({
      seniorRuleType: "none",
      seniorFixedPriceCents: null,
      seniorDiscountBasisPoints: null,
    });
    const result = calculateOrder([mkGuest("senior")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(false);
    expect(result.subtotalCents).toBe(2950);
  });

  it("child: valid fixed zero → no unresolved rules, full price (discount = base)", () => {
    const pkg = mkPackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 0,
      childDiscountBasisPoints: null,
    });
    const result = calculateOrder([mkGuest("child")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(false);
    expect(result.subtotalCents).toBe(0);
  });

  it("child: valid 0% percentage → no unresolved rules, full price", () => {
    const pkg = mkPackage({
      childRuleType: "percentage_discount",
      childFixedPriceCents: null,
      childDiscountBasisPoints: 0,
    });
    const result = calculateOrder([mkGuest("child")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(false);
    expect(result.subtotalCents).toBe(2950);
  });

  it("child: valid 100% percentage → no unresolved rules, free", () => {
    const pkg = mkPackage({
      childRuleType: "percentage_discount",
      childFixedPriceCents: null,
      childDiscountBasisPoints: 10000,
    });
    const result = calculateOrder([mkGuest("child")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(false);
    expect(result.subtotalCents).toBe(0);
  });

  it("senior: valid 100% percentage → no unresolved rules, free", () => {
    const pkg = mkPackage({
      seniorRuleType: "percentage_discount",
      seniorFixedPriceCents: null,
      seniorDiscountBasisPoints: 10000,
    });
    const result = calculateOrder([mkGuest("senior")], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(false);
    expect(result.subtotalCents).toBe(0);
  });

  // ── Adults are unaffected ───────────────────────────────────────────────

  it("adult guest is unaffected by child/senior contradictory rules", () => {
    const pkg = mkPackage({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 1000,
      childDiscountBasisPoints: 500,
      seniorRuleType: "none",
      seniorFixedPriceCents: 1000,
    });
    const adult: OrderGuest = {
      id: "g-adult",
      category: "adult",
      packageId: "pkg-001",
      includedSelections: [
        { menuItemId: MEAT_A, selectionCategory: "meat" },
        { menuItemId: MEAT_B, selectionCategory: "meat" },
        { menuItemId: SIDE_A, selectionCategory: "side" },
        { menuItemId: SIDE_B, selectionCategory: "side" },
      ],
      addons: [],
    };
    const result = calculateOrder([adult], [], mkConfig([pkg]));
    expect(result.hasUnresolvedRules).toBe(false);
    expect(result.subtotalCents).toBe(2950);
  });
});
