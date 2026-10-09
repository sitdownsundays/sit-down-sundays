/**
 * Behavioral tests for "Copy meal to…" helper functions.
 *
 * These exercise the REAL production helpers in
 * src/lib/booking/meals-helpers.ts — not copied logic. Helper-level tests,
 * NOT rendered component tests and NOT live server tests.
 */
import { describe, it, expect } from "vitest";
import {
  copyMealToGuests,
  copyMealImpact,
  type GuestAllocation,
} from "@/lib/booking/meals-helpers";
import type { PublicIndividualAddon } from "@/lib/booking/public-catalog";

function guest(
  guestIndex: number,
  category: "adult" | "senior" | "child",
  packageId: string | null,
  included: Array<{ menuItemId: string; selectionCategory: string }>,
  addons: Array<{ addonId: string; quantity: number }>,
  name?: string,
): GuestAllocation {
  return {
    guestIndex,
    category,
    name: name ?? `Guest ${guestIndex + 1}`,
    packageId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    included: included as any,
    addons,
    foodAllergies: "",
    dietaryPreferences: "",
    mealRequests: "",
  };
}

function addon(id: string, eligiblePackageIds: string[], active = true): PublicIndividualAddon {
  return {
    id,
    name: id,
    description: "",
    priceCents: 500,
    eligiblePackageIds,
    isActive: active,
  };
}

const PKG_A = "pkg-a";
const PKG_B = "pkg-b";

