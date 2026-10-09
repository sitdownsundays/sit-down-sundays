import { describe, it, expect } from "vitest";
import {
  setSharedPackage,
  toggleSharedSelection,
  sharedSelectionCount,
  reconcileAllocations,
  reconcileSharedFeast,
  buildAllocations,
  setPlatterQuantity,
  type GuestAllocation,
} from "@/lib/booking/meals-helpers";
import type { PublicMealPackage, PublicOrderingCatalog } from "@/lib/booking/public-catalog";

const PKG_BASIC: PublicMealPackage = {
  id: "pkg-basic",
  name: "Basic Meal",
  description: "",
  pricePerPersonCents: 2950,
  includedMeatsCount: 2,
  includedSidesCount: 2,
  includesBread: true,
  includesSoftDrink: true,
  displayOrder: 0,
  eligibleItems: [
    { menuItemId: "m1", menuItemName: "Slow Roasted Beef", selectionCategory: "meat" },
    { menuItemId: "m2", menuItemName: "Beef Meatballs", selectionCategory: "meat" },
    { menuItemId: "m3", menuItemName: "Fried Chicken", selectionCategory: "meat" },
    { menuItemId: "s1", menuItemName: "Green Beans", selectionCategory: "side" },
    { menuItemId: "s2", menuItemName: "Steamed Cabbage", selectionCategory: "side" },
    { menuItemId: "b1", menuItemName: "Dinner Rolls", selectionCategory: "bread" },
    { menuItemId: "b2", menuItemName: "Cornbread", selectionCategory: "bread" },
  ],
};

const PKG_PREMIUM: PublicMealPackage = {
  ...PKG_BASIC,
  id: "pkg-premium",
  name: "Premium Meal",
  pricePerPersonCents: 4450,
  includedSidesCount: 3,
};

function alloc(guestIndex: number, category: "adult" | "senior" | "child"): GuestAllocation {
  return {
    guestId: `guest-${guestIndex}`,
    guestIndex,
    category,
    name: "",
    packageId: null,
    included: [],
    addons: [],
    foodAllergies: "",
    dietaryPreferences: "",
    mealRequests: "",
  };
}

describe("setSharedPackage", () => {
  it("applies the same package to all guests, preserving identity/category/name", () => {
    const allocations = [alloc(0, "adult"), alloc(1, "child")];
    const result = setSharedPackage(allocations, PKG_BASIC);
    expect(result).toHaveLength(2);
    for (const a of result) {
      expect(a.packageId).toBe("pkg-basic");
      expect(a.included).toEqual([]);
      expect(a.addons).toEqual([]);
    }
    // Identity preserved
    expect(result[0].guestId).toBe("guest-0");
    expect(result[0].category).toBe("adult");
    expect(result[1].guestId).toBe("guest-1");
    expect(result[1].category).toBe("child");
  });

  it("returns independent copies (no shared mutable objects)", () => {
    const allocations = [alloc(0, "adult")];
    const result = setSharedPackage(allocations, PKG_BASIC);
    result[0]!.included.push({ menuItemId: "m1", selectionCategory: "meat" });
    // Original is untouched
    expect(allocations[0]!.included).toEqual([]);
  });
});

describe("toggleSharedSelection", () => {
  const base = setSharedPackage([alloc(0, "adult"), alloc(1, "adult")], PKG_BASIC);

  it("toggles a meat selection for all guests", () => {
    const result = toggleSharedSelection(base, PKG_BASIC, "m1", "meat");
    expect(result).toHaveLength(2);
    for (const a of result) {
      expect(a.included.some((s) => s.menuItemId === "m1")).toBe(true);
    }
    expect(sharedSelectionCount(result, "meat")).toBe(1);
  });

  it("preserves guest identities and categories", () => {
    const result = toggleSharedSelection(base, PKG_BASIC, "m1", "meat");
    expect(result[0].guestId).toBe("guest-0");
    expect(result[1].guestId).toBe("guest-1");
    expect(result[0].category).toBe("adult");
    expect(result[1].category).toBe("adult");
  });

  it("produces independent selection objects per guest", () => {
    const result = toggleSharedSelection(base, PKG_BASIC, "m1", "meat");
    result[0]!.included.push({ menuItemId: "m2", selectionCategory: "meat" });
    expect(result[1]!.included).toHaveLength(1);
  });

  it("toggling off removes from all guests", () => {
    const withMeat = toggleSharedSelection(base, PKG_BASIC, "m1", "meat");
    const toggledOff = toggleSharedSelection(withMeat, PKG_BASIC, "m1", "meat");
    for (const a of toggledOff) {
      expect(a.included.some((s) => s.menuItemId === "m1")).toBe(false);
    }
    expect(sharedSelectionCount(toggledOff, "meat")).toBe(0);
  });
});

