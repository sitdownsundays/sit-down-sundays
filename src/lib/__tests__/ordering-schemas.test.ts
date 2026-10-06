/**
 * Ordering schemas — strict field rejection tests.
 *
 * Verifies create/update schemas reject browser-supplied ids, audit fields,
 * missing expectedUpdatedAt, negative prices, and over-maximum prices.
 */
import { describe, it, expect } from "vitest";
import { createMealPackageSchema, updateMealPackageSchema } from "@/lib/ordering/schema";

describe("ordering schemas — strict field rejection", () => {
  it("createMealPackageSchema rejects a browser-supplied id", () => {
    const result = createMealPackageSchema.safeParse({
      name: "Test",
      slug: "test",
      pricePerPersonCents: 2950,
      includedMeatsCount: 2,
      includedSidesCount: 2,
      id: "hacked-id",
    });
    expect(result.success).toBe(false);
  });

  it("createMealPackageSchema rejects audit fields", () => {
    const result = createMealPackageSchema.safeParse({
      name: "Test",
      slug: "test",
      pricePerPersonCents: 2950,
      includedMeatsCount: 2,
      includedSidesCount: 2,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("updateMealPackageSchema requires expectedUpdatedAt", () => {
    const result = updateMealPackageSchema.safeParse({
      id: "11111111-0000-4000-8000-000000000001",
      name: "Updated",
    });
    expect(result.success).toBe(false);
  });

  it("updateMealPackageSchema rejects a negative price", () => {
    const result = updateMealPackageSchema.safeParse({
      id: "11111111-0000-4000-8000-000000000001",
      expectedUpdatedAt: "2026-01-01T00:00:00Z",
      pricePerPersonCents: -100,
    });
    expect(result.success).toBe(false);
  });

  it("updateMealPackageSchema rejects a price over the safety maximum", () => {
    const result = updateMealPackageSchema.safeParse({
      id: "11111111-0000-4000-8000-000000000001",
      expectedUpdatedAt: "2026-01-01T00:00:00Z",
      pricePerPersonCents: 1_000_001,
    });
    expect(result.success).toBe(false);
  });
});
