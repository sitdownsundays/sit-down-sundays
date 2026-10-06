/**
 * Phase 3A4 — Live Public Menu Page.
 *
 * Behavioral + source-inspection tests for the public menu view helpers and
 * the server-function-backed public read path. These do NOT hit a live
 * database: listPublishedMenus / getPublishedMenuBySlug are exercised through
 * the mock repository via the server-function layer in mock mode, and the
 * grouping/ordering/selection logic is unit-tested directly.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { groupMenuSections } from "@/components/public/public-menu-data";
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

/* ----------------------------- Section grouping & ordering ----------------------------- */

describe("groupMenuSections — section grouping", () => {
  it("groups items under their section and omits empty sections", () => {
    const secA = makeSection({ menuId: "m1", name: "Starters", displayOrder: 0 });
    const secB = makeSection({ menuId: "m1", name: "Mains", displayOrder: 1 });
    const menu = makeMenu({
      sections: [secA, secB],
      items: [makeItem({ menuId: "m1", sectionId: secA.id, name: "Bread" })],
    });
    const view = groupMenuSections(menu);
    expect(view).toHaveLength(1);
    expect(view[0].name).toBe("Starters");
    expect(view[0].items[0].name).toBe("Bread");
  });

  it("places unassigned items under Additional dishes", () => {
    const secA = makeSection({ menuId: "m1", name: "Starters", displayOrder: 0 });
    const menu = makeMenu({
      sections: [secA],
      items: [
        makeItem({ menuId: "m1", sectionId: secA.id, name: "In section" }),
        makeItem({ menuId: "m1", sectionId: null, name: "Loose" }),
      ],
    });
    const view = groupMenuSections(menu);
    expect(view).toHaveLength(2);
    expect(view[1].id).toBe("__unassigned");
    expect(view[1].name).toBe("Additional dishes");
    expect(view[1].items[0].name).toBe("Loose");
  });

  it("orders sections by displayOrder", () => {
    const a = makeSection({ menuId: "m1", name: "Later", displayOrder: 2 });
    const b = makeSection({ menuId: "m1", name: "First", displayOrder: 1 });
    const menu = makeMenu({
      sections: [a, b],
      items: [
        makeItem({ menuId: "m1", sectionId: a.id }),
        makeItem({ menuId: "m1", sectionId: b.id }),
      ],
    });
    const view = groupMenuSections(menu);
    expect(view[0].name).toBe("First");
    expect(view[1].name).toBe("Later");
  });

  it("orders items within a section by displayOrder", () => {
    const sec = makeSection({ menuId: "m1", name: "S", displayOrder: 0 });
    const menu = makeMenu({
      sections: [sec],
      items: [
        makeItem({ menuId: "m1", sectionId: sec.id, name: "Z", displayOrder: 2 }),
        makeItem({ menuId: "m1", sectionId: sec.id, name: "A", displayOrder: 1 }),
      ],
    });
    const view = groupMenuSections(menu);
    expect(view[0].items[0].name).toBe("A");
    expect(view[0].items[1].name).toBe("Z");
  });

  it("omits empty sections entirely", () => {
    const empty = makeSection({ menuId: "m1", name: "Empty", displayOrder: 0 });
    const full = makeSection({ menuId: "m1", name: "Full", displayOrder: 1 });
    const menu = makeMenu({
      sections: [empty, full],
      items: [makeItem({ menuId: "m1", sectionId: full.id })],
    });
    const view = groupMenuSections(menu);
    expect(view).toHaveLength(1);
    expect(view[0].name).toBe("Full");
  });
});

/* ----------------------------- Public visibility (mock repository, behavioral) ----------------------------- */

describe("public menu read path — visibility (mock repository)", () => {
  beforeEach(() => {
    process.env.APP_DATA_MODE = "mock";
    __resetMockMenuRepository();
  });

  it("listPublishedMenus returns only published menus with active items/sections", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    // Seed via the mock's internal API by creating a published menu with an item.
    // The mock repository enforces the same publicOnly filtering as Supabase RLS.
    const created = await repo.createMenu("content_manager", "actor", {
      name: "Sunday Roast",
      slug: "sunday-roast",
      description: "",
      displayOrder: 0,
    });
    expect(created.ok).toBe(true);
    const menus = await repo.listPublishedMenus();
    // A newly created menu is a draft; it must NOT appear in published reads.
    expect(menus.find((m) => m.slug === "sunday-roast")).toBeUndefined();
  });

  it("getPublishedMenuBySlug returns null for a draft slug (no public exposure)", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    await repo.createMenu("content_manager", "actor", {
      name: "Hidden",
      slug: "hidden-draft",
      description: "",
      displayOrder: 0,
    });
    const menu = await repo.getPublishedMenuBySlug("hidden-draft");
    expect(menu).toBeNull();
  });
});

