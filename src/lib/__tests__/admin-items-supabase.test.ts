/**
 * Admin Menu Items — Supabase repository path with a MOCKED database client.
 *
 * The mock repository (admin-items.test.ts) cannot catch defects that exist
 * only in the Supabase repository implementation, so these tests exercise
 * SupabaseMenuRepository.createItem directly against a fake admin client and
 * verify the inactive-section / cross-menu / missing-section checks match the
 * mock behavior.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the service-role admin client so no live database or env is needed.
vi.mock("@/lib/server/supabase-admin.server", () => ({
  getAdminClient: vi.fn(),
}));

import { getAdminClient } from "@/lib/server/supabase-admin.server";
import { SupabaseMenuRepository } from "@/lib/server/menu-supabase.server";

const newId = (): string => crypto.randomUUID();

interface TableMock {
  /** Row returned by .maybeSingle(), or null. */
  maybeSingle?: unknown;
  /** Error returned by .insert(), or null. */
  insertError?: unknown;
}

/**
 * Build a fake admin client whose per-table chains return canned responses.
 * select/eq/in/order are chainable; maybeSingle() and insert() are async.
 */
function makeClient(tables: Record<string, TableMock>) {
  return {
    from(table: string) {
      const t = tables[table] ?? {};
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: t.maybeSingle ?? null, error: null })),
        insert: vi.fn(async () => ({ data: null, error: t.insertError ?? null })),
        update: vi.fn().mockReturnThis(),
      };
    },
  };
}

function setClient(tables: Record<string, TableMock>): void {
  vi.mocked(getAdminClient).mockReturnValue(
    makeClient(tables) as unknown as ReturnType<typeof getAdminClient>,
  );
}

beforeEach(() => {
  vi.mocked(getAdminClient).mockReset();
});

describe("SupabaseMenuRepository.createItem — section checks (mocked DB)", () => {
  it("rejects assigning an item to an inactive section", async () => {
    const menuId = newId();
    const inactiveSectionId = newId();
    setClient({
      menus: { maybeSingle: { id: menuId } },
      menu_sections: {
        maybeSingle: { id: inactiveSectionId, menu_id: menuId, is_active: false },
      },
      menu_items: {},
    });
    const repo = new SupabaseMenuRepository();
    const res = await repo.createItem("administrator", "actor-1", {
      menuId,
      sectionId: inactiveSectionId,
      name: "X",
      priceCents: 1000,
      category: "main",
    });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/inactive/i);
  });

  it("preserves the same-menu check (cross-menu section rejected)", async () => {
    const menuId = newId();
    const otherMenuId = newId();
    const otherSectionId = newId();
    setClient({
      menus: { maybeSingle: { id: menuId } },
      menu_sections: {
        maybeSingle: { id: otherSectionId, menu_id: otherMenuId, is_active: true },
      },
      menu_items: {},
    });
    const repo = new SupabaseMenuRepository();
    const res = await repo.createItem("administrator", "actor-1", {
      menuId,
      sectionId: otherSectionId,
      name: "X",
      priceCents: 1000,
      category: "main",
    });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/section/i);
    expect(res.message).not.toMatch(/inactive/i);
  });

  it("preserves the missing-section check", async () => {
    const menuId = newId();
    const missingSectionId = newId();
    setClient({
      menus: { maybeSingle: { id: menuId } },
      menu_sections: { maybeSingle: null },
      menu_items: {},
    });
    const repo = new SupabaseMenuRepository();
    const res = await repo.createItem("administrator", "actor-1", {
      menuId,
      sectionId: missingSectionId,
      name: "X",
      priceCents: 1000,
      category: "main",
    });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/section/i);
  });

  it("creates an item when the section is active and same-menu", async () => {
    const menuId = newId();
    const sectionId = newId();
    setClient({
      menus: { maybeSingle: { id: menuId } },
      menu_sections: {
        maybeSingle: { id: sectionId, menu_id: menuId, is_active: true },
      },
      menu_items: {},
    });
    const repo = new SupabaseMenuRepository();
    const res = await repo.createItem("administrator", "actor-1", {
      menuId,
      sectionId,
      name: "X",
      priceCents: 1000,
      category: "main",
    });
    expect(res.ok).toBe(true);
  });

  it("creates an unassigned item (sectionId null) without a section lookup", async () => {
    const menuId = newId();
    setClient({
      menus: { maybeSingle: { id: menuId } },
      menu_items: {},
    });
    const repo = new SupabaseMenuRepository();
    const res = await repo.createItem("administrator", "actor-1", {
      menuId,
      sectionId: null,
      name: "Standalone",
      priceCents: 1200,
      category: "side",
    });
    expect(res.ok).toBe(true);
  });

  it("rejects an unauthorized role before touching the database", async () => {
    const menuId = newId();
    // No client configured — if the repo called the DB for a guest it would
    // throw; the role guard must short-circuit instead.
    const repo = new SupabaseMenuRepository();
    const res = await repo.createItem("guest", null, {
      menuId,
      name: "X",
      priceCents: 1000,
      category: "main",
    });
    expect(res.ok).toBe(false);
  });
});
