/**
 * Admin Menu Items — repository behavioral tests (Phase 3A3C).
 *
 * Server functions cannot be invoked directly in vitest (no Start runtime
 * AsyncLocalStorage), so these tests exercise the repository logic the UI
 * delegates to: authorization, archived-menu protection, creation, editing,
 * activation/deactivation, complete-list atomic reordering, duplicate/missing/
 * cross-menu reorder rejection, concurrency conflicts, and final-eligible-item
 * protection.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetMockMenuRepository,
  __getMockMenuRepositoryForSeed,
  getMenuRepository,
} from "@/lib/server/menu-repository.server";
import { __getMockAuthRepository } from "@/lib/server/auth-repository.server";
import { MENU_MUTATION_ROLES } from "@/lib/menu/constants";
import type { RoleKey } from "@/lib/domain/types";

const MUTATION_ROLES = MENU_MUTATION_ROLES as readonly RoleKey[];
const BLOCKED_ROLES: RoleKey[] = ["guest", "foh_staff", "kitchen_staff"];
const BASE_TIME = "2025-09-01T10:00:00Z";

const newId = (): string => crypto.randomUUID();
const authenticateAs = (role: RoleKey): void => {
  __getMockAuthRepository().__seedMockSession(role);
};
const unauthenticate = (): void => {
  void __getMockAuthRepository().signout(false);
};

function seedMenu(role: RoleKey = "administrator"): string {
  const repo = __getMockMenuRepositoryForSeed();
  const menuId = newId();
  repo.__seed(
    [
      {
        id: menuId,
        name: "Sunday Menu",
        slug: "sunday-menu",
        description: "A provisional menu.",
        status: "draft",
        displayOrder: 0,
        publishAt: null,
        unpublishAt: null,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      },
    ],
    [],
    [],
  );
  authenticateAs(role);
  return menuId;
}

function seedArchivedMenuWithItem() {
  const repo = __getMockMenuRepositoryForSeed();
  const menuId = newId();
  const itemId = newId();
  repo.__seed(
    [
      {
        id: menuId,
        name: "Arch",
        slug: "arch",
        description: "",
        status: "archived",
        displayOrder: 0,
        publishAt: null,
        unpublishAt: null,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      },
    ],
    [],
    [
      {
        id: itemId,
        menuId,
        sectionId: null,
        name: "Old",
        description: "",
        priceCents: 1000,
        category: "main",
        imageUrl: null,
        imageAlt: null,
        dietaryTags: [],
        allergens: [],
        isActive: true,
        isFeatured: false,
        displayOrder: 0,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      },
    ],
  );
  authenticateAs("administrator");
  return { menuId, itemId };
}

function seedPublishedMenuWithOneItem() {
  const repo = __getMockMenuRepositoryForSeed();
  const menuId = newId();
  const itemId = newId();
  repo.__seed(
    [
      {
        id: menuId,
        name: "Pub",
        slug: "pub",
        description: "",
        status: "published",
        displayOrder: 0,
        publishAt: null,
        unpublishAt: null,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      },
    ],
    [],
    [
      {
        id: itemId,
        menuId,
        sectionId: null,
        name: "Roast",
        description: "",
        priceCents: 2500,
        category: "main",
        imageUrl: null,
        imageAlt: null,
        dietaryTags: [],
        allergens: [],
        isActive: true,
        isFeatured: false,
        displayOrder: 0,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      },
    ],
  );
  authenticateAs("administrator");
  return { menuId, itemId };
}

function seedTwoItems(menuId: string, status = "draft") {
  const repo = __getMockMenuRepositoryForSeed();
  const a = newId();
  const b = newId();
  repo.__seed(
    [
      {
        id: menuId,
        name: "M",
        slug: "m",
        description: "",
        status,
        displayOrder: 0,
        publishAt: null,
        unpublishAt: null,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      },
    ],
    [],
    [
      {
        id: a,
        menuId,
        sectionId: null,
        name: "A",
        description: "",
        priceCents: 1000,
        category: "main",
        imageUrl: null,
        imageAlt: null,
        dietaryTags: [],
        allergens: [],
        isActive: true,
        isFeatured: false,
        displayOrder: 0,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      },
      {
        id: b,
        menuId,
        sectionId: null,
        name: "B",
        description: "",
        priceCents: 1000,
        category: "main",
        imageUrl: null,
        imageAlt: null,
        dietaryTags: [],
        allergens: [],
        isActive: true,
        isFeatured: false,
        displayOrder: 1,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      },
    ],
  );
  authenticateAs("administrator");
  return { a, b };
}

beforeEach(() => {
  process.env.APP_DATA_MODE = "mock";
  __resetMockMenuRepository();
  try {
    unauthenticate();
  } catch {
    /* first call: no instance yet */
  }
});