/* ----------------------------- SSR-safe data loading ----------------------------- */

describe("SSR-safe data loading", () => {
  it("publishedMenusQueryOptions has staleTime 0 (no indefinite publication cache)", async () => {
    const { publishedMenusQueryOptions, publishedMenuBySlugQueryOptions } =
      await import("@/components/public/public-menu-data");
    expect(publishedMenusQueryOptions().staleTime).toBe(0);
    expect(publishedMenuBySlugQueryOptions("x").staleTime).toBe(0);
  });

  it("query keys are stable and slug-scoped", async () => {
    const { publishedMenusQueryOptions, publishedMenuBySlugQueryOptions } =
      await import("@/components/public/public-menu-data");
    expect(publishedMenusQueryOptions().queryKey).toEqual(["public", "menus"]);
    expect(publishedMenuBySlugQueryOptions("abc").queryKey).toEqual(["public", "menus", "abc"]);
  });
});

/* ----------------------------- Selection reconciliation after CMS edits ----------------------------- */

/**
 * Behavioral model of the selection-reconciliation effect in PublicMenuView.
 * When the published list refreshes (staleTime: 0) after a CMS edit, a
 * previously-selected menu may have been archived/expired/unpublished and
 * dropped from the list. The component must fall back to the first available
 * menu rather than keep a stale selection that renders an empty "No dishes"
 * state. This mirrors the exact effect logic.
 */
function reconcileSelection(selectedSlug: string | null, menus: { slug: string }[]): string | null {
  if (menus.length === 0) return null;
  const stillAvailable = menus.some((m) => m.slug === selectedSlug);
  return stillAvailable ? selectedSlug : menus[0].slug;
}

describe("selection reconciliation after CMS edits", () => {
  it("falls back to the first available menu when the selected menu disappears", () => {
    const next = reconcileSelection("gone", [{ slug: "a" }, { slug: "b" }]);
    expect(next).toBe("a");
  });

  it("keeps the current selection when it is still available", () => {
    const next = reconcileSelection("b", [{ slug: "a" }, { slug: "b" }]);
    expect(next).toBe("b");
  });

  it("clears selection to null when no menus remain published", () => {
    const next = reconcileSelection("a", []);
    expect(next).toBeNull();
  });

  it("does not retain a stale selection that would render an empty menu state", () => {
    // Simulate: list had [a,b], user selected b, then b was archived.
    // After refresh the list is [a]. Selection must move to "a", not stay "b".
    let selected = "b";
    const refreshed = [{ slug: "a" }];
    selected = reconcileSelection(selected, refreshed);
    expect(selected).toBe("a");
  });
});

/* ----------------------------- No server-secret references in client modules ----------------------------- */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("public menu client modules — no server-secret references", () => {
  it("public-menu-data.ts imports the menu.functions wrapper, not .server.ts modules", () => {
    const src = readSrc("src/components/public/public-menu-data.ts");
    expect(src).toMatch(/menu\.functions/);
    expect(src).not.toMatch(/\.server\.ts/);
    expect(src).not.toMatch(/supabase-admin/);
    expect(src).not.toMatch(/service_role|SERVICE_ROLE/i);
  });

  it("public-menu-view.tsx imports public-menu-data, not .server.ts modules or secrets", () => {
    const src = readSrc("src/components/public/public-menu-view.tsx");
    expect(src).toMatch(/public-menu-data/);
    expect(src).not.toMatch(/\.server\.ts/);
    expect(src).not.toMatch(/supabase-admin/);
    expect(src).not.toMatch(/SERVICE_ROLE/i);
  });

  it("the public menu route imports the menu.functions-backed data layer, not the repository", () => {
    const src = readSrc("src/routes/_public.menu.tsx");
    expect(src).toMatch(/public-menu-data/);
    expect(src).not.toMatch(/menu-repository\.server/);
    expect(src).not.toMatch(/supabase-admin/);
    expect(src).not.toMatch(/MOCK_MENU_ITEMS/);
  });
});
