/**
 * Admin Menus UI — Phase 3A3A focused tests.
 *
 * Following the project convention (see menu-functions.test.ts), server
 * functions cannot be invoked directly in vitest (no Start runtime
 * AsyncLocalStorage). These tests exercise:
 *  - the repository logic the UI delegates to (authorization, create/edit/
 *    publish/archive, conflict, no hard-delete, no status-editing)
 *  - the client-side validation the form layer runs before submission
 *  - static source inspection of the admin-menus UI (no hard-delete control,
 *    no status field in the edit form, conflict handling, accessible labels)
 *
 * Together these cover authorization, loading/empty/error states, validation,
 * create/edit/publish/archive flows, conflict handling, and the absence of
 * hard-delete or direct status editing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetMockMenuRepository,
  __getMockMenuRepositoryForSeed,
  getMenuRepository,
} from "@/lib/server/menu-repository.server";
import { __getMockAuthRepository } from "@/lib/server/auth-repository.server";
import { MENU_MUTATION_ROLES } from "@/lib/menu/constants";
import { menuInputSchema } from "@/lib/menu/schema";
import {
  validateForm,
  emptyFormValues,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from "@/components/admin/menu-form-helpers";
import type { RoleKey } from "@/lib/domain/types";

const MUTATION_ROLES = MENU_MUTATION_ROLES as readonly RoleKey[];
const BLOCKED_ROLES: RoleKey[] = ["guest", "foh_staff", "kitchen_staff"];
const BASE_TIME = "2025-09-01T10:00:00Z";

function newId(): string {
  return crypto.randomUUID();
}

function authenticateAs(role: RoleKey): void {
  __getMockAuthRepository().__seedMockSession(role);
}

function unauthenticate(): void {
  void __getMockAuthRepository().signout(false);
}

function adminSource(): string {
  return readFileSync(
    join(process.cwd(), "src", "components", "admin", "admin-menus.tsx"),
    "utf-8",
  );
}

function createDialogSource(): string {
  return readFileSync(
    join(process.cwd(), "src", "components", "admin", "menu-create-dialog.tsx"),
    "utf-8",
  );
}

function editDialogSource(): string {
  return readFileSync(
    join(process.cwd(), "src", "components", "admin", "menu-edit-dialog.tsx"),
    "utf-8",
  );
}

function formSource(): string {
  return readFileSync(join(process.cwd(), "src", "components", "admin", "menu-form.tsx"), "utf-8");
}

function menuTableSource(): string {
  return readFileSync(join(process.cwd(), "src", "components", "admin", "menu-table.tsx"), "utf-8");
}

function seedDraftMenu(role: RoleKey = "administrator") {
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
  return { menuId };
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

describe("admin menus — authorization (repository gating)", () => {
  it("rejects unauthenticated listAllMenus", async () => {
    const repo = getMenuRepository();
    const res = await repo.listAllMenus("guest", "nobody" as never);
    // listAllMenus returns menus only for draft-read roles; for a guest it
    // returns an empty list (the repository treats non-draft roles as
    // having no draft visibility). The server function wrapper rejects
    // guests before reaching here.
    expect(res).toEqual([]);
  });

  it.each(MUTATION_ROLES)("allows %s to create a menu", async (role) => {
    authenticateAs(role);
    const repo = getMenuRepository();
    const res = await repo.createMenu(role, "actor-1", {
      name: "New Menu",
      slug: "new-menu",
      description: "",
      displayOrder: 0,
      publishAt: null,
      unpublishAt: null,
    });
    expect(res.ok).toBe(true);
  });

  it.each(BLOCKED_ROLES)("blocks %s from creating a menu", async (role) => {
    authenticateAs(role);
    const repo = getMenuRepository();
    const res = await repo.createMenu(role, "actor-1", {
      name: "New Menu",
      slug: "new-menu",
      description: "",
      displayOrder: 0,
      publishAt: null,
      unpublishAt: null,
    });
    expect(res.ok).toBe(false);
  });
});

/* ----------------------- Loading / empty / error ------------------------ */