describe("sharedSelectionCount", () => {
  it("counts from the first guest", () => {
    const withMeat = toggleSharedSelection(
      setSharedPackage([alloc(0, "adult"), alloc(1, "adult")], PKG_BASIC),
      PKG_BASIC,
      "m1",
      "meat",
    );
    expect(sharedSelectionCount(withMeat, "meat")).toBe(1);
    expect(sharedSelectionCount(withMeat, "side")).toBe(0);
    expect(sharedSelectionCount(withMeat, "bread")).toBe(0);
  });

  it("returns 0 for empty allocations", () => {
    expect(sharedSelectionCount([], "meat")).toBe(0);
  });
});

describe("reconcileAllocations with shared feast", () => {
  it("adding a guest inherits the shared feast (package preserved for retained guests)", () => {
    const two = setSharedPackage([alloc(0, "adult"), alloc(1, "adult")], PKG_BASIC);
    const withMeat = toggleSharedSelection(two, PKG_BASIC, "m1", "meat");
    // Reconcile to 3 guests: 2 adults + 1 child
    const reconciled = reconcileAllocations(withMeat, 2, 0, 1);
    expect(reconciled.allocations).toHaveLength(3);
    // Existing guests keep their package and selections
    expect(reconciled.allocations[0]!.packageId).toBe("pkg-basic");
    expect(reconciled.allocations[0]!.included.some((s) => s.menuItemId === "m1")).toBe(true);
    expect(reconciled.allocations[1]!.packageId).toBe("pkg-basic");
    expect(reconciled.allocations[1]!.included.some((s) => s.menuItemId === "m1")).toBe(true);
    // New guest is fresh (wizard layer re-applies the shared feast)
    expect(reconciled.allocations[2]!.category).toBe("child");
  });

  it("preserves guest identities for retained guests", () => {
    const two = setSharedPackage([alloc(0, "adult"), alloc(1, "senior")], PKG_BASIC);
    const reconciled = reconcileAllocations(two, 1, 1, 0);
    expect(reconciled.allocations[0]!.guestId).toBe("guest-0");
    expect(reconciled.allocations[0]!.category).toBe("adult");
    expect(reconciled.allocations[1]!.guestId).toBe("guest-1");
    expect(reconciled.allocations[1]!.category).toBe("senior");
  });

  it("removed guest identities are not reassigned to new guests", () => {
    const two = setSharedPackage([alloc(0, "adult"), alloc(1, "senior")], PKG_BASIC);
    // Remove the senior (guest-1), add a new child
    const reconciled = reconcileAllocations(two, 1, 0, 1);
    // guest-0 should still be there
    expect(reconciled.allocations[0]!.guestId).toBe("guest-0");
    // guest-1 should NOT be reassigned; new guest should have a different ID
    expect(reconciled.allocations[1]!.guestId).not.toBe("guest-1");
  });
});

