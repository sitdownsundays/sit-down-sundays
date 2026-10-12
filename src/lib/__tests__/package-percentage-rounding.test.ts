/**
 * Focused regression tests for per-package percentage-discount rounding.
 *
 * The discount must be computed directly from integer cents and integer
 * basis points (baseCents × basisPoints / 10000), rounded once half-up.
 * Dividing basis points by 100 FIRST produces a floating-point percentage
 * (e.g. 64.6) that is not exactly representable and can round a half-cent
 * the wrong way (161.4999… → 161 instead of the correct 162).
 *
 * These exercise the REAL calculateOrder engine over config snapshots.
 */
import { describe, it, expect } from "vitest";
import { calculateOrder, type PricingConfigSnapshot } from "@/lib/ordering/pricing";
import type { MealPackageDTO, GuestPricingRulesDTO } from "@/lib/ordering/types";

const baseRules: GuestPricingRulesDTO = {
  seniorDiscountPercent: null,
  seniorMinAge: null,
  seniorAppliesToPackages: false,
  seniorAppliesToAddons: false,
  seniorAppliesToPlatters: false,
  childRuleType: "none",
  childDiscountPercent: null,
  childFixedPackagePriceCents: null,
  childMaxAge: null,
  childAppliesToPackages: false,
  childAppliesToAddons: false,
  childAppliesToPlatters: false,
  updatedAt: "2026-01-01T00:00:00Z",
};

function pkg(overrides: Partial<MealPackageDTO> = {}): MealPackageDTO {
  return {
    id: "pkg-1",
    name: "Signature",
    slug: "signature",
    description: "",
    pricePerPersonCents: 250,
    includedMeatsCount: 0,
    includedSidesCount: 0,
    includesBread: false,
    includesSoftDrink: false,
    isActive: true,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    createdBy: null,
    updatedBy: null,
    eligibleItems: [],
    childRuleType: null,
    childFixedPriceCents: null,
    childDiscountBasisPoints: null,
    seniorRuleType: null,
    seniorFixedPriceCents: null,
    seniorDiscountBasisPoints: null,
    ...overrides,
  } as MealPackageDTO;
}

function snapshot(p: MealPackageDTO): PricingConfigSnapshot {
  return { packages: [p], addons: [], platters: [], rules: baseRules };
}

function guest(category: "child" | "senior" | "adult") {
  return {
    id: "g1",
    category,
    name: "Guest 1",
    packageId: "pkg-1",
    includedSelections: [],
    addons: [],
  };
}

/** Extract the single package charge line for the guest. */
function packageLine(result: ReturnType<typeof calculateOrder>) {
  return result.lines.find((l) => l.kind === "package");
}
/** Extract the single discount line for the guest. */
function discountLine(result: ReturnType<typeof calculateOrder>) {
  return result.lines.find((l) => l.kind === "senior_discount" || l.kind === "child_rule");
}

