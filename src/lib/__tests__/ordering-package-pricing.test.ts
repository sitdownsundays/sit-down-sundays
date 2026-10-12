/**
 * Migration 0024 read/type contract — per-package child and senior pricing.
 *
 * Tests the real MockOrderingRepository mapping code (the production read path
 * available without a live Supabase instance). Verifies the six new
 * MealPackageDTO fields are present, default to null (legacy behavior), are
 * preserved through updates, and are independent between packages.
 *
 * The Supabase validatePackageRuleType mapper is source-inspected only — it
 * throws on unrecognized rule_type values rather than coercing to null, but it
 * is not exported for direct testing.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MockOrderingRepository } from "@/lib/server/ordering-mock.server";
import type { MealPackageDTO } from "@/lib/ordering/types";

const SIX_FIELDS = [
  "childRuleType",
  "childFixedPriceCents",
  "childDiscountBasisPoints",
  "seniorRuleType",
  "seniorFixedPriceCents",
  "seniorDiscountBasisPoints",
] as const;

function assertAllNull(pkg: MealPackageDTO) {
  for (const field of SIX_FIELDS) {
    expect(pkg[field], `${field} should be null`).toBeNull();
  }
}

describe("MealPackageDTO — 0024 per-package pricing fields", () => {
  let repo: MockOrderingRepository;

  beforeEach(() => {
    repo = new MockOrderingRepository();
  });

  it("seed packages expose all six fields as null (legacy global behavior)", async () => {
    const packages = await repo.listPackages();
    expect(packages.length).toBeGreaterThanOrEqual(3);
    for (const pkg of packages) {
      assertAllNull(pkg);
    }
  });

  it("a created package defaults all six fields to null", async () => {
    const created = await repo.createPackage("actor-1", {
      name: "Test Package",
      slug: "test-package-0024",
      description: "",
      pricePerPersonCents: 2950,
      includedMeatsCount: 2,
      includedSidesCount: 2,
      isActive: true,
      displayOrder: 0,
    });
    expect(created.success).toBe(true);
    const pkg = created.data!;
    assertAllNull(pkg);
  });

  it("preserves the six fields through updatePackage (spread retains existing)", async () => {
    const created = await repo.createPackage("actor-1", {
      name: "Test Package",
      slug: "test-pkg-preserve",
      description: "",
      pricePerPersonCents: 2950,
      includedMeatsCount: 2,
      includedSidesCount: 2,
      isActive: true,
      displayOrder: 0,
    });
    const pkg = created.data!;

    // Update with only a name change — the six pricing fields should be
    // preserved by the existing spread, not wiped to undefined.
    const updated = await repo.updatePackage("actor-1", {
      id: pkg.id,
      expectedUpdatedAt: pkg.updatedAt,
      name: "Renamed Package",
    });
    expect(updated.success).toBe(true);
    assertAllNull(updated.data!);

    // Also verify after re-reading from the repository.
    const list = await repo.listPackages();
    const reloaded = list.find((p) => p.id === pkg.id)!;
    assertAllNull(reloaded);
  });

  it("fields are independent between packages", async () => {
    const packages = await repo.listPackages();
    expect(packages.length).toBeGreaterThanOrEqual(3);
    // Each package should have its own null values — mutating one doesn't
    // affect another (the mock stores them as separate object instances).
    const [a, b] = packages;
    expect(a.childRuleType).toBeNull();
    expect(b.childRuleType).toBeNull();
    expect(a.seniorRuleType).toBeNull();
    expect(b.seniorRuleType).toBeNull();
    // They are distinct objects, not shared references.
    expect(a).not.toBe(b);
  });
});

/**
 * Direct DTO construction tests — verifies the TypeScript contract enforces
 * the correct types (null | ChildRuleType for rule types, null | number for
 * amounts) and that all four rule types are valid, including zero values.
 */
