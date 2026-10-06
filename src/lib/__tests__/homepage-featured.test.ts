/**
 * Phase 3A5 — CMS-powered homepage menu preview.
 *
 * Behavioral tests for featured-item selection, public visibility, ordering,
 * the six-item limit, and empty/error handling. The selection logic is unit
 * tested directly; the public read path is exercised through the mock
 * repository (which mirrors the Supabase RLS public filter).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  selectFeaturedItems,
  featuredMenuItemsQueryOptions,
  FEATURED_LIMIT,
} from "@/components/public/public-menu-data";
import type { MenuWithContentDTO, MenuItemDTO, MenuSectionDTO } from "@/lib/menu/types";
import {
  __resetMockMenuRepository,
  __getMockMenuRepositoryForSeed,
} from "@/lib/server/menu-repository.server";

const uid = (): string => crypto.randomUUID();

function makeItem(over: Partial<MenuItemDTO> & { menuId: string }): MenuItemDTO {
  return {
    id: uid(),
    sectionId: null,
    name: "Item",
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
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...over,
  };
}

function makeSection(over: Partial<MenuSectionDTO> & { menuId: string }): MenuSectionDTO {
  return {
    id: uid(),
    name: "Section",
    description: "",
    displayOrder: 0,
    isActive: true,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...over,
  };
}

function makeMenu(over: Partial<MenuWithContentDTO>): MenuWithContentDTO {
  return {
    id: uid(),
    name: "Menu",
    slug: "menu",
    description: "",
    status: "published",
    displayOrder: 0,
    publishAt: null,
    unpublishAt: null,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    sections: [],
    items: [],
    ...over,
  };
}

/* ----------------------------- Featured selection ----------------------------- */

describe("selectFeaturedItems — selection", () => {
  it("returns only items marked isFeatured", () => {
    const menu = makeMenu({
      items: [
        makeItem({ menuId: "m1", id: "feat", name: "Featured", isFeatured: true }),
        makeItem({ menuId: "m1", id: "plain", name: "Plain", isFeatured: false }),
      ],
    });
    const featured = selectFeaturedItems([menu]);
    expect(featured).toHaveLength(1);
    expect(featured[0].id).toBe("feat");
  });

  it("limits to FEATURED_LIMIT (6) items", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeItem({ menuId: "m1", id: `i${i}`, isFeatured: true, displayOrder: i }),
    );
    const menu = makeMenu({ items });
    const featured = selectFeaturedItems([menu]);
    expect(featured).toHaveLength(FEATURED_LIMIT);
    expect(FEATURED_LIMIT).toBe(6);
    // First six by displayOrder.
    expect(featured.map((f) => f.id)).toEqual(["i0", "i1", "i2", "i3", "i4", "i5"]);
  });

  it("returns an empty array when no items are featured", () => {
    const menu = makeMenu({
      items: [makeItem({ menuId: "m1", isFeatured: false })],
    });
    expect(selectFeaturedItems([menu])).toEqual([]);
  });

  it("returns an empty array when there are no menus", () => {
    expect(selectFeaturedItems([])).toEqual([]);
  });
});

/* ----------------------------- Ordering ----------------------------- */

describe("selectFeaturedItems — ordering", () => {
  it("orders by menu displayOrder first", () => {
    const menuB = makeMenu({
      id: "mb",
      displayOrder: 1,
      items: [makeItem({ menuId: "mb", id: "b1", isFeatured: true, displayOrder: 0 })],
    });
    const menuA = makeMenu({
      id: "ma",
      displayOrder: 0,
      items: [makeItem({ menuId: "ma", id: "a1", isFeatured: true, displayOrder: 0 })],
    });
    const featured = selectFeaturedItems([menuB, menuA]);
    expect(featured.map((f) => f.id)).toEqual(["a1", "b1"]);
  });

  it("orders by item displayOrder within the same menu", () => {
    const menu = makeMenu({
      items: [
        makeItem({ menuId: "m1", id: "z", isFeatured: true, displayOrder: 2 }),
        makeItem({ menuId: "m1", id: "a", isFeatured: true, displayOrder: 1 }),
      ],
    });
    const featured = selectFeaturedItems([menu]);
    expect(featured.map((f) => f.id)).toEqual(["a", "z"]);
  });

  it("uses a stable id tie-breaker when displayOrder is equal", () => {
    const menu = makeMenu({
      items: [
        makeItem({ menuId: "m1", id: "zzz", isFeatured: true, displayOrder: 5 }),
        makeItem({ menuId: "m1", id: "aaa", isFeatured: true, displayOrder: 5 }),
      ],
    });
    const featured = selectFeaturedItems([menu]);
    expect(featured.map((f) => f.id)).toEqual(["aaa", "zzz"]);
  });

  it("spans featured items across multiple menus in menu order", () => {
    const menuA = makeMenu({
      id: "ma",
      displayOrder: 0,
      items: [
        makeItem({ menuId: "ma", id: "a2", isFeatured: true, displayOrder: 1 }),
        makeItem({ menuId: "ma", id: "a1", isFeatured: true, displayOrder: 0 }),
      ],
    });
    const menuB = makeMenu({
      id: "mb",
      displayOrder: 1,
      items: [makeItem({ menuId: "mb", id: "b1", isFeatured: true, displayOrder: 0 })],
    });
    const featured = selectFeaturedItems([menuA, menuB]);
    expect(featured.map((f) => f.id)).toEqual(["a1", "a2", "b1"]);
  });
});

