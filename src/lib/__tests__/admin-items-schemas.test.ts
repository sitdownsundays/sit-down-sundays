/**
 * Admin Menu Items — schema, validation, and source-inspection tests.
 *
 * Schema tests exercise the strict create/patch Zod schemas (protected-field
 * rejection). Validation tests exercise the client-side form helpers (price
 * conversion, image-alt rule, tag normalization, payload building). The final
 * block inspects source text where React panel/hook behavior cannot be
 * exercised without a full Start runtime + DOM — those are clearly labeled.
 */
import { describe, it, expect } from "vitest";
import {
  dollarsToCents,
  normalizeTags,
  validateItemForm,
  emptyItemFormValues,
  buildCreatePayload,
  buildPatchPayload,
  itemToFormValues,
} from "@/components/admin/item-form-helpers";
import type { MenuItemDTO } from "@/lib/menu/types";

const newId = (): string => crypto.randomUUID();

/* --------------------- Strict schemas & protected fields --------------------- */

describe("admin items — strict schemas and protected fields", () => {
  it("create schema rejects a browser-supplied isActive", async () => {
    const { menuItemCreateSchema } = await import("@/lib/menu/schema");
    expect(() =>
      menuItemCreateSchema.parse({
        menuId: newId(),
        name: "X",
        priceCents: 1000,
        category: "main",
        isActive: false,
      }),
    ).toThrow();
  });

  it("create schema rejects id and audit fields", async () => {
    const { menuItemCreateSchema } = await import("@/lib/menu/schema");
    expect(() =>
      menuItemCreateSchema.parse({
        menuId: newId(),
        name: "X",
        priceCents: 1000,
        category: "main",
        id: "smuggled",
        createdAt: "2025-09-01T10:00:00Z",
        updatedAt: "2025-09-01T10:00:00Z",
      }),
    ).toThrow();
  });

  it("patch schema rejects menuId, id, isActive, and audit fields", async () => {
    const { menuItemPatchSchema } = await import("@/lib/menu/schema");
    expect(() =>
      menuItemPatchSchema.parse({
        menuId: newId(),
        id: "smuggled",
        isActive: true,
        createdAt: "2025-09-01T10:00:00Z",
        name: "X",
      }),
    ).toThrow();
  });

  it("create schema accepts a valid minimal item", async () => {
    const { menuItemCreateSchema } = await import("@/lib/menu/schema");
    const parsed = menuItemCreateSchema.parse({
      menuId: newId(),
      name: "Bread",
      priceCents: 800,
      category: "starter",
    });
    expect(parsed.name).toBe("Bread");
    expect(parsed.priceCents).toBe(800);
  });

  it("create schema requires alt text when an image is present", async () => {
    const { menuItemCreateSchema } = await import("@/lib/menu/schema");
    expect(() =>
      menuItemCreateSchema.parse({
        menuId: newId(),
        name: "X",
        priceCents: 1000,
        category: "main",
        imageUrl: "https://example.com/img.png",
        imageAlt: "",
      }),
    ).toThrow();
  });
});

/* --------------------- Price / image / tag validation --------------------- */