describe("per-package percentage rounding (integer basis points)", () => {
  it("250¢ / 6460 bp → 162¢ discount, 88¢ charge (child)", () => {
    const p = pkg({
      childRuleType: "percentage_discount",
      childDiscountBasisPoints: 6460,
    });
    const result = calculateOrder([guest("child")], [], snapshot(p));
    expect(packageLine(result)?.amountCents).toBe(250);
    expect(discountLine(result)?.amountCents).toBe(-162);
    expect(result.subtotalCents).toBe(88);
  });

  it("250¢ / 6460 bp → 162¢ discount, 88¢ charge (senior)", () => {
    const p = pkg({
      seniorRuleType: "percentage_discount",
      seniorDiscountBasisPoints: 6460,
    });
    const result = calculateOrder([guest("senior")], [], snapshot(p));
    expect(packageLine(result)?.amountCents).toBe(250);
    expect(discountLine(result)?.amountCents).toBe(-162);
    expect(result.subtotalCents).toBe(88);
  });

  it("exact half-cent rounds up (250¢ / 20 bp = 0.5¢ → 1¢ discount)", () => {
    // 250 × 20 / 10000 = 0.5 → half-up (Math.round) → 1
    const p = pkg({
      childRuleType: "percentage_discount",
      childDiscountBasisPoints: 20,
    });
    const result = calculateOrder([guest("child")], [], snapshot(p));
    expect(discountLine(result)?.amountCents).toBe(-1);
    expect(result.subtotalCents).toBe(249);
  });

  it("below half-cent rounds down (250¢ / 1 bp = 0.025¢ → 0¢ discount)", () => {
    // 250 × 1 / 10000 = 0.025 → rounds to 0
    const p = pkg({
      childRuleType: "percentage_discount",
      childDiscountBasisPoints: 1,
    });
    const result = calculateOrder([guest("child")], [], snapshot(p));
    // No discount line emitted when discountCents rounds to 0.
    expect(discountLine(result)).toBeUndefined();
    expect(result.subtotalCents).toBe(250);
  });

  it("above half-cent rounds up (334¢ / 15 bp = 0.501¢ → 1¢ discount)", () => {
    // 334 × 15 / 10000 = 0.501 → rounds to 1
    const p1 = pkg({
      pricePerPersonCents: 334,
      childRuleType: "percentage_discount",
      childDiscountBasisPoints: 15,
    });
    const r1 = calculateOrder([guest("child")], [], snapshot(p1));
    expect(discountLine(r1)?.amountCents).toBe(-1);
    expect(r1.subtotalCents).toBe(333);
    // 333 × 15 / 10000 = 0.4995 → rounds to 0
    const p0 = pkg({
      pricePerPersonCents: 333,
      childRuleType: "percentage_discount",
      childDiscountBasisPoints: 15,
    });
    const r0 = calculateOrder([guest("child")], [], snapshot(p0));
    expect(r0.subtotalCents).toBe(333);
  });

  it("0% → zero discount, full price", () => {
    const p = pkg({
      childRuleType: "percentage_discount",
      childDiscountBasisPoints: 0,
    });
    const result = calculateOrder([guest("child")], [], snapshot(p));
    expect(discountLine(result)).toBeUndefined();
    expect(result.subtotalCents).toBe(250);
  });

  it("100% → full discount, zero charge", () => {
    const p = pkg({
      seniorRuleType: "percentage_discount",
      seniorDiscountBasisPoints: 10000,
    });
    const result = calculateOrder([guest("senior")], [], snapshot(p));
    expect(packageLine(result)?.amountCents).toBe(250);
    expect(discountLine(result)?.amountCents).toBe(-250);
    expect(result.subtotalCents).toBe(0);
  });

  it("ordinary percentage (10% of 250 → 25¢ discount)", () => {
    const p = pkg({
      childRuleType: "percentage_discount",
      childDiscountBasisPoints: 1000,
    });
    const result = calculateOrder([guest("child")], [], snapshot(p));
    expect(discountLine(result)?.amountCents).toBe(-25);
    expect(result.subtotalCents).toBe(225);
  });

  it("adult prices are unchanged by per-package child/senior rules", () => {
    const p = pkg({
      childRuleType: "percentage_discount",
      childDiscountBasisPoints: 6460,
      seniorRuleType: "percentage_discount",
      seniorDiscountBasisPoints: 6460,
    });
    const result = calculateOrder([guest("adult")], [], snapshot(p));
    expect(packageLine(result)?.amountCents).toBe(250);
    expect(discountLine(result)).toBeUndefined();
    expect(result.subtotalCents).toBe(250);
  });

  it("fixed-price overrides are unaffected by the rounding change", () => {
    const p = pkg({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 88,
    });
    const result = calculateOrder([guest("child")], [], snapshot(p));
    expect(packageLine(result)?.amountCents).toBe(250);
    expect(discountLine(result)?.amountCents).toBe(-162);
    expect(result.subtotalCents).toBe(88);
  });

  it("null override preserves global-rule behavior (no discount here)", () => {
    const p = pkg({ childRuleType: null, seniorRuleType: null });
    const result = calculateOrder([guest("child")], [], snapshot(p));
    expect(packageLine(result)?.amountCents).toBe(250);
    expect(discountLine(result)).toBeUndefined();
    expect(result.subtotalCents).toBe(250);
  });
});
