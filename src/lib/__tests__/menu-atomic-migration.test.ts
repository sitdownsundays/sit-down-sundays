import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetMockMenuRepository,
  __getMockMenuRepositoryForSeed,
  getMenuRepository,
} from "@/lib/server/menu-repository.server";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase",
  "migrations",
  "0004_menu_cms_atomic_operations.sql",
);

function sql(): string {
  return readFileSync(MIGRATION_PATH, "utf-8");
}

/** SQL with `--` comment lines stripped, for structural/security assertions. */
function sqlCode(): string {
  return sql()
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function newId(): string {
  return crypto.randomUUID();
}

function seedMenuWithItems(status: "draft" | "published" | "archived" = "draft") {
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
        status,
        displayOrder: 0,
        publishAt: null,
        unpublishAt: null,
        createdAt: "2025-09-01T10:00:00Z",
        updatedAt: "2025-09-01T10:00:00Z",
      },
    ],
    [],
    [
      {
        id: itemId,
        menuId,
        sectionId: null,
        name: "Active Item",
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
        createdAt: "2025-09-01T10:00:00Z",
        updatedAt: "2025-09-01T10:00:00Z",
      },
    ],
  );
  return { menuId, itemId };
}

beforeEach(() => {
  process.env.APP_DATA_MODE = "mock";
  __resetMockMenuRepository();
});

/* ----------------------------- SQL structure ----------------------------- */

describe("0004 — structure", () => {
  it("creates the parent-menu lock trigger function", () => {
    const s = sql();
    expect(s).toMatch(/create or replace function public\.lock_parent_menu\(\)/i);
  });

  it("installs the parent-menu lock trigger on menu_sections and menu_items", () => {
    const s = sql();
    expect(s).toMatch(/trg_lock_menu_sections_parent/i);
    expect(s).toMatch(/before insert or update or delete on public\.menu_sections/i);
    expect(s).toMatch(/trg_lock_menu_items_parent/i);
    expect(s).toMatch(/before insert or update or delete on public\.menu_items/i);
  });

  it("creates the actor validation helper", () => {
    const s = sql();
    expect(s).toMatch(/create or replace function public\.validate_cms_actor\b/i);
  });

  it("creates all three atomic RPCs", () => {
    const s = sql();
    expect(s).toMatch(/publish_menu_atomic/i);
    expect(s).toMatch(/reorder_menu_sections_atomic/i);
    expect(s).toMatch(/reorder_menu_items_atomic/i);
  });

  it("creates the audit trigger function and triggers", () => {
    const s = sql();
    expect(s).toMatch(/create or replace function public\.audit_cms_change\(\)/i);
    expect(s).toMatch(/trg_menus_audit/i);
    expect(s).toMatch(/trg_menu_sections_audit/i);
    expect(s).toMatch(/trg_menu_items_audit/i);
  });
});

/* ----------------------------- FOR UPDATE lock ----------------------------- */

describe("0004 — publish_menu_atomic FOR UPDATE lock", () => {
  it("publish_menu_atomic contains a real FOR UPDATE lock on the menu row", () => {
    const s = sql();
    const start = s.indexOf("create or replace function public.publish_menu_atomic");
    const end = s.indexOf("revoke execute on function public.publish_menu_atomic");
    const fn = s.slice(start, end);
    expect(fn).toMatch(/from public\.menus where id = p_menu_id for update/i);
  });

  it("lock_parent_menu uses FOR UPDATE", () => {
    const s = sql();
    const start = s.indexOf("create or replace function public.lock_parent_menu");
    const end = s.indexOf("-- Install the parent-menu lock trigger");
    const fn = s.slice(start, end);
    expect(fn).toMatch(/for update/i);
  });

  it("locks both old and new menu IDs in deterministic order on UPDATE", () => {
    const s = sql();
    const start = s.indexOf("create or replace function public.lock_parent_menu");
    const end = s.indexOf("-- Install the parent-menu lock trigger");
    const fn = s.slice(start, end);
    expect(fn).toMatch(/v_old_menu < v_new_menu/i);
    expect(fn).toMatch(/v_lo := v_old_menu; v_hi := v_new_menu/i);
  });
});

