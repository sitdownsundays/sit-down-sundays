import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetMockMenuRepository,
  __getMockMenuRepositoryForSeed,
  getMenuRepository,
} from "@/lib/server/menu-repository.server";
import { PublishedMenuEmptyError } from "@/lib/server/menu-mock.server";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase",
  "migrations",
  "0004_menu_cms_atomic_operations.sql",
);

function sql(): string {
  return readFileSync(MIGRATION_PATH, "utf-8");
}

function newId(): string {
  return crypto.randomUUID();
}

const BASE_TIME = "2025-09-01T10:00:00Z";

function seedPublishedMenuWithOneItem() {
  const repo = __getMockMenuRepositoryForSeed();
  const menuId = newId();
  const itemId = newId();
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
        name: "Only Item",
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
  return { menuId, itemId };
}

function seedPublishedMenuWithOneSectionedItem() {
  const repo = __getMockMenuRepositoryForSeed();
  const menuId = newId();
  const sectionId = newId();
  const itemId = newId();
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
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      },
    ],
    [
      {
        id: sectionId,
        menuId,
        name: "Only Section",
        description: "",
        displayOrder: 0,
        isActive: true,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      },
    ],
    [
      {
        id: itemId,
        menuId,
        sectionId,
        name: "Sectioned Item",
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
  return { menuId, sectionId, itemId };
}

function seedTwoMenus() {
  const repo = __getMockMenuRepositoryForSeed();
  const menuA = newId();
  const menuB = newId();
  const itemA = newId();
  repo.__seed(
    [
      {
        id: menuA,
        name: "A",
        slug: "a",
        description: "",
        status: "published",
        displayOrder: 0,
        publishAt: null,
        unpublishAt: null,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      },
      {
        id: menuB,
        name: "B",
        slug: "b",
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
        id: itemA,
        menuId: menuA,
        sectionId: null,
        name: "Item A",
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
  return { menuA, menuB, itemA };
}

beforeEach(() => {
  process.env.APP_DATA_MODE = "mock";
  __resetMockMenuRepository();
});

/* --------------------- Published-menu invariant (mock) --------------------- */

describe("0004 — published-menu invariant", () => {
  it("a last eligible item cannot be deactivated after a menu is published", async () => {
    const { itemId } = seedPublishedMenuWithOneItem();
    const repo = getMenuRepository();
    const r = await repo.setItemActive("administrator", "actor-1", itemId, false);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no active items/i);
    // Item remains active (rolled back).
    const mock = __getMockMenuRepositoryForSeed();
    expect(mock.items.find((i) => i.id === itemId)!.isActive).toBe(true);
  });

  it("an active section containing the last eligible items cannot be deactivated", async () => {
    const { sectionId } = seedPublishedMenuWithOneSectionedItem();
    const repo = getMenuRepository();
    const r = await repo.setSectionActive("administrator", "actor-1", sectionId, false);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no active items/i);
    const mock = __getMockMenuRepositoryForSeed();
    expect(mock.sections.find((s) => s.id === sectionId)!.isActive).toBe(true);
  });

  it("a replacement item activated within the same transaction allows the final valid state", async () => {
    const { menuId, itemId } = seedPublishedMenuWithOneItem();
    const mock = __getMockMenuRepositoryForSeed();
    const repo = getMenuRepository();
    // Deactivate the last item AND add a replacement in one transaction.
    await mock.transaction(async (r) => {
      await r.setItemActive("administrator", "actor-1", itemId, false);
      await r.createItem("administrator", "actor-1", {
        menuId,
        name: "Replacement",
        priceCents: 1200,
        category: "main",
        isActive: true,
      });
    });
    // Final state is valid: the replacement keeps the published menu non-empty.
    expect(mock.items.find((i) => i.id === itemId)!.isActive).toBe(false);
    expect(mock.items.some((i) => i.name === "Replacement" && i.isActive)).toBe(true);
  });

  it("moving the last eligible item to another menu is rejected", async () => {
    const { menuB, itemA } = seedTwoMenus();
    const repo = getMenuRepository();
    const r = await repo.updateItem(
      "administrator",
      "actor-1",
      itemA,
      {
        menuId: menuB,
      },
      BASE_TIME,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no active items/i);
    // Item remains on its original menu (rolled back).
    const mock = __getMockMenuRepositoryForSeed();
    expect(mock.items.find((i) => i.id === itemA)!.menuId).not.toBe(menuB);
  });

  it("audit rows roll back with a rejected mutation", async () => {
    const { itemId } = seedPublishedMenuWithOneItem();
    const repo = getMenuRepository();
    const before = __getMockMenuRepositoryForSeed().auditLogs.length;
    await repo.setItemActive("administrator", "actor-1", itemId, false);
    const after = __getMockMenuRepositoryForSeed().auditLogs.length;
    // No new audit row for the rejected deactivation.
    expect(after).toBe(before);
  });

  it("a transaction that would leave a published menu empty rolls back", async () => {
    const { itemId } = seedPublishedMenuWithOneItem();
    const mock = __getMockMenuRepositoryForSeed();
    const repo = getMenuRepository();
    await expect(
      mock.transaction(async (r) => {
        await r.setItemActive("administrator", "actor-1", itemId, false);
      }),
    ).rejects.toBeInstanceOf(PublishedMenuEmptyError);
    // Rolled back: item still active.
    expect(mock.items.find((i) => i.id === itemId)!.isActive).toBe(true);
  });
});

/* --------------------- Reorder locking (SQL structure) --------------------- */

describe("0004 — reorder RPC menu-row locking", () => {
  function fnBody(name: string): string {
    const s = sql();
    const start = s.indexOf(`create or replace function public.${name}`);
    const end = s.indexOf("revoke execute on function public." + name);
    return s.slice(start, end);
  }

  it("reorder_menu_sections_atomic locks the menu before any count or membership validation", () => {
    const body = fnBody("reorder_menu_sections_atomic");
    const lockIdx = body.indexOf("for update");
    const countIdx = body.indexOf("count(*)");
    const membershipIdx = body.indexOf("id = any(");
    expect(lockIdx).toBeGreaterThan(-1);
    expect(countIdx).toBeGreaterThan(lockIdx);
    expect(membershipIdx).toBeGreaterThan(lockIdx);
  });

  it("reorder_menu_items_atomic locks the menu before any count or membership validation", () => {
    const body = fnBody("reorder_menu_items_atomic");
    const lockIdx = body.indexOf("for update");
    const countIdx = body.indexOf("count(*)");
    const membershipIdx = body.indexOf("id = any(");
    expect(lockIdx).toBeGreaterThan(-1);
    expect(countIdx).toBeGreaterThan(lockIdx);
    expect(membershipIdx).toBeGreaterThan(lockIdx);
  });

  it("both reorder RPCs return Menu not found when the menu is absent", () => {
    expect(fnBody("reorder_menu_sections_atomic")).toMatch(/Menu not found/i);
    expect(fnBody("reorder_menu_items_atomic")).toMatch(/Menu not found/i);
  });

  it("concurrent inserts are serialized by the parent-menu lock trigger", () => {
    const s = sql();
    // The parent-menu lock trigger takes FOR UPDATE on menu_sections/menu_items
    // mutations, serializing them against the reorder RPC's menu-row lock.
    expect(s).toMatch(/trg_lock_menu_sections_parent/i);
    expect(s).toMatch(/trg_lock_menu_items_parent/i);
    expect(s).toMatch(/before insert or update or delete on public\.menu_sections/i);
    expect(s).toMatch(/before insert or update or delete on public\.menu_items/i);
  });
});

/* --------------------- Archived→published protection (SQL) --------------------- */

describe("0004 — archived→published database protection", () => {
  it("creates ensure_menu_publish_valid", () => {
    expect(sql()).toMatch(/create or replace function public\.ensure_menu_publish_valid\(\)/i);
  });

  it("rejects archived→any-other-status transitions at the database level", () => {
    const s = sql();
    const start = s.indexOf("create or replace function public.ensure_menu_publish_valid");
    const end = s.indexOf("drop trigger if exists trg_menus_publish_valid");
    const fn = s.slice(start, end);
    // Permanent archive protection: blocks archived→draft AND archived→published.
    expect(fn).toMatch(/old\.status = 'archived' and new\.status <> 'archived'/i);
    expect(fn).toMatch(/cannot transition to any other status/i);
    // The narrower archived→published-only check must no longer be present.
    expect(fn).not.toMatch(/old\.status = 'archived' and new\.status = 'published'/i);
  });

  it("publishing requires at least one eligible active item", () => {
    const s = sql();
    const start = s.indexOf("create or replace function public.ensure_menu_publish_valid");
    const end = s.indexOf("drop trigger if exists trg_menus_publish_valid");
    const fn = s.slice(start, end);
    expect(fn).toMatch(/new\.status = 'published'/i);
    expect(fn).toMatch(/needs at least one active item/i);
  });

  it("installs the menus publish-valid trigger as BEFORE INSERT OR UPDATE", () => {
    expect(sql()).toMatch(/before insert or update on public\.menus/i);
  });

  it("an archived menu cannot transition to draft through updateMenu", async () => {
    // updateMenu cannot set status at all (status removed from the patch
    // schema during Phase 3A2 hardening), so an archived menu stays archived.
    const { menuId } = seedPublishedMenuWithOneItem();
    const mock = __getMockMenuRepositoryForSeed();
    // Force the menu to archived for this scenario.
    mock.menus.find((m) => m.id === menuId)!.status = "archived";
    const repo = getMenuRepository();
    const r = await repo.updateMenu(
      "administrator",
      "actor-1",
      menuId,
      { name: "Renamed" },
      BASE_TIME,
    );
    expect(r.ok).toBe(true);
    // Status remains archived; updateMenu cannot revive it.
    expect(mock.menus.find((m) => m.id === menuId)!.status).toBe("archived");
  });

  it("an archived menu cannot be republished through publishMenu", async () => {
    const { menuId } = seedPublishedMenuWithOneItem();
    const mock = __getMockMenuRepositoryForSeed();
    mock.menus.find((m) => m.id === menuId)!.status = "archived";
    const repo = getMenuRepository();
    const r = await repo.publishMenu("administrator", "actor-1", menuId);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/archived/i);
  });
});

/* --------------------- Deferred constraint triggers (SQL) --------------------- */

describe("0004 — deferred published-menu invariant", () => {
  it("creates ensure_published_menu_has_eligible_item", () => {
    expect(sql()).toMatch(
      /create or replace function public\.ensure_published_menu_has_eligible_item\(\)/i,
    );
  });

  it("installs DEFERRABLE INITIALLY DEFERRED constraint triggers on both tables", () => {
    const s = sql();
    expect(s).toMatch(
      /create constraint trigger trg_menu_items_published_invariant[\s\S]*?deferrable initially deferred/i,
    );
    expect(s).toMatch(
      /create constraint trigger trg_menu_sections_published_invariant[\s\S]*?deferrable initially deferred/i,
    );
  });

  it("checks final eligible-item count for affected old and new menu_ids", () => {
    const s = sql();
    const start = s.indexOf(
      "create or replace function public.ensure_published_menu_has_eligible_item",
    );
    const end = s.indexOf("-- Constraint triggers (DEFERRABLE");
    const fn = s.slice(start, end);
    expect(fn).toMatch(/old\.menu_id/i);
    expect(fn).toMatch(/new\.menu_id/i);
    expect(fn).toMatch(/status = 'published'/i);
    expect(fn).toMatch(/must retain at least one active item/i);
  });
});

/* --------------------- Helper privileges (SQL) --------------------- */

describe("0004 — invariant helper privileges", () => {
  it("revokes EXECUTE on invariant helpers from browser roles", () => {
    const s = sql();
    expect(s).toMatch(
      /revoke execute on function public\.ensure_published_menu_has_eligible_item\(\)\s+from public, anon, authenticated/i,
    );
    expect(s).toMatch(
      /revoke execute on function public\.ensure_menu_publish_valid\(\)\s+from public, anon, authenticated/i,
    );
  });

  it("invariant helpers use a fixed safe search_path", () => {
    const s = sql();
    const fns = ["ensure_published_menu_has_eligible_item", "ensure_menu_publish_valid"];
    for (const name of fns) {
      const start = s.indexOf(`create or replace function public.${name}`);
      const end = s.indexOf("$$;", start);
      const fn = s.slice(start, end);
      expect(fn, `${name} must set search_path`).toMatch(/set search_path = public, pg_temp/i);
    }
  });
});
