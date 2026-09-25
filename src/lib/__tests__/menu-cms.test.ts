import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetMockMenuRepository,
  __getMockMenuRepositoryForSeed,
  getMenuRepository,
} from "@/lib/server/menu-repository.server";
import {
  normalizeSlug,
  isValidSlug,
  MENU_MUTATION_ROLES,
  MENU_DRAFT_READ_ROLES,
} from "@/lib/menu/constants";
import { menuInputSchema, menuItemInputSchema, publishingRuleViolations } from "@/lib/menu/schema";
import { MOCK_MENU_ITEMS } from "@/lib/mock/data";
import type { RoleKey } from "@/lib/domain/types";

const MUTATION_ROLES = MENU_MUTATION_ROLES as readonly RoleKey[];
const DRAFT_ROLES = MENU_DRAFT_READ_ROLES as readonly RoleKey[];
const ALL_ROLES: RoleKey[] = [
  "guest",
  "foh_staff",
  "kitchen_staff",
  "content_manager",
  "ops_manager",
  "administrator",
];

function seedMenu(status: "draft" | "published" | "archived" = "published") {
  process.env.APP_DATA_MODE = "mock";
  const repo = __getMockMenuRepositoryForSeed();
  const menuId = crypto.randomUUID();
  repo.__seed(
    [
      {
        id: menuId,
        name: "Provisional Sunday Menu",
        slug: "provisional-sunday-menu",
        description: "",
        status,
        displayOrder: 0,
        publishAt: null,
        unpublishAt: null,
        createdAt: "2025-09-01T10:00:00Z",
        updatedAt: "2025-09-01T10:00:00Z",
      },
    ],
    [
      {
        id: crypto.randomUUID(),
        menuId,
        name: "Mains",
        description: "",
        displayOrder: 0,
        isActive: true,
        createdAt: "2025-09-01T10:00:00Z",
        updatedAt: "2025-09-01T10:00:00Z",
      },
    ],
    [
      {
        id: crypto.randomUUID(),
        menuId,
        sectionId: null,
        name: "Slow-Braised Sunday Roast",
        description: "",
        priceCents: 2800,
        category: "main",
        imageUrl: null,
        imageAlt: null,
        dietaryTags: [],
        allergens: [],
        isActive: true,
        isFeatured: true,
        displayOrder: 0,
        createdAt: "2025-09-01T10:00:00Z",
        updatedAt: "2025-09-01T10:00:00Z",
      },
      {
        id: crypto.randomUUID(),
        menuId,
        sectionId: null,
        name: "Inactive Item",
        description: "",
        priceCents: 800,
        category: "side",
        imageUrl: null,
        imageAlt: null,
        dietaryTags: [],
        allergens: [],
        isActive: false,
        isFeatured: false,
        displayOrder: 1,
        createdAt: "2025-09-01T10:00:00Z",
        updatedAt: "2025-09-01T10:00:00Z",
      },
    ],
  );
  return menuId;
}

beforeEach(() => {
  process.env.APP_DATA_MODE = "mock";
  __resetMockMenuRepository();
});

describe("menu CMS — public filtering", () => {
  it("listPublishedMenus returns only published menus", async () => {
    seedMenu("published");
    const repo = getMenuRepository();
    const menus = await repo.listPublishedMenus();
    expect(menus).toHaveLength(1);
    expect(menus[0].status).toBe("published");
  });

  it("listPublishedMenus excludes draft and archived menus", async () => {
    seedMenu("draft");
    const repo = getMenuRepository();
    expect(await repo.listPublishedMenus()).toHaveLength(0);

    __resetMockMenuRepository();
    seedMenu("archived");
    expect(await repo.listPublishedMenus()).toHaveLength(0);
  });

  it("public reads exclude inactive items", async () => {
    seedMenu("published");
    const repo = getMenuRepository();
    const menus = await repo.listPublishedMenus();
    expect(menus[0].items).toHaveLength(1);
    expect(menus[0].items[0].name).toBe("Slow-Braised Sunday Roast");
  });

  it("getPublishedMenuBySlug returns null for unknown slug", async () => {
    seedMenu("published");
    const repo = getMenuRepository();
    expect(await repo.getPublishedMenuBySlug("nope")).toBeNull();
  });

  it("getPublishedMenuBySlug returns the published menu", async () => {
    seedMenu("published");
    const repo = getMenuRepository();
    const m = await repo.getPublishedMenuBySlug("provisional-sunday-menu");
    expect(m?.slug).toBe("provisional-sunday-menu");
  });
});