/* ----------------------------- Archived menus ----------------------------- */

describe("0004 — archived menus cannot be republished", () => {
  it("SQL rejects archived menus in publish_menu_atomic", () => {
    const s = sql();
    const start = s.indexOf("create or replace function public.publish_menu_atomic");
    const end = s.indexOf("revoke execute on function public.publish_menu_atomic");
    const fn = s.slice(start, end);
    expect(fn).toMatch(/v_menu\.status = 'archived'/i);
    expect(fn).toMatch(/archived menu cannot be published again/i);
  });

  it("mock repository rejects publishing an archived menu", async () => {
    const { menuId } = seedMenuWithItems("archived");
    const r = await getMenuRepository().publishMenu("administrator", "actor-1", menuId);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/archived/i);
  });

  it("mock repository allows publishing a draft menu with an active item", async () => {
    const { menuId } = seedMenuWithItems("draft");
    const r = await getMenuRepository().publishMenu("administrator", "actor-1", menuId);
    expect(r.ok).toBe(true);
  });
});

/* ----------------------------- Actor validation ----------------------------- */

describe("0004 — actor validation", () => {
  it("all three RPCs call validate_cms_actor before any mutation", () => {
    const s = sql();
    for (const fn of [
      "publish_menu_atomic",
      "reorder_menu_sections_atomic",
      "reorder_menu_items_atomic",
    ]) {
      const start = s.indexOf(`create or replace function public.${fn}`);
      const end = s.indexOf("revoke execute on function public." + fn);
      const body = s.slice(start, end);
      expect(body, `${fn} must validate actor`).toMatch(/validate_cms_actor/i);
      // validate_cms_actor is called before any UPDATE.
      const validateIdx = body.indexOf("validate_cms_actor");
      const updateIdx = body.indexOf("update public.");
      expect(updateIdx).toBeGreaterThan(validateIdx);
    }
  });

  it("validate_cms_actor rejects null", () => {
    const s = sql();
    const start = s.indexOf("create or replace function public.validate_cms_actor");
    const end = s.indexOf("revoke execute on function public.validate_cms_actor");
    const fn = s.slice(start, end);
    expect(fn).toMatch(/p_actor is null/i);
  });

  it("validate_cms_actor requires a matching auth.users row", () => {
    const s = sql();
    const start = s.indexOf("create or replace function public.validate_cms_actor");
    const end = s.indexOf("revoke execute on function public.validate_cms_actor");
    const fn = s.slice(start, end);
    expect(fn).toMatch(/from auth\.users where id = p_actor/i);
  });

  it("mock repository rejects a null actor for publish", async () => {
    const { menuId } = seedMenuWithItems("draft");
    const r = await getMenuRepository().publishMenu("administrator", null, menuId);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/actor/i);
  });

  it("mock repository rejects a null actor for reorder", async () => {
    const { menuId, itemId } = seedMenuWithItems("draft");
    const r = await getMenuRepository().reorderItems("administrator", null, menuId, [itemId]);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/actor/i);
  });
});

/* ----------------------------- Complete reorder ----------------------------- */