describe("MealPackageDTO — 0024 rule-type and amount contract", () => {
  function mkPkg(overrides: Partial<MealPackageDTO>): MealPackageDTO {
    return {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Test",
      slug: "test",
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
      eligibleItems: [],
      childRuleType: null,
      childFixedPriceCents: null,
      childDiscountBasisPoints: null,
      seniorRuleType: null,
      seniorFixedPriceCents: null,
      seniorDiscountBasisPoints: null,
      ...overrides,
    };
  }

  it("accepts fixed child price and percentage senior discount", () => {
    const pkg = mkPkg({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 1500,
      childDiscountBasisPoints: null,
      seniorRuleType: "percentage_discount",
      seniorFixedPriceCents: null,
      seniorDiscountBasisPoints: 1000,
    });
    expect(pkg.childRuleType).toBe("fixed_package_price");
    expect(pkg.childFixedPriceCents).toBe(1500);
    expect(pkg.childDiscountBasisPoints).toBeNull();
    expect(pkg.seniorRuleType).toBe("percentage_discount");
    expect(pkg.seniorDiscountBasisPoints).toBe(1000);
    expect(pkg.seniorFixedPriceCents).toBeNull();
  });

  it("accepts percentage child discount and explicit senior 'none'", () => {
    const pkg = mkPkg({
      childRuleType: "percentage_discount",
      childFixedPriceCents: null,
      childDiscountBasisPoints: 1250,
      seniorRuleType: "none",
      seniorFixedPriceCents: null,
      seniorDiscountBasisPoints: null,
    });
    expect(pkg.childRuleType).toBe("percentage_discount");
    expect(pkg.childDiscountBasisPoints).toBe(1250);
    expect(pkg.seniorRuleType).toBe("none");
    expect(pkg.seniorFixedPriceCents).toBeNull();
    expect(pkg.seniorDiscountBasisPoints).toBeNull();
  });

  it("preserves zero as a valid configured value, not missing", () => {
    const pkg = mkPkg({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 0,
      childDiscountBasisPoints: null,
      seniorRuleType: "percentage_discount",
      seniorFixedPriceCents: null,
      seniorDiscountBasisPoints: 0,
    });
    expect(pkg.childFixedPriceCents).toBe(0);
    expect(pkg.childFixedPriceCents).not.toBeNull();
    expect(pkg.seniorDiscountBasisPoints).toBe(0);
    expect(pkg.seniorDiscountBasisPoints).not.toBeNull();
  });

  it("supports independent child and senior settings on the same package", () => {
    const pkg = mkPkg({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 1200,
      childDiscountBasisPoints: null,
      seniorRuleType: "fixed_package_price",
      seniorFixedPriceCents: 2000,
      seniorDiscountBasisPoints: null,
    });
    expect(pkg.childFixedPriceCents).toBe(1200);
    expect(pkg.seniorFixedPriceCents).toBe(2000);
    expect(pkg.childFixedPriceCents).not.toBe(pkg.seniorFixedPriceCents);
  });

  it("supports independent settings on different packages", () => {
    const pkgA = mkPkg({
      id: "00000000-0000-4000-8000-000000000a01",
      slug: "pkg-a",
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 1000,
    });
    const pkgB = mkPkg({
      id: "00000000-0000-4000-8000-000000000b02",
      slug: "pkg-b",
      childRuleType: "percentage_discount",
      childDiscountBasisPoints: 500,
    });
    expect(pkgA.childRuleType).toBe("fixed_package_price");
    expect(pkgA.childFixedPriceCents).toBe(1000);
    expect(pkgB.childRuleType).toBe("percentage_discount");
    expect(pkgB.childDiscountBasisPoints).toBe(500);
    // Different rules on different packages.
    expect(pkgA.childRuleType).not.toBe(pkgB.childRuleType);
  });

  it("all-null is valid (legacy global behavior)", () => {
    const pkg = mkPkg({});
    assertAllNull(pkg);
  });
});