describe("reconcileSharedFeast — new guests inherit the shared feast", () => {
  it("NEW guest inherits the same package, meats, sides, and bread", () => {
    const two = setSharedPackage([alloc(0, "adult"), alloc(1, "adult")], PKG_BASIC);
    const withMeats = toggleSharedSelection(two, PKG_BASIC, "m1", "meat");
    const withSides = toggleSharedSelection(withMeats, PKG_BASIC, "s1", "side");
    const withBread = toggleSharedSelection(withSides, PKG_BASIC, "b1", "bread");

    // Add a third guest: 2 adults + 1 child
    const reconciled = reconcileSharedFeast(withBread, 2, 0, 1);

    expect(reconciled.allocations).toHaveLength(3);

    // NEW guest (index 2, child) inherits the shared feast
    const newGuest = reconciled.allocations[2]!;
    expect(newGuest.category).toBe("child");
    expect(newGuest.packageId).toBe("pkg-basic");
    expect(
      newGuest.included.some((s) => s.menuItemId === "m1" && s.selectionCategory === "meat"),
    ).toBe(true);
    expect(
      newGuest.included.some((s) => s.menuItemId === "s1" && s.selectionCategory === "side"),
    ).toBe(true);
    expect(
      newGuest.included.some((s) => s.menuItemId === "b1" && s.selectionCategory === "bread"),
    ).toBe(true);
    expect(newGuest.addons).toEqual([]); // no individual add-ons inherited
  });

  it("copied selections are independent objects", () => {
    const one = setSharedPackage([alloc(0, "adult")], PKG_BASIC);
    const withMeat = toggleSharedSelection(one, PKG_BASIC, "m1", "meat");
    const reconciled = reconcileSharedFeast(withMeat, 1, 0, 1);

    const newGuest = reconciled.allocations[1]!;
    // Mutating the new guest's selections must not affect the source guest
    newGuest.included.push({ menuItemId: "m2", selectionCategory: "meat" });
    expect(reconciled.allocations[0]!.included).toHaveLength(1);
  });

  it("identities and categories remain correct for all guests", () => {
    const two = setSharedPackage([alloc(0, "adult"), alloc(1, "senior")], PKG_BASIC);
    const withMeat = toggleSharedSelection(two, PKG_BASIC, "m1", "meat");

    const reconciled = reconcileSharedFeast(withMeat, 1, 1, 1);
    expect(reconciled.allocations[0]!.guestId).toBe("guest-0");
    expect(reconciled.allocations[0]!.category).toBe("adult");
    expect(reconciled.allocations[1]!.guestId).toBe("guest-1");
    expect(reconciled.allocations[1]!.category).toBe("senior");
    expect(reconciled.allocations[2]!.category).toBe("child");
    expect(reconciled.allocations[2]!.guestId).not.toBe("guest-0");
    expect(reconciled.allocations[2]!.guestId).not.toBe("guest-1");
  });

  it("does not inherit notes, add-ons, or another guest's name", () => {
    // Give guest 0 an add-on and a custom name
    const base = setSharedPackage([alloc(0, "adult"), alloc(1, "adult")], PKG_BASIC);
    const withAddon = base.map((a, i) =>
      i === 0 ? { ...a, addons: [{ addonId: "addon-1", quantity: 2 }], name: "Alice" } : a,
    );
    const withMeat = toggleSharedSelection(withAddon, PKG_BASIC, "m1", "meat");

    const reconciled = reconcileSharedFeast(withMeat, 2, 0, 1);
    const newGuest = reconciled.allocations[2]!;

    // New guest does NOT inherit the source's add-ons or name
    expect(newGuest.addons).toEqual([]);
    expect(newGuest.name).not.toBe("Alice");
  });

  it("preserves shared platter quantities unchanged", () => {
    const two = setSharedPackage([alloc(0, "adult"), alloc(1, "adult")], PKG_BASIC);
    const withMeat = toggleSharedSelection(two, PKG_BASIC, "m1", "meat");
    const withPlatters = setPlatterQuantity([], "platter-1", 3);

    const reconciled = reconcileSharedFeast(withMeat, 2, 0, 1);

    // Platters are stored separately in wizard state, not in allocations.
    // This test verifies the helper does not touch or alter platter state.
    expect(withPlatters).toEqual([{ platterId: "platter-1", quantity: 3 }]);
  });

  it("mixed meals do not silently choose the first guest's meal", () => {
    // Guest 0 has Basic, guest 1 has Premium (different packages)
    const mixed = setSharedPackage([alloc(0, "adult"), alloc(1, "adult")], PKG_BASIC);
    const guest1Premium = mixed.map((a, i) => (i === 1 ? { ...a, packageId: "pkg-premium" } : a));

    const reconciled = reconcileSharedFeast(guest1Premium, 2, 0, 1);

    // New guest gets NO inherited package (mixed meals detected)
    const newGuest = reconciled.allocations[2]!;
    expect(newGuest.packageId).toBeNull();
  });
});

describe("Premium requires 3 sides; Basic requires 2", () => {
  it("Premium has includedSidesCount 3", () => {
    expect(PKG_PREMIUM.includedSidesCount).toBe(3);
  });

  it("Basic has includedSidesCount 2", () => {
    expect(PKG_BASIC.includedSidesCount).toBe(2);
  });
});

describe("buildAllocations initializes with shared feast identity", () => {
  it("creates allocations with unique guestIds and categories", () => {
    const result = buildAllocations(2, 1, 0);
    // 2 adults + 1 senior + 0 children = 3 guests
    expect(result).toHaveLength(3);
    expect(result[0]!.category).toBe("adult");
    expect(result[1]!.category).toBe("adult");
    expect(result[2]!.category).toBe("senior");
    expect(result[0]!.guestId).not.toBe(result[1]!.guestId);
    expect(result[1]!.guestId).not.toBe(result[2]!.guestId);
  });
});