describe("0004 — complete-list reordering", () => {
  it("SQL documents complete-list reorder operations", () => {
    const s = sql();
    expect(s).toMatch(/COMPLETE-LIST reorder/i);
    expect(s).toMatch(/EVERY existing section/i);
  });

  it("SQL requires supplied count to match existing count", () => {
    const s = sql();
    expect(s).toMatch(/v_existing <> v_array_len/i);
    expect(s).toMatch(/Reorder list must include every section/i);
    expect(s).toMatch(/Reorder list must include every item/i);
  });

  it("mock partial reorder list fails without changing order", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = newId();
    const s1 = newId();
    const s2 = newId();
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
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
      ],
      [
        {
          id: s1,
          menuId,
          name: "S1",
          description: "",
          displayOrder: 0,
          isActive: true,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
        {
          id: s2,
          menuId,
          name: "S2",
          description: "",
          displayOrder: 1,
          isActive: true,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
      ],
      [],
    );
    // Partial list (only one of two sections) must fail.
    const r = await getMenuRepository().reorderSections("administrator", "actor-1", menuId, [s1]);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/every section/i);
    // Orders unchanged.
    expect(repo.sections.find((x) => x.id === s1)!.displayOrder).toBe(0);
    expect(repo.sections.find((x) => x.id === s2)!.displayOrder).toBe(1);
  });

  it("mock complete reorder list succeeds", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = newId();
    const s1 = newId();
    const s2 = newId();
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
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
      ],
      [
        {
          id: s1,
          menuId,
          name: "S1",
          description: "",
          displayOrder: 0,
          isActive: true,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
        {
          id: s2,
          menuId,
          name: "S2",
          description: "",
          displayOrder: 1,
          isActive: true,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
      ],
      [],
    );
    const r = await getMenuRepository().reorderSections("administrator", "actor-1", menuId, [
      s2,
      s1,
    ]);
    expect(r.ok).toBe(true);
    expect(repo.sections.find((x) => x.id === s2)!.displayOrder).toBe(0);
    expect(repo.sections.find((x) => x.id === s1)!.displayOrder).toBe(1);
  });

  it("mock duplicate reorder IDs fail without changing order", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = newId();
    const s1 = newId();
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
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
      ],
      [
        {
          id: s1,
          menuId,
          name: "S1",
          description: "",
          displayOrder: 0,
          isActive: true,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
      ],
      [],
    );
    const r = await getMenuRepository().reorderSections("administrator", "actor-1", menuId, [
      s1,
      s1,
    ]);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/duplicate/i);
  });

  it("mock cross-menu reorder IDs fail", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuA = newId();
    const menuB = newId();
    const sA = newId();
    const sB = newId();
    repo.__seed(
      [
        {
          id: menuA,
          name: "A",
          slug: "a",
          description: "",
          status: "draft",
          displayOrder: 0,
          publishAt: null,
          unpublishAt: null,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
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
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
      ],
      [
        {
          id: sA,
          menuId: menuA,
          name: "SA",
          description: "",
          displayOrder: 0,
          isActive: true,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
        {
          id: sB,
          menuId: menuB,
          name: "SB",
          description: "",
          displayOrder: 0,
          isActive: true,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
      ],
      [],
    );
    // Supplying menuB's section while reordering menuA: counts match (1) but
    // the ID does not belong to menuA.
    const r = await getMenuRepository().reorderSections("administrator", "actor-1", menuA, [sB]);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/do not belong/i);
  });
});

/* ----------------------------- Execution privileges ----------------------------- */

describe("0004 — service-role-only execution", () => {
  it("revokes EXECUTE on all RPCs from PUBLIC, anon, authenticated", () => {
    const s = sql();
    expect(s).toMatch(
      /revoke execute on function public\.publish_menu_atomic\(uuid, uuid\)\s+from public, anon, authenticated/i,
    );
    expect(s).toMatch(
      /revoke execute on function public\.reorder_menu_sections_atomic\(uuid, uuid\[\], uuid\)\s+from public, anon, authenticated/i,
    );
    expect(s).toMatch(
      /revoke execute on function public\.reorder_menu_items_atomic\(uuid, uuid\[\], uuid\)\s+from public, anon, authenticated/i,
    );
  });

  it("grants EXECUTE on all RPCs only to service_role", () => {
    const s = sql();
    expect(s).toMatch(
      /grant execute on function public\.publish_menu_atomic\(uuid, uuid\)\s+to service_role/i,
    );
    expect(s).toMatch(
      /grant execute on function public\.reorder_menu_sections_atomic\(uuid, uuid\[\], uuid\)\s+to service_role/i,
    );
    expect(s).toMatch(
      /grant execute on function public\.reorder_menu_items_atomic\(uuid, uuid\[\], uuid\)\s+to service_role/i,
    );
  });

  it("revokes EXECUTE on trigger helper functions from browser roles", () => {
    const s = sql();
    expect(s).toMatch(
      /revoke execute on function public\.audit_cms_change\(\) from public, anon, authenticated/i,
    );
    expect(s).toMatch(
      /revoke execute on function public\.lock_parent_menu\(\) from public, anon, authenticated/i,
    );
  });

  it("documents that trigger execution is unaffected by EXECUTE revocation", () => {
    const s = sql();
    expect(s).toMatch(/Trigger execution[\s\S]*?is NOT affected by function EXECUTE privileges/i);
  });
});