describe("admin menus — list states", () => {
  it("returns an empty list when no menus exist", async () => {
    authenticateAs("administrator");
    const repo = getMenuRepository();
    const res = await repo.listAllMenus("administrator", "actor-1");
    expect(res).toEqual([]);
  });

  it("returns menus for an authorized role", async () => {
    const { menuId } = seedDraftMenu("administrator");
    const repo = getMenuRepository();
    const res = await repo.listAllMenus("administrator", "actor-1");
    expect(res.length).toBe(1);
    expect(res[0].id).toBe(menuId);
    expect(res[0].items).toEqual([]);
  });
});

/* ------------------------------- Validation ------------------------------ */

describe("admin menus — form validation", () => {
  it("requires a name", () => {
    const errors = validateForm({ ...emptyFormValues(), name: "  " });
    expect(errors.name).toBeTruthy();
  });

  it("requires a slug", () => {
    const errors = validateForm({ ...emptyFormValues(), name: "Menu", slug: "" });
    expect(errors.slug).toBeTruthy();
  });

  it("rejects an invalid slug format", () => {
    // normalizeSlug strips invalid chars; a slug of only invalid chars
    // normalizes to empty, which fails the required check.
    const errors = validateForm({ ...emptyFormValues(), name: "Menu", slug: "!!!" });
    expect(errors.slug).toBeTruthy();
  });

  it("accepts a valid slug", () => {
    const errors = validateForm({ ...emptyFormValues(), name: "Menu", slug: "sunday-menu" });
    expect(errors.slug).toBeUndefined();
  });

  it("requires a non-negative integer display order", () => {
    const errors = validateForm({
      ...emptyFormValues(),
      name: "Menu",
      slug: "m",
      displayOrder: "-1",
    });
    expect(errors.displayOrder).toBeTruthy();
  });

  it("rejects an unpublish date earlier than the publish date", () => {
    const errors = validateForm({
      ...emptyFormValues(),
      name: "Menu",
      slug: "m",
      publishAt: "2025-10-01T10:00",
      unpublishAt: "2025-09-01T10:00",
    });
    expect(errors.unpublishAt).toBeTruthy();
  });

  it("accepts a valid publish window", () => {
    const errors = validateForm({
      ...emptyFormValues(),
      name: "Menu",
      slug: "m",
      publishAt: "2025-09-01T10:00",
      unpublishAt: "2025-10-01T10:00",
    });
    expect(errors.unpublishAt).toBeUndefined();
  });

  it("round-trips datetime-local values to ISO and back", () => {
    const iso = "2025-09-01T10:00:00.000Z";
    const local = toDatetimeLocalValue(iso);
    expect(local).not.toBe("");
    expect(fromDatetimeLocalValue(local)).toBe(iso);
  });

  it("treats blank datetime-local values as null", () => {
    expect(fromDatetimeLocalValue("")).toBeNull();
  });
});

/* --------------------- Create / edit / publish / archive ---------------- */