/* ----------------------------- Authorization ----------------------------- */

describe("admin items — authorization", () => {
  it.each(MUTATION_ROLES)("allows %s to create an item", async (role) => {
    const menuId = seedMenu(role);
    const repo = getMenuRepository();
    const res = await repo.createItem(role, "actor-1", {
      menuId,
      name: "Bread",
      priceCents: 800,
      category: "starter",
    });
    expect(res.ok).toBe(true);
  });

  it.each(BLOCKED_ROLES)("rejects %s from creating an item", async (role) => {
    const menuId = seedMenu("administrator");
    unauthenticate();
    authenticateAs(role);
    const repo = getMenuRepository();
    const res = await repo.createItem(role, "actor-1", {
      menuId,
      name: "Bread",
      priceCents: 800,
      category: "starter",
    });
    expect(res.ok).toBe(false);
  });

  it("rejects unauthenticated users from creating an item", async () => {
    const menuId = seedMenu("administrator");
    unauthenticate();
    const repo = getMenuRepository();
    const res = await repo.createItem("guest", null, {
      menuId,
      name: "Bread",
      priceCents: 800,
      category: "starter",
    });
    expect(res.ok).toBe(false);
  });
});

/* --------------------- Archived-menu protection --------------------- */

describe("admin items — archived-menu protection", () => {
  it("rejects creating an item on an archived menu", async () => {
    const { menuId } = seedArchivedMenuWithItem();
    const r = getMenuRepository();
    const res = await r.createItem("administrator", "actor-1", {
      menuId,
      name: "X",
      priceCents: 1000,
      category: "main",
    });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/archived/i);
  });

  it("rejects editing an item on an archived menu", async () => {
    const { itemId } = seedArchivedMenuWithItem();
    const r = getMenuRepository();
    const res = await r.updateItem("administrator", "actor-1", itemId, { name: "New" }, BASE_TIME);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/archived/i);
  });

  it("rejects activating/deactivating an item on an archived menu", async () => {
    const { itemId } = seedArchivedMenuWithItem();
    const r = getMenuRepository();
    const res = await r.setItemActive("administrator", "actor-1", itemId, false, BASE_TIME);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/archived/i);
  });

  it("rejects reordering items on an archived menu", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = newId();
    const { a, b } = seedTwoItems(menuId, "archived");
    const r = getMenuRepository();
    const res = await r.reorderItems("administrator", "actor-1", menuId, [b, a]);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/archived/i);
  });
});

/* --------------------- Cross-menu / inactive-section rejection --------------------- */

describe("admin items — cross-menu and inactive-section rejection", () => {
  it("rejects assigning an item to a section of a different menu", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = newId();
    const otherMenuId = newId();
    const otherSectionId = newId();
    repo.__seed(
      [
        {
          id: menuId,
          name: "M",
          slug: "m",
          description: "",
          status: "draft",
          displayOrder: 0,
          publishAt: null,
          unpublishAt: null,
          createdAt: BASE_TIME,
          updatedAt: BASE_TIME,
        },
        {
          id: otherMenuId,
          name: "Other",
          slug: "other",
          description: "",
          status: "draft",
          displayOrder: 1,
          publishAt: null,
          unpublishAt: null,
          createdAt: BASE_TIME,
          updatedAt: BASE_TIME,
        },
      ],
      [
        {
          id: otherSectionId,
          menuId: otherMenuId,
          name: "OtherMains",
          description: "",
          displayOrder: 0,
          isActive: true,
          createdAt: BASE_TIME,
          updatedAt: BASE_TIME,
        },
      ],
      [],
    );
    authenticateAs("administrator");
    const r = getMenuRepository();
    const res = await r.createItem("administrator", "actor-1", {
      menuId,
      sectionId: otherSectionId,
      name: "X",
      priceCents: 1000,
      category: "main",
    });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/section/i);
  });

  it("rejects assigning an item to an inactive section", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = newId();
    const inactiveSectionId = newId();
    repo.__seed(
      [
        {
          id: menuId,
          name: "M",
          slug: "m",
          description: "",
          status: "draft",
          displayOrder: 0,
          publishAt: null,
          unpublishAt: null,
          createdAt: BASE_TIME,
          updatedAt: BASE_TIME,
        },
      ],
      [
        {
          id: inactiveSectionId,
          menuId,
          name: "Inactive",
          description: "",
          displayOrder: 0,
          isActive: false,
          createdAt: BASE_TIME,
          updatedAt: BASE_TIME,
        },
      ],
      [],
    );
    authenticateAs("administrator");
    const r = getMenuRepository();
    const res = await r.createItem("administrator", "actor-1", {
      menuId,
      sectionId: inactiveSectionId,
      name: "X",
      priceCents: 1000,
      category: "main",
    });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/inactive/i);
  });

  it("allows creating an unassigned item (sectionId null)", async () => {
    const menuId = seedMenu("administrator");
    const repo = getMenuRepository();
    const res = await repo.createItem("administrator", "actor-1", {
      menuId,
      sectionId: null,
      name: "Standalone",
      priceCents: 1200,
      category: "side",
    });
    expect(res.ok).toBe(true);
  });
});