/* ----------------------------- Atomicity & audit ----------------------------- */

describe("0004 — atomic audit logging", () => {
  it("audit triggers are AFTER INSERT OR UPDATE (same transaction)", () => {
    const s = sql();
    expect(s).toMatch(/after insert or update on public\.menus/i);
    expect(s).toMatch(/after insert or update on public\.menu_sections/i);
    expect(s).toMatch(/after insert or update on public\.menu_items/i);
  });

  it("audit_cms_change uses created_by for inserts and updated_by for updates", () => {
    const s = sql();
    const start = s.indexOf("create or replace function public.audit_cms_change");
    const end = s.indexOf("-- menus audit trigger");
    const fn = s.slice(start, end);
    expect(fn).toMatch(/v_actor {2}:= new\.created_by/i);
    expect(fn).toMatch(/v_actor {2}:= new\.updated_by/i);
  });

  it("audit_cms_change records only safe old/new row JSON", () => {
    const s = sql();
    const start = s.indexOf("create or replace function public.audit_cms_change");
    const end = s.indexOf("-- menus audit trigger");
    const fn = s.slice(start, end);
    expect(fn).toMatch(/to_jsonb\(new\)/i);
    expect(fn).toMatch(/to_jsonb\(old\)/i);
  });

  it("documents that audit failure rolls back the mutation", () => {
    const s = sql();
    expect(s).toMatch(/If the audit insert fails, the entire transaction[\s\S]*?rolls back/i);
  });

  it("mock mutation and audit creation succeed together", async () => {
    const r = await getMenuRepository().createMenu("administrator", "actor-1", {
      name: "M",
      slug: "m",
      description: "",
      status: "draft",
      displayOrder: 0,
    });
    expect(r.ok).toBe(true);
    const createAudit = __getMockMenuRepositoryForSeed().auditLogs.find(
      (a) => a.action === "menu.create",
    );
    expect(createAudit).toBeDefined();
  });

  it("mock produces no duplicate audit entries for a single mutation", async () => {
    await getMenuRepository().createMenu("administrator", "actor-1", {
      name: "M",
      slug: "m",
      description: "",
      status: "draft",
      displayOrder: 0,
    });
    const creates = __getMockMenuRepositoryForSeed().auditLogs.filter(
      (a) => a.action === "menu.create",
    );
    expect(creates).toHaveLength(1);
  });
});

/* ----------------------------- Safe search paths ----------------------------- */

describe("0004 — safe search paths", () => {
  it("all SECURITY DEFINER functions declare a fixed safe search_path", () => {
    const s = sql();
    const definerFns =
      s.match(/create or replace function[^;]*security definer[\s\S]*?\$\$;/gis) ?? [];
    expect(definerFns.length).toBeGreaterThanOrEqual(4);
    for (const fn of definerFns) {
      expect(fn).toMatch(/set search_path = public, pg_temp/i);
    }
  });

  it("does not use destructive operations", () => {
    const s = sqlCode();
    expect(s).not.toMatch(/\bdrop table\b/i);
    expect(s).not.toMatch(/\bdrop schema\b/i);
    expect(s).not.toMatch(/\btruncate\b/i);
  });
});