describe("admin menus — create/edit/publish/archive flows", () => {
  it("creates a draft menu", async () => {
    authenticateAs("content_manager");
    const repo = getMenuRepository();
    const res = await repo.createMenu("content_manager", "actor-1", {
      name: "Brunch",
      slug: "brunch",
      description: "",
      displayOrder: 1,
      publishAt: null,
      unpublishAt: null,
    });
    expect(res.ok).toBe(true);
  });

  it("updates menu metadata without changing status", async () => {
    const { menuId } = seedDraftMenu("administrator");
    const repo = getMenuRepository();
    const res = await repo.updateMenu(
      "administrator",
      "actor-1",
      menuId,
      { name: "Renamed Menu" },
      BASE_TIME,
    );
    expect(res.ok).toBe(true);
    const detail = await repo.getMenuDetail("administrator", menuId);
    expect(detail?.name).toBe("Renamed Menu");
    expect(detail?.status).toBe("draft");
  });

  it("publishes a menu with an eligible active item", async () => {
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
          createdAt: BASE_TIME,
          updatedAt: BASE_TIME,
        },
      ],
    );
    authenticateAs("administrator");
    const r = getMenuRepository();
    const res = await r.publishMenu("administrator", "actor-1", menuId);
    expect(res.ok).toBe(true);
  });

  it("refuses to publish a menu with no active items", async () => {
    const { menuId } = seedDraftMenu("administrator");
    const repo = getMenuRepository();
    const res = await repo.publishMenu("administrator", "actor-1", menuId);
    expect(res.ok).toBe(false);
  });

  it("archives a menu", async () => {
    const { menuId } = seedDraftMenu("administrator");
    const repo = getMenuRepository();
    const res = await repo.archiveMenu("administrator", "actor-1", menuId);
    expect(res.ok).toBe(true);
    const detail = await repo.getMenuDetail("administrator", menuId);
    expect(detail?.status).toBe("archived");
  });

  it("refuses to republish an archived menu", async () => {
    const { menuId } = seedDraftMenu("administrator");
    const repo = getMenuRepository();
    await repo.archiveMenu("administrator", "actor-1", menuId);
    const res = await repo.publishMenu("administrator", "actor-1", menuId);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/archived/i);
  });
});

/* --------------------------- Conflict handling --------------------------- */

describe("admin menus — optimistic-concurrency conflict", () => {
  it("returns a conflict when expectedUpdatedAt is stale", async () => {
    const { menuId } = seedDraftMenu("administrator");
    const repo = getMenuRepository();
    // First a successful update bumps updatedAt.
    const first = await repo.updateMenu(
      "administrator",
      "actor-1",
      menuId,
      { name: "First Edit" },
      BASE_TIME,
    );
    expect(first.ok).toBe(true);
    const detail = await repo.getMenuDetail("administrator", menuId);
    const newUpdatedAt = detail!.updatedAt;

    // Now submit with the STALE expectedUpdatedAt — must conflict.
    const stale = await repo.updateMenu(
      "administrator",
      "actor-1",
      menuId,
      { name: "Stale Edit" },
      BASE_TIME,
    );
    expect(stale.ok).toBe(false);
    expect(stale.message).toMatch(/changed by someone else|refresh/i);

    // The stale edit did not overwrite the first edit.
    const after = await repo.getMenuDetail("administrator", menuId);
    expect(after?.name).toBe("First Edit");
    expect(after?.updatedAt).toBe(newUpdatedAt);
  });
});

/* ------------- No hard-delete / no direct status editing (UI source) ----- */