describe("menu CMS — permissions", () => {
  it("allows only mutation roles to create a menu", async () => {
    const repo = getMenuRepository();
    for (const role of ALL_ROLES) {
      __resetMockMenuRepository();
      const r = __getMockMenuRepositoryForSeed();
      r.__seed([], [], []);
      const result = await repo.createMenu(role, "actor-1", {
        name: "M",
        slug: "m",
        description: "",
        status: "draft",
        displayOrder: 0,
      });
      if ((MUTATION_ROLES as readonly string[]).includes(role)) {
        expect(result.ok, `${role} should be allowed`).toBe(true);
      } else {
        expect(result.ok, `${role} should be blocked`).toBe(false);
        expect(result.message).toMatch(/authorized/i);
      }
    }
  });

  it("guest, foh, and kitchen cannot read drafts", async () => {
    seedMenu("draft");
    const repo = getMenuRepository();
    for (const role of ALL_ROLES) {
      const list = await repo.listAllMenus(role);
      if ((DRAFT_ROLES as readonly string[]).includes(role)) {
        expect(list.length, `${role} should see drafts`).toBeGreaterThan(0);
      } else {
        expect(list, `${role} should see no drafts`).toEqual([]);
      }
    }
  });

  it("publishMenu is blocked for non-mutation roles", async () => {
    const menuId = seedMenu("draft");
    const repo = getMenuRepository();
    const result = await repo.publishMenu("guest", "actor-1", menuId);
    expect(result.ok).toBe(false);
  });
});

