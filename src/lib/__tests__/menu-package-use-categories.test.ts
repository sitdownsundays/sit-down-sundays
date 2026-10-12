/**
 * Focused tests for migration 0026's per-package-use read/save contract.
 *
 * Exercises the real schema (validatePackageUseCategories), the real
 * itemRowToDTO mapping, the mock repository create/update paths, and the
 * mock seed items. Mocked boundaries only — no live PostgreSQL.
 */
import { describe, expect, it } from "vitest";
import {
  packageUseCategoriesSchema,
  validatePackageUseCategories,
  menuItemCreateSchema,
  menuItemPatchSchema,
} from "@/lib/menu/schema";
import { PACKAGE_USE_CATEGORIES } from "@/lib/menu/constants";
import { itemRowToDTO, type ItemRow } from "@/lib/server/menu-shared.server";
import { MockMenuRepository } from "@/lib/server/menu-mock.server";
import type { RoleKey } from "@/lib/domain/types";

const ADMIN_ROLE: RoleKey = "administrator";

function baseItemRow(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    menu_id: "00000000-0000-4000-8000-000000000002",
    section_id: null,
    name: "Test Item",
    description: null,
    price_cents: 1000,
    category: "main",
    package_use_categories: [],
    image_url: null,
    image_alt: null,
    dietary_tags: [],
    allergens: [],
    is_active: true,
    is_featured: false,
    display_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function validCreateInput(overrides: Record<string, unknown> = {}) {
  return {
    menuId: "00000000-0000-4000-8000-000000000002",
    name: "Brisket",
    priceCents: 2500,
    category: "main",
    ...overrides,
  };
}

/* ----------------------------- validatePackageUseCategories ----------------------------- */

describe("validatePackageUseCategories", () => {
  it("accepts an empty array", () => {
    expect(validatePackageUseCategories([])).toEqual([]);
  });

  it("accepts a single designation", () => {
    expect(validatePackageUseCategories(["meat"])).toEqual(["meat"]);
  });

  it("accepts multiple distinct designations", () => {
    expect(validatePackageUseCategories(["meat", "side"])).toEqual(["meat", "side"]);
  });

  it("accepts all four designations", () => {
    expect(validatePackageUseCategories(["meat", "side", "bread", "drink"])).toEqual([
      "meat",
      "side",
      "bread",
      "drink",
    ]);
  });

  it("rejects unknown values", () => {
    expect(validatePackageUseCategories(["entree"])).toBeNull();
  });

  it("rejects duplicates", () => {
    expect(validatePackageUseCategories(["meat", "meat"])).toBeNull();
  });

  it("rejects null", () => {
    expect(validatePackageUseCategories(null)).toBeNull();
  });

  it("rejects non-array input", () => {
    expect(validatePackageUseCategories("meat")).toBeNull();
    expect(validatePackageUseCategories(42)).toBeNull();
    expect(validatePackageUseCategories({})).toBeNull();
  });

  it("rejects malformed database data (null elements)", () => {
    expect(validatePackageUseCategories(["meat", null])).toBeNull();
  });
});

/* ----------------------------- packageUseCategoriesSchema ----------------------------- */

describe("packageUseCategoriesSchema", () => {
  it("rejects null", () => {
    expect(packageUseCategoriesSchema.safeParse(null).success).toBe(false);
  });

  it("rejects unknown values", () => {
    expect(packageUseCategoriesSchema.safeParse(["invalid"]).success).toBe(false);
  });

  it("rejects duplicates", () => {
    expect(packageUseCategoriesSchema.safeParse(["side", "side"]).success).toBe(false);
  });

  it("accepts empty, single, and multiple", () => {
    expect(packageUseCategoriesSchema.safeParse([]).success).toBe(true);
    expect(packageUseCategoriesSchema.safeParse(["bread"]).success).toBe(true);
    expect(packageUseCategoriesSchema.safeParse(["bread", "drink"]).success).toBe(true);
  });
});

/* ----------------------------- itemRowToDTO mapping ----------------------------- */

describe("itemRowToDTO", () => {
  it("maps an empty array", () => {
    const dto = itemRowToDTO(baseItemRow({ package_use_categories: [] }));
    expect(dto.packageUseCategories).toEqual([]);
  });

  it("maps a single designation", () => {
    const dto = itemRowToDTO(baseItemRow({ package_use_categories: ["meat"] }));
    expect(dto.packageUseCategories).toEqual(["meat"]);
  });

  it("maps multiple designations", () => {
    const dto = itemRowToDTO(baseItemRow({ package_use_categories: ["meat", "drink"] }));
    expect(dto.packageUseCategories).toEqual(["meat", "drink"]);
  });

  it("preserves values without inferring from course category", () => {
    // A "beverage" course item with no package-use designation stays empty.
    const dto = itemRowToDTO(baseItemRow({ category: "beverage", package_use_categories: [] }));
    expect(dto.packageUseCategories).toEqual([]);
  });

  it("throws on malformed database data (not an array)", () => {
    expect(() => itemRowToDTO(baseItemRow({ package_use_categories: null as never }))).toThrow();
  });

  it("throws on unknown values in database data", () => {
    expect(() =>
      itemRowToDTO(baseItemRow({ package_use_categories: ["invalid"] as never })),
    ).toThrow();
  });

  it("throws on duplicates in database data", () => {
    expect(() =>
      itemRowToDTO(baseItemRow({ package_use_categories: ["meat", "meat"] as never })),
    ).toThrow();
  });

  it("preserves all other item fields", () => {
    const dto = itemRowToDTO(baseItemRow());
    expect(dto.id).toBe("00000000-0000-4000-8000-000000000001");
    expect(dto.name).toBe("Test Item");
    expect(dto.priceCents).toBe(1000);
    expect(dto.category).toBe("main");
    expect(dto.isActive).toBe(true);
  });
});

/* ----------------------------- Create schema ----------------------------- */

describe("menuItemCreateSchema — packageUseCategories", () => {
  it("is optional when omitted (repository defaults to [])", () => {
    const result = menuItemCreateSchema.parse(validCreateInput());
    // Schema marks it optional; the repository applies `?? []` on create.
    expect(result.packageUseCategories).toBeUndefined();
  });

  it("accepts an explicit empty array", () => {
    const result = menuItemCreateSchema.parse(validCreateInput({ packageUseCategories: [] }));
    expect(result.packageUseCategories).toEqual([]);
  });

  it("accepts valid designations", () => {
    const result = menuItemCreateSchema.parse(
      validCreateInput({ packageUseCategories: ["meat", "bread"] }),
    );
    expect(result.packageUseCategories).toEqual(["meat", "bread"]);
  });

  it("rejects null", () => {
    const result = menuItemCreateSchema.safeParse(validCreateInput({ packageUseCategories: null }));
    expect(result.success).toBe(false);
  });

  it("rejects unknown values", () => {
    const result = menuItemCreateSchema.safeParse(
      validCreateInput({ packageUseCategories: ["entree"] }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects duplicates", () => {
    const result = menuItemCreateSchema.safeParse(
      validCreateInput({ packageUseCategories: ["meat", "meat"] }),
    );
    expect(result.success).toBe(false);
  });
});

/* ----------------------------- Patch schema ----------------------------- */

describe("menuItemPatchSchema — packageUseCategories", () => {
  function validPatchInput(overrides: Record<string, unknown> = {}) {
    return { priceCents: 3000, ...overrides };
  }

  it("is optional (omitted → not in patch)", () => {
    const result = menuItemPatchSchema.parse(validPatchInput());
    expect(result.packageUseCategories).toBeUndefined();
  });

  it("accepts an explicit empty array (clears classification)", () => {
    const result = menuItemPatchSchema.parse(validPatchInput({ packageUseCategories: [] }));
    expect(result.packageUseCategories).toEqual([]);
  });

  it("accepts valid designations (replaces classification)", () => {
    const result = menuItemPatchSchema.parse(
      validPatchInput({ packageUseCategories: ["side", "drink"] }),
    );
    expect(result.packageUseCategories).toEqual(["side", "drink"]);
  });

  it("rejects null", () => {
    const result = menuItemPatchSchema.safeParse(validPatchInput({ packageUseCategories: null }));
    expect(result.success).toBe(false);
  });

  it("rejects unknown values", () => {
    const result = menuItemPatchSchema.safeParse(
      validPatchInput({ packageUseCategories: ["unknown"] }),
    );
    expect(result.success).toBe(false);
  });
});

/* ----------------------------- Mock repository create/update ----------------------------- */

describe("MockMenuRepository — packageUseCategories create/update", () => {
  function repoWithMenu(): MockMenuRepository {
    const repo = new MockMenuRepository();
    repo.menus = [
      {
        id: "00000000-0000-4000-8000-000000000002",
        name: "Test Menu",
        slug: "test-menu",
        description: "",
        status: "draft",
        display_order: 0,
        publish_at: null,
        unpublish_at: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        created_by: null,
        updated_by: null,
      },
    ];
    return repo;
  }

  it("create defaults to [] when omitted", async () => {
    const repo = repoWithMenu();
    const result = await repo.createItem(ADMIN_ROLE, null, {
      menuId: "00000000-0000-4000-8000-000000000002",
      name: "Brisket",
      priceCents: 2500,
      category: "main",
    });
    expect(result.ok).toBe(true);
    const item = repo.items[0];
    expect(item.packageUseCategories).toEqual([]);
  });

  it("create preserves explicit designations", async () => {
    const repo = repoWithMenu();
    const result = await repo.createItem(ADMIN_ROLE, null, {
      menuId: "00000000-0000-4000-8000-000000000002",
      name: "Brisket",
      priceCents: 2500,
      category: "main",
      packageUseCategories: ["meat", "bread"],
    });
    expect(result.ok).toBe(true);
    expect(repo.items[0].packageUseCategories).toEqual(["meat", "bread"]);
  });

  it("create preserves explicit empty array", async () => {
    const repo = repoWithMenu();
    await repo.createItem(ADMIN_ROLE, null, {
      menuId: "00000000-0000-4000-8000-000000000002",
      name: "Brisket",
      priceCents: 2500,
      category: "main",
      packageUseCategories: [],
    });
    expect(repo.items[0].packageUseCategories).toEqual([]);
  });

  it("update omitted field leaves classification unchanged", async () => {
    const repo = repoWithMenu();
    await repo.createItem(ADMIN_ROLE, null, {
      menuId: "00000000-0000-4000-8000-000000000002",
      name: "Brisket",
      priceCents: 2500,
      category: "main",
      packageUseCategories: ["meat"],
    });
    const item = repo.items[0];
    const result = await repo.updateItem(
      ADMIN_ROLE,
      null,
      item.id,
      {
        priceCents: 3000,
      },
      item.updatedAt,
    );
    expect(result.ok).toBe(true);
    expect(repo.items[0].packageUseCategories).toEqual(["meat"]);
  });

  it("update explicit [] clears classification", async () => {
    const repo = repoWithMenu();
    await repo.createItem(ADMIN_ROLE, null, {
      menuId: "00000000-0000-4000-8000-000000000002",
      name: "Brisket",
      priceCents: 2500,
      category: "main",
      packageUseCategories: ["meat", "side"],
    });
    const item = repo.items[0];
    const result = await repo.updateItem(
      ADMIN_ROLE,
      null,
      item.id,
      {
        packageUseCategories: [],
      },
      item.updatedAt,
    );
    expect(result.ok).toBe(true);
    expect(repo.items[0].packageUseCategories).toEqual([]);
  });

  it("update explicit array replaces classification", async () => {
    const repo = repoWithMenu();
    await repo.createItem(ADMIN_ROLE, null, {
      menuId: "00000000-0000-4000-8000-000000000002",
      name: "Brisket",
      priceCents: 2500,
      category: "main",
      packageUseCategories: ["meat"],
    });
    const item = repo.items[0];
    const result = await repo.updateItem(
      ADMIN_ROLE,
      null,
      item.id,
      {
        packageUseCategories: ["side", "drink"],
      },
      item.updatedAt,
    );
    expect(result.ok).toBe(true);
    expect(repo.items[0].packageUseCategories).toEqual(["side", "drink"]);
  });

  it("update preserves unrelated fields", async () => {
    const repo = repoWithMenu();
    await repo.createItem(ADMIN_ROLE, null, {
      menuId: "00000000-0000-4000-8000-000000000002",
      name: "Brisket",
      priceCents: 2500,
      category: "main",
      packageUseCategories: ["meat"],
      description: "Slow smoked",
      isFeatured: true,
    });
    const item = repo.items[0];
    await repo.updateItem(
      ADMIN_ROLE,
      null,
      item.id,
      {
        packageUseCategories: [],
      },
      item.updatedAt,
    );
    expect(repo.items[0].name).toBe("Brisket");
    expect(repo.items[0].description).toBe("Slow smoked");
    expect(repo.items[0].isFeatured).toBe(true);
    expect(repo.items[0].priceCents).toBe(2500);
  });

  it("create rejects unauthorized caller", async () => {
    const repo = repoWithMenu();
    const result = await repo.createItem("guest" as RoleKey, null, {
      menuId: "00000000-0000-4000-8000-000000000002",
      name: "Brisket",
      priceCents: 2500,
      category: "main",
      packageUseCategories: ["meat"],
    });
    expect(result.ok).toBe(false);
    expect(repo.items.length).toBe(0);
  });

  it("update returns conflict on stale timestamp", async () => {
    const repo = repoWithMenu();
    await repo.createItem(ADMIN_ROLE, null, {
      menuId: "00000000-0000-4000-8000-000000000002",
      name: "Brisket",
      priceCents: 2500,
      category: "main",
      packageUseCategories: ["meat"],
    });
    const item = repo.items[0];
    const result = await repo.updateItem(
      ADMIN_ROLE,
      null,
      item.id,
      {
        packageUseCategories: [],
      },
      "1999-01-01T00:00:00Z",
    );
    expect(result.ok).toBe(false);
    // Classification unchanged
    expect(repo.items[0].packageUseCategories).toEqual(["meat"]);
  });
});

/* ----------------------------- Mock seed items ----------------------------- */

describe("mock seed items — packageUseCategories initialized", () => {
  it("all seed items have packageUseCategories as an array", () => {
    const repo = new MockMenuRepository();
    for (const item of repo.items) {
      expect(Array.isArray(item.packageUseCategories)).toBe(true);
      for (const v of item.packageUseCategories) {
        expect(PACKAGE_USE_CATEGORIES).toContain(v);
      }
    }
  });
});