describe("copyMealToGuests", () => {
  it("copies package + included selections to one selected guest", () => {
    const source = guest(
      0,
      "adult",
      PKG_A,
      [
        { menuItemId: "m1", selectionCategory: "meat" },
        { menuItemId: "m2", selectionCategory: "meat" },
        { menuItemId: "s1", selectionCategory: "side" },
        { menuItemId: "s2", selectionCategory: "side" },
        { menuItemId: "b1", selectionCategory: "bread" },
      ],
      [],
    );
    const target = guest(1, "adult", null, [], []);
    const allocs = [source, target];

    const result = copyMealToGuests(allocs, 0, [1]);

    expect(result[0]).toBe(source); // source unchanged (same reference)
    expect(result[1].packageId).toBe(PKG_A);
    expect(result[1].included).toHaveLength(5);
    expect(result[1].included.map((s) => s.menuItemId)).toEqual(["m1", "m2", "s1", "s2", "b1"]);
  });

  it("copies to all other guests", () => {
    const source = guest(0, "adult", PKG_A, [{ menuItemId: "m1", selectionCategory: "meat" }], []);
    const t1 = guest(1, "senior", null, [], []);
    const t2 = guest(2, "child", null, [], []);
    const allocs = [source, t1, t2];

    const result = copyMealToGuests(allocs, 0, [1, 2]);

    expect(result[0]).toBe(source);
    expect(result[1].packageId).toBe(PKG_A);
    expect(result[2].packageId).toBe(PKG_A);
  });

  it("preserves guest categories and identities; source unchanged", () => {
    const source = guest(0, "adult", PKG_A, [{ menuItemId: "m1", selectionCategory: "meat" }], []);
    const target = guest(2, "child", PKG_B, [], []);
    const allocs = [source, guest(1, "adult", null, [], []), target];

    const result = copyMealToGuests(allocs, 0, [2]);

    // Target keeps its own category and name, not the source's.
    expect(result[2].category).toBe("child");
    expect(result[2].name).toBe("Guest 3");
    // Source is untouched.
    expect(result[0].category).toBe("adult");
    expect(result[0].included).toBe(source.included);
  });

  it("produces independent copies (mutating one recipient does not affect source)", () => {
    const source = guest(0, "adult", PKG_A, [{ menuItemId: "m1", selectionCategory: "meat" }], []);
    const target = guest(1, "adult", null, [], []);
    const allocs = [source, target];

    const result = copyMealToGuests(allocs, 0, [1]);

    // Mutate the recipient's included copy.
    result[1].included[0].menuItemId = "CHANGED";
    // Source must be unaffected.
    expect(source.included[0].menuItemId).toBe("m1");
    expect(result[0].included[0].menuItemId).toBe("m1");
  });

  it("preserves eligible add-ons and removes incompatible ones", () => {
    const source = guest(0, "adult", PKG_A, [], []);
    // target has two add-ons: one eligible for PKG_A, one only eligible for PKG_B
    const target = guest(
      1,
      "adult",
      PKG_B,
      [],
      [
        { addonId: "ad-both", quantity: 1 },
        { addonId: "ad-b-only", quantity: 2 },
      ],
    );
    const allocs = [source, target];
    const catalogAddons = [addon("ad-both", [PKG_A, PKG_B]), addon("ad-b-only", [PKG_B])];

    const result = copyMealToGuests(allocs, 0, [1], catalogAddons);

    // ad-both survives (eligible for PKG_A), ad-b-only removed.
    expect(result[1].addons).toHaveLength(1);
    expect(result[1].addons[0].addonId).toBe("ad-both");
    expect(result[1].addons[0].quantity).toBe(1);
  });

  it("does not copy individual add-ons from the source", () => {
    const source = guest(
      0,
      "adult",
      PKG_A,
      [{ menuItemId: "m1", selectionCategory: "meat" }],
      [{ addonId: "ad-source", quantity: 3 }],
    );
    const target = guest(1, "adult", null, [], []);
    const allocs = [source, target];

    const result = copyMealToGuests(allocs, 0, [1], [addon("ad-source", [PKG_A])]);

    // Source add-on is NOT copied to the recipient.
    expect(result[1].addons).toHaveLength(0);
    expect(result[1].included).toHaveLength(1); // only the meal selection copied
  });

  it("does not modify shared platters (those live in wizard state, not allocations)", () => {
    const source = guest(0, "adult", PKG_A, [{ menuItemId: "m1", selectionCategory: "meat" }], []);
    const target = guest(1, "adult", null, [], []);
    const allocs = [source, target];

    const result = copyMealToGuests(allocs, 0, [1]);

    // Neither allocation carries platter data — platters are separate.
    expect(result[0].addons).toEqual([]);
    expect(result[1].addons).toEqual([]);
  });

  it("returns allocations unchanged if source has no package", () => {
    const source = guest(0, "adult", null, [], []);
    const target = guest(1, "adult", PKG_B, [], []);
    const allocs = [source, target];

    const result = copyMealToGuests(allocs, 0, [1]);
    expect(result).toBe(allocs);
  });

  it("returns allocations unchanged for untargeted guests", () => {
    const source = guest(0, "adult", PKG_A, [{ menuItemId: "m1", selectionCategory: "meat" }], []);
    const t1 = guest(1, "adult", PKG_B, [], []);
    const t2 = guest(2, "child", null, [], []);
    const allocs = [source, t1, t2];

    const result = copyMealToGuests(allocs, 0, [2]);

    // t1 is not a target — same reference, unchanged.
    expect(result[1]).toBe(t1);
    expect(result[1].packageId).toBe(PKG_B);
  });
});

describe("copyMealImpact", () => {
  it("flags guests whose meals would be replaced", () => {
    const source = guest(0, "adult", PKG_A, [{ menuItemId: "m1", selectionCategory: "meat" }], []);
    const target = guest(1, "adult", PKG_B, [{ menuItemId: "x", selectionCategory: "meat" }], []);
    const allocs = [source, target];

    const impact = copyMealImpact(allocs, 0, [1]);
    expect(impact.replacingMeals).toContain(1);
  });

  it("flags guests whose add-ons are incompatible", () => {
    const source = guest(0, "adult", PKG_A, [], []);
    const target = guest(1, "adult", null, [], [{ addonId: "ad-b-only", quantity: 1 }]);
    const allocs = [source, target];
    const catalogAddons = [addon("ad-b-only", [PKG_B])];

    const impact = copyMealImpact(allocs, 0, [1], catalogAddons);
    expect(impact.removingAddons).toContain(1);
  });

  it("returns empty arrays if source has no package", () => {
    const source = guest(0, "adult", null, [], []);
    const target = guest(1, "adult", PKG_B, [], []);
    const allocs = [source, target];

    const impact = copyMealImpact(allocs, 0, [1]);
    expect(impact.replacingMeals).toEqual([]);
    expect(impact.removingAddons).toEqual([]);
  });
});
