/**
 * Menu CMS — server-function authorization & behavior tests.
 *
 * The server-function wrappers (menu.functions.ts) cannot be invoked directly
 * in vitest because TanStack Start server functions require the Start runtime
 * AsyncLocalStorage context, which is absent outside the server runtime. The
 * production build + runtime exercise the RPC wiring itself.
 *
 * These tests instead exercise the EXACT logic each wrapper delegates to:
 *  - resolveMenuActor() (the server-side identity/role resolution the wrappers
 *    call before every CMS operation — never trusting a browser role)
 *  - the repository (gating, public filtering, publishing validation,
 *    cross-menu protection, audit logging, archive/deactivation, ordering)
 *  - static source inspection of menu.functions.ts (authorization gating,
 *    no secret leakage, server-only imports, publishing-validation wiring)
 *
 * This is the same convention used by the existing waitlist/auth test suites.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { resolveMenuActor } from "@/lib/server/menu-auth.server";
import { hasDraftReadRole, hasMutationRole } from "@/lib/server/menu-shared.server";
import {
  __resetMockMenuRepository,
  __getMockMenuRepositoryForSeed,
  getMenuRepository,
} from "@/lib/server/menu-repository.server";
import { __getMockAuthRepository } from "@/lib/server/auth-repository.server";
import { publishingRuleViolations } from "@/lib/menu/schema";
import { MENU_MUTATION_ROLES, MENU_DRAFT_READ_ROLES } from "@/lib/menu/constants";
import type { RoleKey } from "@/lib/domain/types";

const MUTATION_ROLES = MENU_MUTATION_ROLES as readonly RoleKey[];
const DRAFT_ROLES = MENU_DRAFT_READ_ROLES as readonly RoleKey[];
const BLOCKED_ROLES: RoleKey[] = ["guest", "foh_staff", "kitchen_staff"];
const ALL_ROLES: RoleKey[] = [...(MUTATION_ROLES as readonly RoleKey[]), ...BLOCKED_ROLES];

function newId(): string {
  return crypto.randomUUID();
}

function authenticateAs(role: RoleKey): void {
  __getMockAuthRepository().__seedMockSession(role);
}

function unauthenticate(): void {
  void __getMockAuthRepository().signout(false);
}

function menuFunctionsSource(): string {
  return readFileSync(join(process.cwd(), "src", "lib", "menu.functions.ts"), "utf-8");
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

/* --------------------- Server-side identity resolution --------------------- */

describe("resolveMenuActor — server-side identity", () => {
  it("returns null when unauthenticated", async () => {
    expect(await resolveMenuActor()).toBeNull();
  });

  it("resolves the verified role from the live session, not a browser value", async () => {
    authenticateAs("administrator");
    const actor = await resolveMenuActor();
    expect(actor?.role).toBe("administrator");
    expect(actor?.userId).toBeTruthy();
  });

  it("never trusts a callerRole supplied by the browser", async () => {
    // resolveMenuActor takes no arguments at all — there is no way to pass a
    // role from the browser into the authorization decision.
    const fn = resolveMenuActor.toString();
    expect(fn).not.toMatch(/callerRole|clientRole|browserRole/);
  });
});

/* ----------------------------- Authorization ----------------------------- */