describe("menu CMS — prices & ordering", () => {
  it("rejects negative prices at the schema layer", () => {
    const parsed = menuItemInputSchema.safeParse({
      menuId: crypto.randomUUID(),
      name: "X",
      priceCents: -1,
      category: "main",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts zero and positive prices", () => {
    for (const price of [0, 500, 2800]) {
      const parsed = menuItemInputSchema.safeParse({
        menuId: crypto.randomUUID(),
        name: "X",
        priceCents: price,
        category: "main",
      });
      expect(parsed.success, `price ${price}`).toBe(true);
    }
  });

  it("orders published menus by display_order", async () => {
    process.env.APP_DATA_MODE = "mock";
    const repo = __getMockMenuRepositoryForSeed();
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    repo.__seed(
      [
        {
          id: b,
          name: "B",
          slug: "b",
          description: "",
          status: "published",
          displayOrder: 1,
          publishAt: null,
          unpublishAt: null,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
        {
          id: a,
          name: "A",
          slug: "a",
          description: "",
          status: "published",
          displayOrder: 0,
          publishAt: null,
          unpublishAt: null,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
      ],
      [],
      [],
    );
    const menus = await getMenuRepository().listPublishedMenus();
    expect(menus.map((m) => m.slug)).toEqual(["a", "b"]);
  });
});

describe("menu CMS — publishing rules", () => {
  it("publishingRuleViolations flags unpublish before publish", () => {
    const v = publishingRuleViolations({
      status: "published",
      publishAt: "2025-10-01T00:00:00Z",
      unpublishAt: "2025-09-01T00:00:00Z",
    });
    expect(v.length).toBeGreaterThan(0);
  });

  it("publishingRuleViolations flags archived menu with publish dates", () => {
    const v = publishingRuleViolations({
      status: "archived",
      publishAt: "2025-10-01T00:00:00Z",
    });
    expect(v.length).toBeGreaterThan(0);
  });

  it("publishingRuleViolations passes a clean published menu", () => {
    const v = publishingRuleViolations({
      status: "published",
      publishAt: "2025-10-01T00:00:00Z",
      unpublishAt: "2025-11-01T00:00:00Z",
    });
    expect(v).toEqual([]);
  });

  it("archiving a menu clears its publish dates (mock)", async () => {
    const menuId = seedMenu("published");
    const repo = getMenuRepository();
    await repo.archiveMenu("administrator", "actor-1", menuId);
    const all = await repo.listAllMenus("administrator");
    const m = all.find((x) => x.id === menuId);
    expect(m?.status).toBe("archived");
    expect(m?.publishAt).toBeNull();
    expect(m?.unpublishAt).toBeNull();
  });
});

describe("menu CMS — slug normalization", () => {
  it("normalizes messy slugs", () => {
    expect(normalizeSlug("  Sunday Menu! ")).toBe("sunday-menu");
    expect(normalizeSlug("A___B  C")).toBe("a-b-c");
  });

  it("validates slug pattern", () => {
    expect(isValidSlug("sunday-menu")).toBe(true);
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("-bad")).toBe(false);
    expect(isValidSlug("BAD Slug")).toBe(false);
  });

  it("schema transforms slug to normalized form", () => {
    const parsed = menuInputSchema.safeParse({ name: "M", slug: "  Hello World! " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.slug).toBe("hello-world");
  });
});

describe("menu CMS — mock data consistency preserved", () => {
  it("existing mock menu items still validate against the schema", () => {
    for (const item of MOCK_MENU_ITEMS) {
      const parsed = menuItemInputSchema.safeParse({
        menuId: crypto.randomUUID(),
        name: item.name,
        description: item.description,
        priceCents: item.priceCents,
        category: item.category,
        imageUrl: item.imageUrl ?? null,
        imageAlt: item.imageAlt ?? null,
        dietaryTags: item.dietaryTags,
        allergens: item.allergens,
        isActive: item.available,
      });
      expect(parsed.success, `${item.name} should validate`).toBe(true);
    }
  });
});

describe("menu CMS — public items respect active same-menu section", () => {
  function seedWithSectionItems() {
    process.env.APP_DATA_MODE = "mock";
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = crypto.randomUUID();
    const activeSectionId = crypto.randomUUID();
    const inactiveSectionId = crypto.randomUUID();
    repo.__seed(
      [
        {
          id: menuId,
          name: "M",
          slug: "m",
          description: "",
          status: "published",
          displayOrder: 0,
          publishAt: null,
          unpublishAt: null,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
      ],
      [
        {
          id: activeSectionId,
          menuId,
          name: "Active Section",
          description: "",
          displayOrder: 0,
          isActive: true,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
        {
          id: inactiveSectionId,
          menuId,
          name: "Inactive Section",
          description: "",
          displayOrder: 1,
          isActive: false,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
      ],
      [
        {
          id: crypto.randomUUID(),
          menuId,
          sectionId: null,
          name: "Unassigned Item",
          description: "",
          priceCents: 500,
          category: "side",
          imageUrl: null,
          imageAlt: null,
          dietaryTags: [],
          allergens: [],
          isActive: true,
          isFeatured: false,
          displayOrder: 0,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
        {
          id: crypto.randomUUID(),
          menuId,
          sectionId: activeSectionId,
          name: "Item In Active Section",
          description: "",
          priceCents: 1800,
          category: "main",
          imageUrl: null,
          imageAlt: null,
          dietaryTags: [],
          allergens: [],
          isActive: true,
          isFeatured: false,
          displayOrder: 1,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
        {
          id: crypto.randomUUID(),
          menuId,
          sectionId: inactiveSectionId,
          name: "Item In Inactive Section",
          description: "",
          priceCents: 900,
          category: "starter",
          imageUrl: null,
          imageAlt: null,
          dietaryTags: [],
          allergens: [],
          isActive: true,
          isFeatured: false,
          displayOrder: 2,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
      ],
    );
    return menuId;
  }

  it("excludes items assigned to an inactive section from public reads", async () => {
    seedWithSectionItems();
    const repo = getMenuRepository();
    const menus = await repo.listPublishedMenus();
    const names = menus[0].items.map((i) => i.name);
    expect(names).toContain("Unassigned Item");
    expect(names).toContain("Item In Active Section");
    expect(names).not.toContain("Item In Inactive Section");
  });

  it("keeps unassigned items (section_id null) visible", async () => {
    seedWithSectionItems();
    const repo = getMenuRepository();
    const m = await repo.getPublishedMenuBySlug("m");
    expect(m?.items.map((i) => i.name)).toContain("Unassigned Item");
  });
});

describe("menu CMS — image alt accessibility validation", () => {
  it("rejects a present image without alt text", () => {
    const parsed = menuItemInputSchema.safeParse({
      menuId: crypto.randomUUID(),
      name: "X",
      priceCents: 1000,
      category: "main",
      imageUrl: "https://example.com/dish.webp",
      imageAlt: null,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.includes("imageAlt"))).toBe(true);
    }
  });

  it("normalizes blank image values to null and accepts them without alt", () => {
    const parsed = menuItemInputSchema.safeParse({
      menuId: crypto.randomUUID(),
      name: "X",
      priceCents: 1000,
      category: "main",
      imageUrl: "   ",
      imageAlt: "   ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.imageUrl).toBeNull();
      expect(parsed.data.imageAlt).toBeNull();
    }
  });

  it("accepts an image with descriptive alt text", () => {
    const parsed = menuItemInputSchema.safeParse({
      menuId: crypto.randomUUID(),
      name: "X",
      priceCents: 1000,
      category: "main",
      imageUrl: "https://example.com/dish.webp",
      imageAlt: "Slow-braised roast on a warm platter",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("menu CMS — publish/unpublish ordering validation", () => {
  it("publishingRuleViolations flags unpublish not strictly after publish", () => {
    const v = publishingRuleViolations({
      status: "published",
      publishAt: "2025-10-01T00:00:00Z",
      unpublishAt: "2025-10-01T00:00:00Z",
    });
    expect(v.length).toBeGreaterThan(0);
  });

  it("publishingRuleViolations allows either date to be null", () => {
    expect(
      publishingRuleViolations({ status: "published", publishAt: null, unpublishAt: null }),
    ).toEqual([]);
    expect(
      publishingRuleViolations({
        status: "published",
        publishAt: "2025-10-01T00:00:00Z",
        unpublishAt: null,
      }),
    ).toEqual([]);
    expect(
      publishingRuleViolations({
        status: "published",
        publishAt: null,
        unpublishAt: "2025-12-01T00:00:00Z",
      }),
    ).toEqual([]);
  });
});