/* --------------------- Activation, invariant, concurrency, reorder --------------------- */

describe("admin items — activation, invariant, concurrency, reorder", () => {
  it("deactivating the final eligible item of a published menu fails safely", async () => {
    const { menuId, itemId } = seedPublishedMenuWithOneItem();
    const repo = getMenuRepository();
    const detail = await repo.getMenuDetail("administrator", menuId);
    const item = detail!.items.find((x) => x.id === itemId)!;
    const res = await repo.setItemActive("administrator", "actor-1", itemId, false, item.updatedAt);
    expect(res.ok).toBe(false);
    const after = await repo.getMenuDetail("administrator", menuId);
    const still = after!.items.find((x) => x.id === itemId)!;
    expect(still.isActive).toBe(true);
  });

  it("setItemActive returns a conflict on a stale expectedUpdatedAt", async () => {
    const { itemId } = seedPublishedMenuWithOneItem();
    const repo = getMenuRepository();
    const res = await repo.setItemActive(
      "administrator",
      "actor-1",
      itemId,
      true,
      "2020-01-01T00:00:00Z",
    );
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/changed by someone else|refresh/i);
  });

  it("reorder rejects a partial list (missing an item)", async () => {
    const menuId = newId();
    const { a, b } = seedTwoItems(menuId);
    const r = getMenuRepository();
    const res = await r.reorderItems("administrator", "actor-1", menuId, [a]);
    expect(res.ok).toBe(false);
    const detail = await r.getMenuDetail("administrator", menuId);
    const items = [...detail!.items].sort((x, y) => x.displayOrder - y.displayOrder);
    expect(items[0].id).toBe(a);
    expect(items[1].id).toBe(b);
  });

  it("reorder rejects duplicate IDs", async () => {
    const menuId = newId();
    const { a } = seedTwoItems(menuId);
    const r = getMenuRepository();
    const res = await r.reorderItems("administrator", "actor-1", menuId, [a, a]);
    expect(res.ok).toBe(false);
  });

  it("reorder rejects cross-menu IDs", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = newId();
    const otherMenuId = newId();
    const a = newId();
    const foreign = newId();
    repo.__seed(
      [
        {
          id: menuId,
          name: "M",
          slug: "m",
          description: "",
          status: "draft",
          displayOrder: 0,
          publishAt: null,
          unpublishAt: null,
          createdAt: BASE_TIME,
          updatedAt: BASE_TIME,
        },
        {
          id: otherMenuId,
          name: "Other",
          slug: "other",
          description: "",
          status: "draft",
          displayOrder: 1,
          publishAt: null,
          unpublishAt: null,
          createdAt: BASE_TIME,
          updatedAt: BASE_TIME,
        },
      ],
      [],
      [
        {
          id: a,
          menuId,
          sectionId: null,
          name: "A",
          description: "",
          priceCents: 1000,
          category: "main",
          imageUrl: null,
          imageAlt: null,
          dietaryTags: [],
          allergens: [],
          isActive: true,
          isFeatured: false,
          displayOrder: 0,
          createdAt: BASE_TIME,
          updatedAt: BASE_TIME,
        },
        {
          id: foreign,
          menuId: otherMenuId,
          sectionId: null,
          name: "Foreign",
          description: "",
          priceCents: 1000,
          category: "main",
          imageUrl: null,
          imageAlt: null,
          dietaryTags: [],
          allergens: [],
          isActive: true,
          isFeatured: false,
          displayOrder: 0,
          createdAt: BASE_TIME,
          updatedAt: BASE_TIME,
        },
      ],
    );
    authenticateAs("administrator");
    const r = getMenuRepository();
    const res = await r.reorderItems("administrator", "actor-1", menuId, [a, foreign]);
    expect(res.ok).toBe(false);
  });

  it("a complete reorder list succeeds and reorders atomically", async () => {
    const menuId = newId();
    const { a, b } = seedTwoItems(menuId);
    const r = getMenuRepository();
    const res = await r.reorderItems("administrator", "actor-1", menuId, [b, a]);
    expect(res.ok).toBe(true);
    const detail = await r.getMenuDetail("administrator", menuId);
    const items = [...detail!.items].sort((x, y) => x.displayOrder - y.displayOrder);
    expect(items[0].id).toBe(b);
    expect(items[1].id).toBe(a);
  });

  it("updateItem returns a conflict on a stale expectedUpdatedAt", async () => {
    const menuId = seedMenu("administrator");
    const repo = getMenuRepository();
    await repo.createItem("administrator", "actor-1", {
      menuId,
      name: "Bread",
      priceCents: 800,
      category: "starter",
    });
    const detail = await repo.getMenuDetail("administrator", menuId);
    const item = detail!.items[0];
    const res = await repo.updateItem(
      "administrator",
      "actor-1",
      item.id,
      { name: "New Name" },
      "2020-01-01T00:00:00Z",
    );
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/changed by someone else|refresh/i);
  });

  it("create forces isActive=true server-side", async () => {
    const menuId = seedMenu("administrator");
    const repo = getMenuRepository();
    await repo.createItem("administrator", "actor-1", {
      menuId,
      name: "Bread",
      priceCents: 800,
      category: "starter",
    });
    const detail = await repo.getMenuDetail("administrator", menuId);
    expect(detail!.items[0].isActive).toBe(true);
  });
});