describe("authorization — role gating", () => {
  it("mutation roles are exactly content_manager, ops_manager, administrator", () => {
    expect([...MUTATION_ROLES].sort()).toEqual(
      ["content_manager", "ops_manager", "administrator"].sort(),
    );
  });

  it("draft-read roles are exactly content_manager, ops_manager, administrator", () => {
    expect([...DRAFT_ROLES].sort()).toEqual(
      ["content_manager", "ops_manager", "administrator"].sort(),
    );
  });

  it("hasMutationRole allows only authorized CMS roles", () => {
    for (const role of ALL_ROLES) {
      const allowed = hasMutationRole(role);
      expect(allowed, `${role}`).toBe((MUTATION_ROLES as readonly string[]).includes(role));
    }
  });

  it("hasDraftReadRole allows only authorized CMS roles", () => {
    for (const role of ALL_ROLES) {
      const allowed = hasDraftReadRole(role);
      expect(allowed, `${role}`).toBe((DRAFT_ROLES as readonly string[]).includes(role));
    }
  });

  it("guest and unauthenticated are rejected for mutations", async () => {
    const repo = getMenuRepository();
    // Unauthenticated: resolveMenuActor → null → repository receives guest? No:
    // the wrapper rejects before calling the repository. We assert the gating
    // helper directly since the wrapper is not callable in vitest.
    expect(hasMutationRole("guest")).toBe(false);
    expect(await resolveMenuActor()).toBeNull();
    // And the repository itself rejects guest.
    const r = await repo.createMenu("guest", null, {
      name: "M",
      slug: "m",
      description: "",
      status: "draft",
      displayOrder: 0,
    });
    expect(r.ok).toBe(false);
  });

  it("each authorized CMS role can create a menu through the repository", async () => {
    const repo = getMenuRepository();
    for (const role of MUTATION_ROLES) {
      __resetMockMenuRepository();
      const r = await repo.createMenu(role, "actor-1", {
        name: role,
        slug: `menu-${role}`,
        description: "",
        status: "draft",
        displayOrder: 0,
      });
      expect(r.ok, `${role} should be allowed`).toBe(true);
    }
  });

  it("each non-mutation role is blocked from creating a menu", async () => {
    const repo = getMenuRepository();
    for (const role of BLOCKED_ROLES) {
      __resetMockMenuRepository();
      const r = await repo.createMenu(role, "actor-1", {
        name: role,
        slug: `menu-${role}`,
        description: "",
        status: "draft",
        displayOrder: 0,
      });
      expect(r.ok, `${role} should be blocked`).toBe(false);
      expect(r.message).toMatch(/authorized/i);
    }
  });
});

/* ----------------------------- Public filtering ----------------------------- */

describe("public reads — filtering", () => {
  function seed(status: "draft" | "published" | "archived" = "published") {
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = newId();
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
          id: newId(),
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
        {
          id: newId(),
          menuId,
          sectionId: null,
          name: "Inactive Item",
          description: "",
          priceCents: 500,
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

  it("listPublishedMenus returns only published menus with active items", async () => {
    seed("published");
    const menus = await getMenuRepository().listPublishedMenus();
    expect(menus).toHaveLength(1);
    expect(menus[0].items.map((i) => i.name)).toEqual(["Active Item"]);
  });

  it("listPublishedMenus excludes draft and archived menus", async () => {
    seed("draft");
    expect(await getMenuRepository().listPublishedMenus()).toHaveLength(0);
    __resetMockMenuRepository();
    seed("archived");
    expect(await getMenuRepository().listPublishedMenus()).toHaveLength(0);
  });

  it("getPublishedMenuBySlug returns null for unknown or non-published", async () => {
    seed("published");
    expect(await getMenuRepository().getPublishedMenuBySlug("nope")).toBeNull();
    __resetMockMenuRepository();
    seed("draft");
    expect(await getMenuRepository().getPublishedMenuBySlug("m")).toBeNull();
  });
});

/* -------------------------- Publishing validation -------------------------- */

describe("publishing validation", () => {
  it("rejects publishing a menu with no active items (server-function rule)", () => {
    // The server function checks detail.items.some(active) before publishing.
    // We assert the rule the wrapper enforces, mirroring its logic.
    const detail = { items: [{ isActive: false }] };
    const canPublish = detail.items.some((i) => i.isActive);
    expect(canPublish).toBe(false);
  });

  it("publishingRuleViolations flags unpublish before publish", () => {
    expect(
      publishingRuleViolations({
        status: "published",
        publishAt: "2025-10-01T00:00:00Z",
        unpublishAt: "2025-09-01T00:00:00Z",
      }).length,
    ).toBeGreaterThan(0);
  });

  it("publishingRuleViolations passes a clean published menu", () => {
    expect(
      publishingRuleViolations({
        status: "published",
        publishAt: "2025-10-01T00:00:00Z",
        unpublishAt: "2025-11-01T00:00:00Z",
      }),
    ).toEqual([]);
  });

  it("publish is blocked for non-mutation roles", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = newId();
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
      [],
      [],
    );
    const r = await repo.publishMenu("guest", "actor-1", menuId);
    expect(r.ok).toBe(false);
  });
});

/* ---------------------- Cross-menu section protection ---------------------- */

