/**
 * Focused tests for the package editor's eligible-item category filtering.
 */
import { describe, it, expect } from "vitest";
import type { MenuItemDTO } from "@/lib/menu/types";
import {
  itemsForSelectionCategory,
  partitionSavedSelection,
  itemMatchesSelectionCategory,
  toggleSelectionSet,
  removeFromSelectionSet,
  validateCatalogEligibility,
  SELECTION_TO_MENU_CATEGORIES,
} from "@/components/admin/eligible-item-filters";

function makeItem(id: string, category: MenuItemDTO["category"], isActive = true): MenuItemDTO {
  return {
    id,
    menuId: "menu-1",
    sectionId: null,
    name: id,
    description: "",
    priceCents: 1000,
    category,
    imageUrl: null,
    imageAlt: null,
    dietaryTags: [],
    allergens: [],
    isActive,
    isFeatured: false,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const CATALOG: MenuItemDTO[] = [
  makeItem("brisket", "main"),
  makeItem("chicken", "main"),
  makeItem("mac", "side"),
  makeItem("greens", "side"),
  makeItem("rolls", "starter"),
  makeItem("cornbread", "starter"),
  makeItem("sweet-tea", "beverage"),
  makeItem("lemonade", "beverage"),
  makeItem("brownie", "dessert"),
  makeItem("kids-nuggets", "children"),
  makeItem("inactive-meat", "main", false),
  makeItem("inactive-drink", "beverage", false),
];

describe("itemsForSelectionCategory", () => {
  it("meat selector contains only active main items", () => {
    const items = itemsForSelectionCategory(CATALOG, "meat");
    expect(items.map((i) => i.id).sort()).toEqual(["brisket", "chicken"]);
  });

  it("side selector contains only active side items", () => {
    const items = itemsForSelectionCategory(CATALOG, "side");
    expect(items.map((i) => i.id).sort()).toEqual(["greens", "mac"]);
  });

  it("bread selector contains only active starter items", () => {
    const items = itemsForSelectionCategory(CATALOG, "bread");
    expect(items.map((i) => i.id).sort()).toEqual(["cornbread", "rolls"]);
  });

  it("drink selector contains only active beverage items", () => {
    const items = itemsForSelectionCategory(CATALOG, "drink");
    expect(items.map((i) => i.id).sort()).toEqual(["lemonade", "sweet-tea"]);
  });

  it("excludes inactive items from candidates", () => {
    const items = itemsForSelectionCategory(CATALOG, "meat");
    expect(items.find((i) => i.id === "inactive-meat")).toBeUndefined();
  });

  it("excludes dessert and children items from all selection buckets", () => {
    expect(
      itemsForSelectionCategory(CATALOG, "meat").find((i) => i.id === "brownie"),
    ).toBeUndefined();
    expect(
      itemsForSelectionCategory(CATALOG, "side").find((i) => i.id === "kids-nuggets"),
    ).toBeUndefined();
  });

  it("returns empty for a category with no available items", () => {
    expect(itemsForSelectionCategory([], "meat")).toEqual([]);
  });

  it("uses the stored category field, not item names or hardcoded IDs", () => {
    const tricky = [
      makeItem("not-a-meat-named-meat", "beverage"),
      makeItem("actual-meat-named-oddly", "main"),
    ];
    const items = itemsForSelectionCategory(tricky, "meat");
    expect(items.map((i) => i.id)).toEqual(["actual-meat-named-oddly"]);
  });
});

describe("partitionSavedSelection", () => {
  it("returns matching, mismatched, and unknown buckets without deletion", () => {
    const saved = new Set(["brisket", "mac", "sweet-tea", "rolls", "unknown-id"]);
    const { matching, mismatched, unknown } = partitionSavedSelection(saved, CATALOG, "meat");
    expect(matching).toEqual(["brisket"]);
    expect(mismatched.map((i) => i.id).sort()).toEqual(["mac", "rolls", "sweet-tea"]);
    expect(unknown).toEqual(["unknown-id"]);
  });

  it("all-match returns no mismatches or unknown", () => {
    const saved = new Set(["brisket", "chicken"]);
    const { matching, mismatched, unknown } = partitionSavedSelection(saved, CATALOG, "meat");
    expect(matching.sort()).toEqual(["brisket", "chicken"]);
    expect(mismatched).toEqual([]);
    expect(unknown).toEqual([]);
  });

  it("preserves inactive saved items for correction (not silently dropped)", () => {
    // An inactive item with the correct category is a category match — the
    // editor shows inactive items separately, but partitionSavedSelection is
    // about category mismatch, not activity status.
    const saved = new Set(["inactive-meat", "brisket"]);
    const { matching, mismatched, unknown } = partitionSavedSelection(saved, CATALOG, "meat");
    expect(matching.sort()).toEqual(["brisket", "inactive-meat"]);
    expect(mismatched).toEqual([]);
    expect(unknown).toEqual([]);
    // An inactive item with wrong category appears as mismatched.
    const saved2 = new Set(["inactive-drink"]);
    const r2 = partitionSavedSelection(saved2, CATALOG, "meat");
    expect(r2.mismatched.map((i) => i.id)).toEqual(["inactive-drink"]);
  });

  it("places unknown saved IDs in the unknown bucket (not silently dropped)", () => {
    const saved = new Set(["unknown-id", "brisket"]);
    const { matching, mismatched, unknown } = partitionSavedSelection(saved, CATALOG, "meat");
    expect(matching).toEqual(["brisket"]);
    expect(mismatched).toEqual([]);
    expect(unknown).toEqual(["unknown-id"]);
  });

  it("only unknown IDs: empty matching and mismatched", () => {
    const saved = new Set(["gone-1", "gone-2"]);
    const { matching, mismatched, unknown } = partitionSavedSelection(saved, CATALOG, "meat");
    expect(matching).toEqual([]);
    expect(mismatched).toEqual([]);
    expect(unknown.sort()).toEqual(["gone-1", "gone-2"]);
  });
});

describe("itemMatchesSelectionCategory", () => {
  it("returns true for a matching category", () => {
    expect(itemMatchesSelectionCategory(makeItem("x", "main"), "meat")).toBe(true);
    expect(itemMatchesSelectionCategory(makeItem("x", "beverage"), "drink")).toBe(true);
  });

  it("returns false for a mismatched category", () => {
    expect(itemMatchesSelectionCategory(makeItem("x", "beverage"), "meat")).toBe(false);
    expect(itemMatchesSelectionCategory(makeItem("x", "side"), "drink")).toBe(false);
  });
});

describe("SELECTION_TO_MENU_CATEGORIES mapping", () => {
  it("maps each selection category to authoritative menu categories", () => {
    expect(SELECTION_TO_MENU_CATEGORIES.meat).toEqual(["main"]);
    expect(SELECTION_TO_MENU_CATEGORIES.side).toEqual(["side"]);
    expect(SELECTION_TO_MENU_CATEGORIES.bread).toEqual(["starter"]);
    expect(SELECTION_TO_MENU_CATEGORIES.drink).toEqual(["beverage"]);
  });
});

describe("toggleSelectionSet", () => {
  it("removes an already-selected item even if it no longer matches the category", () => {
    const saved = new Set(["brisket", "mac"]);
    const next = toggleSelectionSet(saved, CATALOG, "meat", "mac");
    expect(next.has("mac")).toBe(false);
    expect(next.has("brisket")).toBe(true);
  });

  it("removes an already-selected item that is missing from the catalog", () => {
    const saved = new Set(["brisket", "unknown-id"]);
    const next = toggleSelectionSet(saved, CATALOG, "meat", "unknown-id");
    expect(next.has("unknown-id")).toBe(false);
    expect(next.has("brisket")).toBe(true);
  });

  it("adds a matching active item", () => {
    const saved = new Set(["brisket"]);
    const next = toggleSelectionSet(saved, CATALOG, "meat", "chicken");
    expect(next.has("chicken")).toBe(true);
    expect(next.has("brisket")).toBe(true);
  });

  it("rejects adding a mismatched item (returns same reference)", () => {
    const saved = new Set(["brisket"]);
    const next = toggleSelectionSet(saved, CATALOG, "meat", "mac");
    expect(next).toBe(saved);
    expect(next.has("mac")).toBe(false);
  });

  it("rejects adding an inactive item (returns same reference)", () => {
    const saved = new Set(["brisket"]);
    const next = toggleSelectionSet(saved, CATALOG, "meat", "inactive-meat");
    expect(next).toBe(saved);
    expect(next.has("inactive-meat")).toBe(false);
  });

  it("rejects adding an item not in the catalog (returns same reference)", () => {
    const saved = new Set(["brisket"]);
    const next = toggleSelectionSet(saved, CATALOG, "meat", "no-such-item");
    expect(next).toBe(saved);
    expect(next.has("no-such-item")).toBe(false);
  });

  it("preserves other items when removing one", () => {
    const saved = new Set(["brisket", "chicken", "unknown-id"]);
    const next = toggleSelectionSet(saved, CATALOG, "meat", "unknown-id");
    expect(next.has("unknown-id")).toBe(false);
    expect(next.has("brisket")).toBe(true);
    expect(next.has("chicken")).toBe(true);
  });
});

describe("removeFromSelectionSet", () => {
  it("removes a mismatched saved item", () => {
    const saved = new Set(["brisket", "mac"]);
    const next = removeFromSelectionSet(saved, "mac");
    expect(next.has("mac")).toBe(false);
    expect(next.has("brisket")).toBe(true);
  });

  it("removes an unknown saved item not in the catalog", () => {
    const saved = new Set(["brisket", "gone-id"]);
    const next = removeFromSelectionSet(saved, "gone-id");
    expect(next.has("gone-id")).toBe(false);
    expect(next.has("brisket")).toBe(true);
  });

  it("returns same reference when item is not present (no change)", () => {
    const saved = new Set(["brisket"]);
    const next = removeFromSelectionSet(saved, "mac");
    expect(next).toBe(saved);
  });

  it("preserves other items when removing one", () => {
    const saved = new Set(["a", "b", "c"]);
    const next = removeFromSelectionSet(saved, "b");
    expect(next.has("a")).toBe(true);
    expect(next.has("b")).toBe(false);
    expect(next.has("c")).toBe(true);
  });
});

describe("validateCatalogEligibility", () => {
  const emptyEligible = {
    meat: new Set<string>(),
    side: new Set<string>(),
    bread: new Set<string>(),
    drink: new Set<string>(),
  };

  it("loading state + saved IDs returns a wait message, not a removal message", () => {
    const msg = validateCatalogEligibility(
      { isLoading: true, isError: false, isSuccess: false },
      { ...emptyEligible, meat: new Set(["brisket"]) },
      [],
    );
    expect(msg).toBe("Wait for the menu catalog to load before saving.");
  });

  it("failed read + saved IDs returns a retry message, not a removal message", () => {
    const msg = validateCatalogEligibility(
      { isLoading: false, isError: true, isSuccess: false },
      { ...emptyEligible, meat: new Set(["brisket"]) },
      [],
    );
    expect(msg).toBe("Couldn't load the menu catalog. Retry before saving.");
  });

  it("idle/pending state returns a wait message", () => {
    const msg = validateCatalogEligibility(
      { isLoading: false, isError: false, isSuccess: false },
      { ...emptyEligible, meat: new Set(["brisket"]) },
      [],
    );
    expect(msg).toBe("Wait for the menu catalog to load before saving.");
  });

  it("successful empty catalog + saved IDs returns a removal message (unavailable)", () => {
    const msg = validateCatalogEligibility(
      { isLoading: false, isError: false, isSuccess: true },
      { ...emptyEligible, meat: new Set(["brisket"]) },
      [],
    );
    expect(msg).toBe("Remove mismatched or unavailable items before saving.");
  });

  it("successful valid catalog + all matching selections returns undefined (valid)", () => {
    const msg = validateCatalogEligibility(
      { isLoading: false, isError: false, isSuccess: true },
      {
        meat: new Set(["brisket", "chicken"]),
        side: new Set(["mac"]),
        bread: new Set(),
        drink: new Set(),
      },
      CATALOG,
    );
    expect(msg).toBeUndefined();
  });

  it("successful valid catalog + empty eligible sets returns undefined (valid)", () => {
    const msg = validateCatalogEligibility(
      { isLoading: false, isError: false, isSuccess: true },
      emptyEligible,
      CATALOG,
    );
    expect(msg).toBeUndefined();
  });

  it("successful catalog + mismatched selection returns a removal message", () => {
    const msg = validateCatalogEligibility(
      { isLoading: false, isError: false, isSuccess: true },
      { ...emptyEligible, meat: new Set(["mac"]) },
      CATALOG,
    );
    expect(msg).toBe("Remove mismatched or unavailable items before saving.");
  });

  it("successful catalog + unknown saved ID returns a removal message", () => {
    const msg = validateCatalogEligibility(
      { isLoading: false, isError: false, isSuccess: true },
      { ...emptyEligible, meat: new Set(["brisket", "gone-id"]) },
      CATALOG,
    );
    expect(msg).toBe("Remove mismatched or unavailable items before saving.");
  });
});