describe("admin items — price, image, and tag validation", () => {
  it("converts dollars to integer cents exactly", () => {
    expect(dollarsToCents("12.50")).toBe(1250);
    expect(dollarsToCents("0.01")).toBe(1);
    expect(dollarsToCents("100")).toBe(10000);
  });

  it("rejects negative, excess precision, NaN, and over-max prices", () => {
    expect(dollarsToCents("-5")).toBeNull();
    expect(dollarsToCents("12.999")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
    expect(dollarsToCents("1000001")).toBeNull();
  });

  it("requires alt text when an image URL is present", () => {
    const errors = validateItemForm({
      ...emptyItemFormValues(),
      name: "X",
      priceDollars: "10.00",
      imageUrl: "https://example.com/img.png",
      imageAlt: "",
    });
    expect(errors.imageAlt).toBeTruthy();
  });

  it("permits clearing alt text when the image is cleared", () => {
    const errors = validateItemForm({
      ...emptyItemFormValues(),
      name: "X",
      priceDollars: "10.00",
      imageUrl: "",
      imageAlt: "",
    });
    expect(errors.imageAlt).toBeUndefined();
  });

  it("normalizes, trims, and deduplicates tags case-insensitively", () => {
    expect(normalizeTags("vegan, Vegan,  gluten-free , ")).toEqual(["vegan", "gluten-free"]);
    expect(normalizeTags("")).toEqual([]);
  });

  it("rejects an empty name", () => {
    const errors = validateItemForm({ ...emptyItemFormValues(), priceDollars: "10.00" });
    expect(errors.name).toBeTruthy();
  });

  it("buildCreatePayload omits isActive", () => {
    const payload = buildCreatePayload(
      { ...emptyItemFormValues(), name: "X", priceDollars: "10.00" },
      newId(),
    );
    expect(payload).not.toHaveProperty("isActive");
    expect(payload.priceCents).toBe(1000);
  });

  it("buildPatchPayload omits menuId and isActive", () => {
    const payload = buildPatchPayload({
      ...emptyItemFormValues(),
      name: "X",
      priceDollars: "10.00",
    });
    expect(payload).not.toHaveProperty("menuId");
    expect(payload).not.toHaveProperty("isActive");
  });
});

/* --------------------- Source-inspection tests (clearly labeled) --------------------- */

describe("admin items — source-inspection tests (NOT behavioral)", () => {
  // These inspect source text because the React panel/hook behavior cannot be
  // exercised without a full Start runtime + DOM. They verify wiring only.

  it("MenuItemsPanel reloads on menu.id change and guards stale responses", async () => {
    const src = await import("@/components/admin/menu-items-panel?raw").then(
      (m) => (m as { default: string }).default,
    );
    expect(src).toMatch(/genRef/);
    expect(src).toMatch(/mountedRef/);
    expect(src).toMatch(/\[menu\.id\]/);
  });

  it("MenuItemsPanel uses a synchronous ref-backed double-submit lock", async () => {
    const src = await import("@/components/admin/menu-items-panel?raw").then(
      (m) => (m as { default: string }).default,
    );
    expect(src).toMatch(/actionLockRef\.current/);
    expect(src).toMatch(/if \(actionLockRef\.current\) return/);
  });

  it("MenuItemsPanel reloads authoritative order after reorder", async () => {
    const src = await import("@/components/admin/menu-items-panel?raw").then(
      (m) => (m as { default: string }).default,
    );
    expect(src).toMatch(/reload/i);
  });

  it("setItemActive server function requires expectedUpdatedAt", async () => {
    const src = await import("@/lib/menu.functions?raw").then(
      (m) => (m as { default: string }).default,
    );
    expect(src).toMatch(/setItemActiveSchema/);
    expect(src).toMatch(/expectedUpdatedAt: z\.string\(\)/);
  });
});

/* --------------------- Tag normalization & validation (no silent drop) --------------------- */

describe("admin items — tag normalization and validation", () => {
  it("normalizeTags does not silently truncate at 20", () => {
    const many = Array.from({ length: 25 }, (_, i) => `t${i}`).join(", ");
    expect(normalizeTags(many).length).toBe(25);
  });

  it("normalizeTags does not silently drop over-length entries", () => {
    expect(normalizeTags("x".repeat(61))).toEqual(["x".repeat(61)]);
  });

  it("validateItemForm errors on more than 20 unique dietary tags", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`).join(", ");
    const errors = validateItemForm({
      ...emptyItemFormValues(),
      name: "X",
      priceDollars: "10.00",
      dietaryTags: tags,
    });
    expect(errors.dietaryTags).toMatch(/at most 20/i);
  });

  it("validateItemForm errors on a dietary tag over 60 characters", () => {
    const errors = validateItemForm({
      ...emptyItemFormValues(),
      name: "X",
      priceDollars: "10.00",
      dietaryTags: "x".repeat(61),
    });
    expect(errors.dietaryTags).toMatch(/60 characters or fewer/i);
  });

  it("validateItemForm errors on more than 20 unique allergens", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `allergen${i}`).join(", ");
    const errors = validateItemForm({
      ...emptyItemFormValues(),
      name: "X",
      priceDollars: "10.00",
      allergens: tags,
    });
    expect(errors.allergens).toMatch(/at most 20/i);
  });

  it("validateItemForm errors on an allergen over 60 characters", () => {
    const errors = validateItemForm({
      ...emptyItemFormValues(),
      name: "X",
      priceDollars: "10.00",
      allergens: "y".repeat(61),
    });
    expect(errors.allergens).toMatch(/60 characters or fewer/i);
  });
});

/* --------------------- Server-side schema tag enforcement --------------------- */

describe("admin items — server schema tag enforcement", () => {
  it("create schema dedupes dietary tags case-insensitively", async () => {
    const { menuItemCreateSchema } = await import("@/lib/menu/schema");
    const parsed = menuItemCreateSchema.parse({
      menuId: newId(),
      name: "X",
      priceCents: 1000,
      category: "main",
      dietaryTags: ["vegan", "Vegan", "VEGAN", "gluten-free"],
    });
    expect(parsed.dietaryTags).toEqual(["vegan", "gluten-free"]);
  });

  it("create schema rejects more than 20 dietary tags", async () => {
    const { menuItemCreateSchema } = await import("@/lib/menu/schema");
    expect(() =>
      menuItemCreateSchema.parse({
        menuId: newId(),
        name: "X",
        priceCents: 1000,
        category: "main",
        dietaryTags: Array.from({ length: 21 }, (_, i) => `tag${i}`),
      }),
    ).toThrow();
  });

  it("create schema rejects a dietary tag over 60 characters (no silent drop)", async () => {
    const { menuItemCreateSchema } = await import("@/lib/menu/schema");
    expect(() =>
      menuItemCreateSchema.parse({
        menuId: newId(),
        name: "X",
        priceCents: 1000,
        category: "main",
        dietaryTags: ["x".repeat(61)],
      }),
    ).toThrow();
  });

  it("patch schema dedupes allergens", async () => {
    const { menuItemPatchSchema } = await import("@/lib/menu/schema");
    const parsed = menuItemPatchSchema.parse({ allergens: ["peanut", "Peanut", "soy"] });
    expect(parsed.allergens).toEqual(["peanut", "soy"]);
  });
});

/* --------------------- priceCents=0 rendering --------------------- */

describe("admin items — itemToFormValues price rendering", () => {
  const baseItem = (over: Record<string, unknown>): MenuItemDTO =>
    ({
      id: "i1",
      menuId: "m1",
      sectionId: null,
      name: "Bread",
      description: "",
      priceCents: 1000,
      category: "starter",
      imageUrl: null,
      imageAlt: null,
      dietaryTags: [],
      allergens: [],
      isActive: true,
      isFeatured: false,
      displayOrder: 0,
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
      ...over,
    }) as unknown as MenuItemDTO;

  it("renders priceCents=0 as 0.00", () => {
    expect(itemToFormValues(baseItem({ priceCents: 0 })).priceDollars).toBe("0.00");
  });

  it("renders a positive price correctly", () => {
    expect(itemToFormValues(baseItem({ priceCents: 1250 })).priceDollars).toBe("12.50");
  });
});