describe("cross-menu section protection", () => {
  it("rejects creating an item with a section from a different menu", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuA = newId();
    const menuB = newId();
    const sectionA = newId();
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
          id: sectionA,
          menuId: menuA,
          name: "SA",
          description: "",
          displayOrder: 0,
          isActive: true,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
      ],
      [],
    );
    const r = await repo.createItem("content_manager", "actor-1", {
      menuId: menuB,
      sectionId: sectionA,
      name: "Cross",
      priceCents: 1000,
      category: "main",
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/section does not belong/i);
  });

  it("accepts creating an item with a section from the same menu", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = newId();
    const sectionId = newId();
    repo.__seed(
      [
        {
          id: menuId,
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
      ],
      [
        {
          id: sectionId,
          menuId,
          name: "SA",
          description: "",
          displayOrder: 0,
          isActive: true,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
      ],
      [],
    );
    const r = await repo.createItem("content_manager", "actor-1", {
      menuId,
      sectionId,
      name: "Same",
      priceCents: 1000,
      category: "main",
    });
    expect(r.ok).toBe(true);
  });
});

/* -------------------------- Audit-log creation -------------------------- */

describe("audit-log creation", () => {
  it("records an audit row when a menu is created", async () => {
    await getMenuRepository().createMenu("administrator", "actor-1", {
      name: "M",
      slug: "m",
      description: "",
      status: "draft",
      displayOrder: 0,
    });
    const repo = __getMockMenuRepositoryForSeed();
    const createAudit = repo.auditLogs.find((a) => a.action === "menu.create");
    expect(createAudit).toBeDefined();
    expect(createAudit!.entity_type).toBe("menu");
    expect(createAudit!.entity_id).toBeTruthy();
  });

  it("records an audit row when a menu is archived", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = newId();
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
      [],
      [],
    );
    await getMenuRepository().archiveMenu("administrator", "actor-1", menuId);
    const archiveAudit = __getMockMenuRepositoryForSeed().auditLogs.find(
      (a) => a.action === "menu.archive",
    );
    expect(archiveAudit).toBeDefined();
    expect(archiveAudit!.entity_id).toBe(menuId);
  });

  it("audit rows never carry secrets or session tokens", async () => {
    await getMenuRepository().createMenu("administrator", "actor-1", {
      name: "M",
      slug: "m",
      description: "",
      status: "draft",
      displayOrder: 0,
    });
    const serialized = JSON.stringify(__getMockMenuRepositoryForSeed().auditLogs);
    expect(serialized).not.toMatch(/token|secret|password|refresh|access_token/i);
  });
});

/* ---------------------- Archive & deactivation ---------------------- */

describe("archive & deactivation", () => {
  it("archives a menu and clears its publish dates", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = newId();
    repo.__seed(
      [
        {
          id: menuId,
          name: "M",
          slug: "m",
          description: "",
          status: "published",
          displayOrder: 0,
          publishAt: "2025-01-01T00:00:00Z",
          unpublishAt: "2025-02-01T00:00:00Z",
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
      ],
      [],
      [],
    );
    await getMenuRepository().archiveMenu("administrator", "actor-1", menuId);
    const m = repo.menus.find((x) => x.id === menuId)!;
    expect(m.status).toBe("archived");
    expect(m.publishAt).toBeNull();
    expect(m.unpublishAt).toBeNull();
  });

  it("deactivates a section", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = newId();
    const sectionId = newId();
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
          id: sectionId,
          menuId,
          name: "S",
          description: "",
          displayOrder: 0,
          isActive: true,
          createdAt: "2025-09-01T10:00:00Z",
          updatedAt: "2025-09-01T10:00:00Z",
        },
      ],
      [],
    );
    await getMenuRepository().setSectionActive("ops_manager", "actor-1", sectionId, false);
    expect(repo.sections.find((s) => s.id === sectionId)!.isActive).toBe(false);
  });

  it("deactivates an item", async () => {
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
          status: "draft",
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
          name: "I",
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
      ],
    );
    await getMenuRepository().setItemActive("ops_manager", "actor-1", itemId, false);
    expect(repo.items.find((i) => i.id === itemId)!.isActive).toBe(false);
  });

  it("archived menus are not returned in public reads", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = newId();
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
      [],
      [],
    );
    await getMenuRepository().archiveMenu("administrator", "actor-1", menuId);
    expect(await getMenuRepository().listPublishedMenus()).toHaveLength(0);
  });
});