/* ----------------------------- Public visibility (mock repository, behavioral) ----------------------------- */

describe("featured public read path — visibility (mock repository)", () => {
  beforeEach(() => {
    process.env.APP_DATA_MODE = "mock";
    __resetMockMenuRepository();
  });

  it("a draft menu's featured items are never returned publicly", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    await repo.createMenu("content_manager", "actor", {
      name: "Draft Menu",
      slug: "draft-menu",
      description: "",
      displayOrder: 0,
    });
    const menus = await repo.listPublishedMenus();
    // A draft menu must not appear in published reads, so it has no featured items.
    expect(menus.find((m) => m.slug === "draft-menu")).toBeUndefined();
    expect(selectFeaturedItems(menus)).toEqual([]);
  });

  it("published menu with a featured item returns it through the public path", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const created = await repo.createMenu("content_manager", "actor", {
      name: "Pub Menu",
      slug: "pub-menu",
      description: "",
      displayOrder: 0,
    });
    expect(created.ok).toBe(true);
    // Add a featured item, then publish.
    const menus = await repo.listAllMenus("content_manager");
    const menu = menus.find((m) => m.slug === "pub-menu")!;
    const itemRes = await repo.createItem("content_manager", "actor", {
      menuId: menu.id,
      name: "Featured Dish",
      description: "",
      priceCents: 1500,
      category: "main",
      isFeatured: true,
      displayOrder: 0,
    });
    expect(itemRes.ok).toBe(true);
    const pubRes = await repo.publishMenu("content_manager", "actor", menu.id);
    expect(pubRes.ok).toBe(true);

    const published = await repo.listPublishedMenus();
    const featured = selectFeaturedItems(published);
    expect(featured).toHaveLength(1);
    expect(featured[0].name).toBe("Featured Dish");
  });

  it("an item in an inactive section is not returned (public filter already excludes it)", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    await repo.createMenu("content_manager", "actor", {
      name: "Sec Menu",
      slug: "sec-menu",
      description: "",
      displayOrder: 0,
    });
    const menus = await repo.listAllMenus("content_manager");
    let menu = menus.find((m) => m.slug === "sec-menu")!;
    const secRes = await repo.createSection("content_manager", "actor", {
      menuId: menu.id,
      name: "Sec",
      description: "",
      displayOrder: 0,
    });
    expect(secRes.ok).toBe(true);
    // Re-fetch to get the newly created section.
    menu = (await repo.getMenuDetail("content_manager", menu.id))!;
    const sectionId = menu.sections[0].id;
    await repo.createItem("content_manager", "actor", {
      menuId: menu.id,
      sectionId,
      name: "In Inactive Section",
      description: "",
      priceCents: 1000,
      category: "main",
      isFeatured: true,
      displayOrder: 0,
    });
    // Deactivate the section, then publish the menu.
    const updated = await repo.getMenuDetail("content_manager", menu.id);
    const sec = updated!.sections.find((s) => s.id === sectionId)!;
    await repo.setSectionActive("content_manager", "actor", sectionId, false, sec.updatedAt);
    await repo.publishMenu("content_manager", "actor", menu.id);

    const published = await repo.listPublishedMenus();
    const featured = selectFeaturedItems(published);
    // The featured item is in an inactive section — excluded by the public filter.
    expect(featured.find((f) => f.name === "In Inactive Section")).toBeUndefined();
  });
});

/* ----------------------------- Query options ----------------------------- */

describe("featuredMenuItemsQueryOptions", () => {
  it("has staleTime 0 so CMS edits refresh on return navigation", () => {
    expect(featuredMenuItemsQueryOptions().staleTime).toBe(0);
  });

  it("uses a stable, distinct query key", () => {
    expect(featuredMenuItemsQueryOptions().queryKey).toEqual(["public", "menus", "featured"]);
  });
});

/* ----------------------------- No server-secret references in client modules ----------------------------- */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("homepage featured client modules — no server-secret references", () => {
  it("featured-menu-preview.tsx imports the card/button components, not .server.ts modules", () => {
    const src = readSrc("src/components/public/featured-menu-preview.tsx");
    expect(src).not.toMatch(/\.server\.ts/);
    expect(src).not.toMatch(/supabase-admin/);
    expect(src).not.toMatch(/SERVICE_ROLE/i);
  });

  it("the homepage route uses the featured query options, not MOCK_MENU_ITEMS", () => {
    const src = readSrc("src/routes/_public.index.tsx");
    expect(src).toMatch(/featuredMenuItemsQueryOptions/);
    expect(src).toMatch(/FeaturedMenuPreview/);
    expect(src).not.toMatch(/MOCK_MENU_ITEMS/);
    expect(src).not.toMatch(/\.server\.ts/);
  });
});