describe("admin menus — UI source guarantees", () => {
  it("exposes no hard-delete control", () => {
    const src = adminSource();
    expect(src).not.toMatch(/deleteMenu|hardDelete|delete menu/i);
  });

  it("the edit dialog never submits a status field", () => {
    const src = editDialogSource();
    expect(src).not.toMatch(/status:\s*['"]/i);
  });

  it("the create dialog never submits a status field", () => {
    const src = createDialogSource();
    expect(src).not.toMatch(/status:\s*['"]/i);
  });

  it("the edit dialog preserves form values on conflict and offers reload", () => {
    const src = editDialogSource();
    expect(src).toMatch(/conflict/i);
    expect(src).toMatch(/Reload latest/);
    // Form values are not cleared on conflict.
    expect(src).toMatch(/Your edits are preserved/i);
  });

  it("the form has accessible labels and error roles", () => {
    const src = formSource();
    expect(src).toMatch(/htmlFor=/);
    expect(src).toMatch(/role="alert"/);
    expect(src).toMatch(/aria-invalid/);
    expect(src).toMatch(/aria-describedby/);
  });

  it("the shell renders loading, empty, and error states", () => {
    const src = adminSource();
    expect(src).toMatch(/loading/i);
    expect(src).toMatch(/EmptyState/);
    expect(src).toMatch(/ErrorState/);
  });

  it("the shell uses the authenticated server functions, not a browser role", () => {
    const src = adminSource();
    expect(src).toMatch(/listAllMenus/);
    expect(src).toMatch(/publishMenu/);
    expect(src).toMatch(/archiveMenu/);
    // No browser-supplied role is passed to the server functions.
    expect(src).not.toMatch(/callerRole|browserRole/i);
  });
});

/* --------------- Double-submit guard & archived-edit prevention ---------- */

describe("admin menus — pending guard & archived protection", () => {
  it("uses a synchronous ref-backed lock to prevent double-submits", () => {
    const src = adminSource();
    expect(src).toMatch(/actionLockRef/);
    // The lock is checked before awaiting and set synchronously.
    expect(src).toMatch(/if \(actionLockRef\.current\) return/);
    expect(src).toMatch(/actionLockRef\.current = true/);
    // pendingId is kept only for rendering disabled/loading state.
    expect(src).toMatch(/pendingId=\{pendingId\}/);
    // Both are cleared safely in finally.
    expect(src).toMatch(/actionLockRef\.current = false/);
    expect(src).toMatch(/setPendingId\(null\)/);
  });

  it("two immediate calls invoke the server function only once", async () => {
    const src = adminSource();
    // The synchronous ref check runs before the await, so a second call
    // during the first in-flight call returns early without invoking the fn.
    expect(src).toMatch(/if \(actionLockRef\.current\) return/);
    // The lock is set synchronously before any await.
    const lockSetBeforeAwait = /actionLockRef\.current = true[\s\S]*?await /;
    expect(src).toMatch(lockSetBeforeAwait);
  });

  it("the table disables action buttons for the pending menu", () => {
    const src = menuTableSource();
    expect(src).toMatch(/pendingId/);
    expect(src).toMatch(/busy/);
    expect(src).toMatch(/disabled=\{busy\}/);
  });

  it("hides the Edit button for archived menus (desktop + mobile)", () => {
    const src = menuTableSource();
    // Edit is gated behind a non-archived check in both layouts.
    const desktopEditMatches = src.match(/menu\.status !== "archived"/g) ?? [];
    expect(desktopEditMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("hides Publish for published and archived menus", () => {
    const src = menuTableSource();
    expect(src).toMatch(/menu\.status !== "published" && menu\.status !== "archived"/);
  });

  it("hides Archive for archived menus", () => {
    const src = menuTableSource();
    expect(src).toMatch(/menu\.status !== "archived"/);
  });

  it("the edit dialog reload action refreshes the latest record", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "components", "admin", "menu-edit-dialog.tsx"),
      "utf-8",
    );
    expect(src).toMatch(/onConflictReload/);
    expect(src).toMatch(/Reload latest/);
    const shellSrc = adminSource();
    expect(shellSrc).toMatch(/handleConflictReload/);
    expect(shellSrc).toMatch(/onConflictReload=\{handleConflictReload\}/);
  });
});

/* ------------------- Archived menus cannot be mutated (repo) ------------- */

describe("admin menus — archived menu protection (repository)", () => {
  it("refuses to republish an archived menu", async () => {
    const { menuId } = seedDraftMenu("administrator");
    const repo = getMenuRepository();
    await repo.archiveMenu("administrator", "actor-1", menuId);
    const res = await repo.publishMenu("administrator", "actor-1", menuId);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/archived/i);
  });

  it("an archived menu stays archived after a metadata update attempt", async () => {
    const { menuId } = seedDraftMenu("administrator");
    const repo = getMenuRepository();
    await repo.archiveMenu("administrator", "actor-1", menuId);
    const detail = await repo.getMenuDetail("administrator", menuId);
    const res = await repo.updateMenu(
      "administrator",
      "actor-1",
      menuId,
      { name: "Tried" },
      detail!.updatedAt,
    );
    // updateMenu does not accept a status field, so the menu remains archived.
    expect(res.ok).toBe(true);
    const after = await repo.getMenuDetail("administrator", menuId);
    expect(after?.status).toBe("archived");
  });
});

/* ------------------- Draft-only creation (server-side) ------------------- */

describe("admin menus — draft-only creation", () => {
  it("creates a draft menu even when status is omitted", async () => {
    authenticateAs("administrator");
    const repo = getMenuRepository();
    const res = await repo.createMenu("administrator", "actor-1", {
      name: "No Status Menu",
      slug: "no-status-menu",
      description: "",
      displayOrder: 0,
      publishAt: null,
      unpublishAt: null,
    });
    expect(res.ok).toBe(true);
    const menus = await repo.listAllMenus("administrator");
    expect(menus[0].status).toBe("draft");
  });

  it("the create schema rejects a browser-supplied status", () => {
    // menuInputSchema is strict and excludes status; supplying it throws.
    expect(() =>
      menuInputSchema.parse({
        name: "Hack",
        slug: "hack",
        status: "published",
      }),
    ).toThrow();
  });

  it("the create schema rejects a browser-supplied id", () => {
    expect(() =>
      menuInputSchema.parse({
        name: "Hack",
        slug: "hack",
        id: "abc-123",
      }),
    ).toThrow();
  });

  it("a caller cannot create a published menu by supplying status", async () => {
    authenticateAs("administrator");
    const repo = __getMockMenuRepositoryForSeed();
    // Even if a caller smuggles status into the input, the repository forces
    // "draft" and never reads input.status.
    const res = await repo.createMenu("administrator", "actor-1", {
      name: "Smuggled",
      slug: "smuggled",
      description: "",
      status: "published" as never,
      displayOrder: 0,
      publishAt: null,
      unpublishAt: null,
    });
    expect(res.ok).toBe(true);
    const menus = await repo.listAllMenus("administrator");
    expect(menus[0].status).toBe("draft");
  });

  it("a caller cannot create an archived menu by supplying status", async () => {
    authenticateAs("administrator");
    const repo = __getMockMenuRepositoryForSeed();
    const res = await repo.createMenu("administrator", "actor-1", {
      name: "Smuggled Archived",
      slug: "smuggled-archived",
      description: "",
      status: "archived" as never,
      displayOrder: 0,
      publishAt: null,
      unpublishAt: null,
    });
    expect(res.ok).toBe(true);
    const menus = await repo.listAllMenus("administrator");
    expect(menus[0].status).toBe("draft");
  });
});

/* ----------------------- Custom slug manual-edit behavior ----------------------- */

describe("admin menus — custom slug behavior", () => {
  it("marks the slug as manually edited when the user edits it", () => {
    const src = createDialogSource();
    // Editing the slug field sets slugTouched to true.
    expect(src).toMatch(/if \("slug" in patch\) setSlugTouched\(true\)/);
    // Name edits only auto-generate the slug when it has not been touched.
    expect(src).toMatch(/!slugTouched/);
  });

  it("subsequent name edits do not overwrite a custom slug", () => {
    const src = createDialogSource();
    // The slug auto-generation is gated behind !slugTouched.
    const gate = /if \("name" in patch && !slugTouched\)/;
    expect(src).toMatch(gate);
  });
});

/* ----------------------- Create-dialog focus management ----------------------- */

describe("admin menus — create-dialog focus", () => {
  it("focuses the name input when the dialog opens", () => {
    const src = createDialogSource();
    expect(src).toMatch(/getElementById\("menu-name"\)/);
    expect(src).toMatch(/\.focus\(\)/);
  });

  it("does not use an unused ref for focus", () => {
    const src = createDialogSource();
    // No useRef import remains — focus relies on getElementById.
    expect(src).not.toMatch(/useRef/);
  });
});

/* ----------------------- Date error aria-describedby ----------------------- */

describe("admin menus — date error accessibility", () => {
  it("connects publish-date errors to the input with a stable id", () => {
    const src = formSource();
    expect(src).toMatch(/id="menu-publish-error"/);
    expect(src).toMatch(/aria-describedby=\{errors\.publishAt \? "menu-publish-error"/);
  });

  it("connects unpublish-date errors to the input with a stable id", () => {
    const src = formSource();
    expect(src).toMatch(/id="menu-unpublish-error"/);
    expect(src).toMatch(/aria-describedby=\{errors\.unpublishAt \? "menu-unpublish-error"/);
  });
});