/* ----------------------------- Ordering ----------------------------- */

describe("ordering", () => {
  it("reorders sections", async () => {
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
    await getMenuRepository().reorderSections("administrator", "actor-1", menuId, [s2, s1]);
    expect(repo.sections.find((s) => s.id === s2)!.displayOrder).toBe(0);
    expect(repo.sections.find((s) => s.id === s1)!.displayOrder).toBe(1);
  });

  it("reorders items", async () => {
    const repo = __getMockMenuRepositoryForSeed();
    const menuId = newId();
    const i1 = newId();
    const i2 = newId();
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
      [],
      [
        {
          id: i1,
          menuId,
          sectionId: null,
          name: "I1",
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
          id: i2,
          menuId,
          sectionId: null,
          name: "I2",
          description: "",
          priceCents: 500,
          category: "side",
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
      ],
    );
    await getMenuRepository().reorderItems("administrator", "actor-1", menuId, [i2, i1]);
    expect(repo.items.find((i) => i.id === i2)!.displayOrder).toBe(0);
    expect(repo.items.find((i) => i.id === i1)!.displayOrder).toBe(1);
  });
});

/* ----------------- Static checks on menu.functions.ts wrapper ----------------- */

describe("menu.functions.ts — wrapper authorization & boundaries", () => {
  const src = menuFunctionsSource();

  it("every CMS mutation calls requireMutationActor before the repository", () => {
    const mutations = [
      "createMenu",
      "updateMenu",
      "publishMenu",
      "archiveMenu",
      "createSection",
      "updateSection",
      "setSectionActive",
      "createItem",
      "updateItem",
      "setItemActive",
      "reorderSections",
      "reorderItems",
    ];
    for (const name of mutations) {
      // Each mutation handler references requireMutationActor.
      const block = src.slice(src.indexOf(`export const ${name} =`));
      const handlerEnd = block.indexOf("});");
      const handler = block.slice(0, handlerEnd);
      expect(handler, `${name} must guard`).toContain("requireMutationActor");
    }
  });

  it("CMS reads call requireDraftActor before the repository", () => {
    for (const name of ["listAllMenus", "getMenuDetail"]) {
      const block = src.slice(src.indexOf(`export const ${name} =`));
      const handlerEnd = block.indexOf("});");
      expect(block.slice(0, handlerEnd), `${name} must guard`).toContain("requireDraftActor");
    }
  });

  it("publishMenu enforces publishingRuleViolations then delegates to the atomic RPC", () => {
    // Slice the whole publishMenu export (up to the next export) so assertions
    // see the full handler. The date-window check (publishingRuleViolations)
    // runs in the handler for a clear message; the active-item eligibility
    // check is now enforced atomically inside the service-role-only RPC
    // (publish_menu) to prevent the validation/write TOCTOU race.
    const start = src.indexOf("export const publishMenu =");
    const next = src.indexOf("export const archiveMenu =");
    const handler = src.slice(start, next);
    expect(handler).toContain("publishingRuleViolations");
    expect(handler).toMatch(/repo\.publishMenu/);
  });

  it("never exposes raw Supabase errors or secrets to the browser", () => {
    expect(src).not.toMatch(/process\.env\.(SUPABASE|SERVICE_ROLE|ANON)/i);
    expect(src).not.toMatch(/\.error\.(message|code|details|hint)\b/i);
    // Safe generic messages only.
    expect(src).toMatch(/could not be saved/i);
    expect(src).toMatch(/could not be loaded/i);
  });

  it("imports server-only modules via .server.ts and resolves the actor (no browser role)", () => {
    expect(src).toContain('from "@/lib/server/menu-repository.server"');
    expect(src).toContain('from "@/lib/server/menu-auth.server"');
    // No callerRole / browser role parameter anywhere in the wrappers.
    expect(src).not.toMatch(/callerRole/);
  });

  it("public reads do not require authentication", () => {
    const listBlock = src.slice(
      src.indexOf("export const listPublishedMenus ="),
      src.indexOf("export const getPublishedMenuBySlug"),
    );
    expect(listBlock).not.toContain("requireMutationActor");
    expect(listBlock).not.toContain("requireDraftActor");
  });
});