/* --------------------- Image-alt merged-state enforcement --------------------- */

describe("admin items — image-alt merged-state accessibility", () => {
  it("rejects clearing alt text while an existing image remains", async () => {
    const menuId = seedMenu("administrator");
    const repo = getMenuRepository();
    // Create an item with an image + alt text.
    await repo.createItem("administrator", "actor-1", {
      menuId,
      name: "Roast",
      priceCents: 2500,
      category: "main",
      imageUrl: "https://example.com/roast.png",
      imageAlt: "A plated Sunday roast.",
    });
    const detail = await repo.getMenuDetail("administrator", menuId);
    const item = detail!.items[0];
    // Patch that clears ONLY alt text (image remains) must be rejected on the
    // merged final state — mirrors the DB CHECK constraint in 0003.
    const res = await repo.updateItem(
      "administrator",
      "actor-1",
      item.id,
      { imageAlt: null },
      item.updatedAt,
    );
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/alt text/i);
    // The item is unchanged.
    const after = await repo.getMenuDetail("administrator", menuId);
    expect(after!.items[0].imageAlt).toBe("A plated Sunday roast.");
  });

  it("permits clearing both image and alt text together", async () => {
    const menuId = seedMenu("administrator");
    const repo = getMenuRepository();
    await repo.createItem("administrator", "actor-1", {
      menuId,
      name: "Roast",
      priceCents: 2500,
      category: "main",
      imageUrl: "https://example.com/roast.png",
      imageAlt: "A plated Sunday roast.",
    });
    const detail = await repo.getMenuDetail("administrator", menuId);
    const item = detail!.items[0];
    const res = await repo.updateItem(
      "administrator",
      "actor-1",
      item.id,
      { imageUrl: null, imageAlt: null },
      item.updatedAt,
    );
    expect(res.ok).toBe(true);
    const after = await repo.getMenuDetail("administrator", menuId);
    expect(after!.items[0].imageUrl).toBeNull();
    expect(after!.items[0].imageAlt).toBeNull();
  });

  it("rejects adding an image without alt text on update", async () => {
    const menuId = seedMenu("administrator");
    const repo = getMenuRepository();
    await repo.createItem("administrator", "actor-1", {
      menuId,
      name: "Roast",
      priceCents: 2500,
      category: "main",
    });
    const detail = await repo.getMenuDetail("administrator", menuId);
    const item = detail!.items[0];
    const res = await repo.updateItem(
      "administrator",
      "actor-1",
      item.id,
      { imageUrl: "https://example.com/roast.png" },
      item.updatedAt,
    );
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/alt text/i);
  });
});
