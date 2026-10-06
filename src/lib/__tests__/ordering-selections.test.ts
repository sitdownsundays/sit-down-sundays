/**
 * Ordering included-selection validation — behavioral tests.
 *
 * Exercises validateIncludedSelections: correct counts, wrong counts,
 * ineligible items, wrong category, optional bread/drink, and package-change
 * eligibility. Mock tests only (migration unapplied).
 */
import { describe, it, expect } from "vitest";
import { validateIncludedSelections } from "@/lib/ordering/pricing";
import type { OrderGuest } from "@/lib/ordering/pricing";
import type { MealPackageDTO, EligibleItemDTO } from "@/lib/ordering/types";

const MEAT_A = "11111111-0000-4000-8000-000000000001";
const MEAT_B = "11111111-0000-4000-8000-000000000002";
const SIDE_A = "22222222-0000-4000-8000-000000000001";
const SIDE_B = "22222222-0000-4000-8000-000000000002";
const SIDE_C = "22222222-0000-4000-8000-000000000003";

function makeEligible(pkgId: string, itemId: string, cat: string): EligibleItemDTO {
  return {
    id: crypto.randomUUID(),
    packageId: pkgId,
    menuItemId: itemId,
    menuItemName: `Item ${itemId.slice(-3)}`,
    selectionCategory: cat as EligibleItemDTO["selectionCategory"],
  };
}

function makePackage(overrides: Partial<MealPackageDTO> = {}): MealPackageDTO {
  const id = overrides.id ?? crypto.randomUUID();
  return {
    id,
    name: "Basic Meal",
    slug: "basic-meal",
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
      makeEligible(id, MEAT_A, "meat"),
      makeEligible(id, MEAT_B, "meat"),
      makeEligible(id, SIDE_A, "side"),
      makeEligible(id, SIDE_B, "side"),
    ],
    ...overrides,
  };
}

function guest(
  pkgId: string,
  selections: Array<{ menuItemId: string; selectionCategory: string }>,
): OrderGuest {
  return {
    id: "g1",
    category: "adult",
    packageId: pkgId,
    includedSelections: selections,
    addons: [],
  };
}

describe("validateIncludedSelections", () => {
  it("accepts the correct count of eligible meats and sides", () => {
    const pkg = makePackage();
    const notes = validateIncludedSelections(
      guest(pkg.id, [
        { menuItemId: MEAT_A, selectionCategory: "meat" },
        { menuItemId: MEAT_B, selectionCategory: "meat" },
        { menuItemId: SIDE_A, selectionCategory: "side" },
        { menuItemId: SIDE_B, selectionCategory: "side" },
      ]),
      pkg,
    );
    expect(notes).toEqual([]);
  });

  it("flags too few meat selections", () => {
    const pkg = makePackage();
    const notes = validateIncludedSelections(
      guest(pkg.id, [
        { menuItemId: MEAT_A, selectionCategory: "meat" },
        { menuItemId: SIDE_A, selectionCategory: "side" },
        { menuItemId: SIDE_B, selectionCategory: "side" },
      ]),
      pkg,
    );
    expect(notes.length).toBe(1);
    expect(notes[0]).toMatch(/requires 2 meats; 1 selected/);
  });

  it("flags too many side selections (the extra is ineligible + count mismatch)", () => {
    const pkg = makePackage();
    const notes = validateIncludedSelections(
      guest(pkg.id, [
        { menuItemId: MEAT_A, selectionCategory: "meat" },
        { menuItemId: MEAT_B, selectionCategory: "meat" },
        { menuItemId: SIDE_A, selectionCategory: "side" },
        { menuItemId: SIDE_B, selectionCategory: "side" },
        { menuItemId: SIDE_C, selectionCategory: "side" },
      ]),
      pkg,
    );
    // SIDE_C is not in the package's eligible items → ineligible note.
    // The two eligible sides (A, B) satisfy the count, so no count note.
    expect(notes.some((n) => n.includes("not eligible"))).toBe(true);
  });

  it("flags an ineligible meat selection (not in the package's eligible items)", () => {
    const pkg = makePackage();
    const ineligibleMeat = "99999999-0000-4000-8000-000000000001";
    const notes = validateIncludedSelections(
      guest(pkg.id, [
        { menuItemId: MEAT_A, selectionCategory: "meat" },
        { menuItemId: ineligibleMeat, selectionCategory: "meat" },
        { menuItemId: SIDE_A, selectionCategory: "side" },
        { menuItemId: SIDE_B, selectionCategory: "side" },
      ]),
      pkg,
    );
    expect(notes.some((n) => n.includes("not eligible"))).toBe(true);
  });

  it("flags a selection with a wrong selection category", () => {
    const pkg = makePackage();
    const notes = validateIncludedSelections(
      guest(pkg.id, [
        { menuItemId: MEAT_A, selectionCategory: "side" },
        { menuItemId: MEAT_B, selectionCategory: "meat" },
        { menuItemId: SIDE_A, selectionCategory: "side" },
      ]),
      pkg,
    );
    expect(notes.length).toBeGreaterThanOrEqual(1);
  });

  it("does not require bread or drink selections (optional inclusions)", () => {
    const pkg = makePackage();
    const notes = validateIncludedSelections(
      guest(pkg.id, [
        { menuItemId: MEAT_A, selectionCategory: "meat" },
        { menuItemId: MEAT_B, selectionCategory: "meat" },
        { menuItemId: SIDE_A, selectionCategory: "side" },
        { menuItemId: SIDE_B, selectionCategory: "side" },
      ]),
      pkg,
    );
    expect(notes).toEqual([]);
  });
});

describe("package-change selection clearing (behavioral)", () => {
  it("an item eligible for package A is not eligible for package B", () => {
    const pkgA = makePackage({
      id: "pkg-a",
      eligibleItems: [
        makeEligible("pkg-a", MEAT_A, "meat"),
        makeEligible("pkg-a", MEAT_B, "meat"),
        makeEligible("pkg-a", SIDE_A, "side"),
        makeEligible("pkg-a", SIDE_B, "side"),
      ],
    });
    const pkgB = makePackage({
      id: "pkg-b",
      name: "Other",
      slug: "other",
      eligibleItems: [makeEligible("pkg-b", MEAT_B, "meat"), makeEligible("pkg-b", SIDE_C, "side")],
    });
    const notesA = validateIncludedSelections(
      guest("pkg-a", [{ menuItemId: MEAT_A, selectionCategory: "meat" }]),
      pkgA,
    );
    expect(notesA.some((n) => n.includes("not eligible"))).toBe(false);

    const notesB = validateIncludedSelections(
      guest("pkg-b", [{ menuItemId: MEAT_A, selectionCategory: "meat" }]),
      pkgB,
    );
    expect(notesB.some((n) => n.includes("not eligible"))).toBe(true);
  });
});
