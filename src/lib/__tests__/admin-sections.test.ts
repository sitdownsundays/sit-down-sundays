/**
 * Admin Menu Sections — Phase 3A3B focused behavioral tests.
 *
 * Following the project convention (see admin-menus.test.ts), server
 * functions cannot be invoked directly in vitest (no Start runtime
 * AsyncLocalStorage). These tests exercise the repository logic the UI
 * delegates to (authorization, archived-menu protection, creation, editing,
 * activation/deactivation, complete-list atomic reordering, duplicate/missing/
 * cross-menu reorder rejection, concurrency conflicts) plus the client-side
 * validation the form layer runs before submission.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetMockMenuRepository,
  __getMockMenuRepositoryForSeed,
  getMenuRepository,
} from "@/lib/server/menu-repository.server";
import { __getMockAuthRepository } from "@/lib/server/auth-repository.server";
import { MENU_MUTATION_ROLES } from "@/lib/menu/constants";
import {
  validateSectionForm,
  emptySectionFormValues,
} from "@/components/admin/section-form-helpers";
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

/** Seed a draft menu and return its id. */
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

/** Seed a draft menu with two sections. */
function seedMenuWithSections(role: RoleKey = "administrator") {
  const repo = __getMockMenuRepositoryForSeed();
  const menuId = newId();
  const sectionA = newId();
  const sectionB = newId();
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
        id: sectionA,
        menuId,
        name: "Starters",
        description: "",
        displayOrder: 0,
        isActive: true,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      },
      {
        id: sectionB,
        menuId,
        name: "Mains",
        description: "",
        displayOrder: 1,
        isActive: true,
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      },
    ],
    [],
  );
  authenticateAs(role);
  return { menuId, sectionA, sectionB };
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

describe("admin sections — authorization (repository gating)", () => {
  it.each(MUTATION_ROLES)("allows %s to create a section", async (role) => {
    const menuId = seedMenu(role);
    const repo = getMenuRepository();
    const res = await repo.createSection(role, "actor-1", {
      menuId,
      name: "Starters",
      description: "",
      displayOrder: 0,
    });
    expect(res.ok).toBe(true);
  });

  it.each(BLOCKED_ROLES)("blocks %s from creating a section", async (role) => {
    const menuId = seedMenu("administrator");
    authenticateAs(role);
    const repo = getMenuRepository();
    const res = await repo.createSection(role, "actor-1", {
      menuId,
      name: "Starters",
      description: "",
      displayOrder: 0,
    });
    expect(res.ok).toBe(false);
  });

  it.each(BLOCKED_ROLES)("blocks %s from reordering sections", async (role) => {
    const { menuId, sectionA, sectionB } = seedMenuWithSections("administrator");
    authenticateAs(role);
    const repo = getMenuRepository();
    const res = await repo.reorderSections(role, "actor-1", menuId, [sectionB, sectionA]);
    expect(res.ok).toBe(false);
  });
});

/* ----------------------- Archived-menu protection ------------------------ */

describe("admin sections — archived-menu protection (server-side)", () => {
  it("rejects creating a section on an archived menu", async () => {
    const menuId = seedMenu("administrator");
    const repo = getMenuRepository();
    await repo.archiveMenu("administrator", "actor-1", menuId);
    const res = await repo.createSection("administrator", "actor-1", {
      menuId,
      name: "S",
      description: "",
      displayOrder: 0,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/archived/i);
    // No section was created.
    const detail = await repo.getMenuDetail("administrator", menuId);
    expect(detail?.sections.length).toBe(0);
  });

  it("rejects editing a section on an archived menu", async () => {
    const { menuId, sectionA } = seedMenuWithSections("administrator");
    const repo = getMenuRepository();
    const detail = await repo.getMenuDetail("administrator", menuId);
    const section = detail!.sections.find((s) => s.id === sectionA)!;
    await repo.archiveMenu("administrator", "actor-1", menuId);
    const res = await repo.updateSection(
      "administrator",
      "actor-1",
      sectionA,
      { name: "Renamed" },
      section.updatedAt,
    );
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/archived/i);
    const after = await repo.getMenuDetail("administrator", menuId);
    expect(after!.sections.find((s) => s.id === sectionA)!.name).toBe("Starters");
  });

  it("rejects activating/deactivating a section on an archived menu", async () => {
    const { menuId, sectionA } = seedMenuWithSections("administrator");
    const repo = getMenuRepository();
    const detail = await repo.getMenuDetail("administrator", menuId);
    const section = detail!.sections.find((s) => s.id === sectionA)!;
    await repo.archiveMenu("administrator", "actor-1", menuId);
    const res = await repo.setSectionActive(
      "administrator",
      "actor-1",
      sectionA,
      false,
      section.updatedAt,
    );
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/archived/i);
    const after = await repo.getMenuDetail("administrator", menuId);
    expect(after!.sections.find((s) => s.id === sectionA)!.isActive).toBe(true);
  });

  it("rejects reordering sections on an archived menu", async () => {
    const { menuId, sectionA, sectionB } = seedMenuWithSections("administrator");
    const repo = getMenuRepository();
    await repo.archiveMenu("administrator", "actor-1", menuId);
    const res = await repo.reorderSections("administrator", "actor-1", menuId, [
      sectionB,
      sectionA,
    ]);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/archived/i);
  });
});

/* ----------------------- Creation / editing ------------------------------ */

describe("admin sections — creation and editing", () => {
  it("creates a section", async () => {
    const menuId = seedMenu("content_manager");
    const repo = getMenuRepository();
    const res = await repo.createSection("content_manager", "actor-1", {
      menuId,
      name: "Desserts",
      description: "Sweet endings.",
      displayOrder: 2,
    });
    expect(res.ok).toBe(true);
    const detail = await repo.getMenuDetail("content_manager", menuId);
    expect(detail?.sections.length).toBe(1);
    expect(detail?.sections[0].name).toBe("Desserts");
    expect(detail?.sections[0].isActive).toBe(true);
  });

  it("updates section metadata without changing menuId", async () => {
    const { menuId, sectionA } = seedMenuWithSections("administrator");
    const repo = getMenuRepository();
    const detail = await repo.getMenuDetail("administrator", menuId);
    const section = detail!.sections.find((s) => s.id === sectionA)!;
    const res = await repo.updateSection(
      "administrator",
      "actor-1",
      sectionA,
      { name: "Appetizers", description: "To start" },
      section.updatedAt,
    );
    expect(res.ok).toBe(true);
    const after = await repo.getMenuDetail("administrator", menuId);
    const updated = after!.sections.find((s) => s.id === sectionA)!;
    expect(updated.name).toBe("Appetizers");
    expect(updated.menuId).toBe(menuId);
  });

  it("rejects creating a section for a nonexistent menu", async () => {
    authenticateAs("administrator");
    const repo = getMenuRepository();
    const res = await repo.createSection("administrator", "actor-1", {
      menuId: newId(),
      name: "X",
      description: "",
      displayOrder: 0,
    });
    expect(res.ok).toBe(false);
  });
});

/* ------------------- Activation / deactivation --------------------------- */

describe("admin sections — activation and deactivation", () => {
  it("deactivates a section", async () => {
    const { menuId, sectionA } = seedMenuWithSections("administrator");
    const repo = getMenuRepository();
    const detail0 = await repo.getMenuDetail("administrator", menuId);
    const sec0 = detail0!.sections.find((s) => s.id === sectionA)!;
    const res = await repo.setSectionActive(
      "administrator",
      "actor-1",
      sectionA,
      false,
      sec0.updatedAt,
    );
    expect(res.ok).toBe(true);
    const detail = await repo.getMenuDetail("administrator", menuId);
    const section = detail!.sections.find((s) => s.id === sectionA)!;
    expect(section.isActive).toBe(false);
  });

  it("reactivates a section", async () => {
    const { menuId, sectionA } = seedMenuWithSections("administrator");
    const repo = getMenuRepository();
    let d = await repo.getMenuDetail("administrator", menuId);
    let s = d!.sections.find((x) => x.id === sectionA)!;
    await repo.setSectionActive("administrator", "actor-1", sectionA, false, s.updatedAt);
    d = await repo.getMenuDetail("administrator", menuId);
    s = d!.sections.find((x) => x.id === sectionA)!;
    const res = await repo.setSectionActive(
      "administrator",
      "actor-1",
      sectionA,
      true,
      s.updatedAt,
    );
    expect(res.ok).toBe(true);
    const after = await repo.getMenuDetail("administrator", menuId);
    expect(after!.sections.find((x) => x.id === sectionA)!.isActive).toBe(true);
  });

  it("refuses to deactivate the last eligible section of a published menu", async () => {
    // A published menu must retain at least one publicly eligible active item.
    // Deactivating a section that contains the only eligible item must fail.
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
          name: "Only",
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
    const d0 = await r.getMenuDetail("administrator", menuId);
    const s0 = d0!.sections.find((x) => x.id === sectionId)!;
    const res = await r.setSectionActive(
      "administrator",
      "actor-1",
      sectionId,
      false,
      s0.updatedAt,
    );
    expect(res.ok).toBe(false);
    // The section remains active.
    const detail = await r.getMenuDetail("administrator", menuId);
    const section = detail!.sections.find((s) => s.id === sectionId)!;
    expect(section.isActive).toBe(true);
  });
});

/* ------------------- Complete-list atomic reordering --------------------- */

describe("admin sections — complete-list atomic reordering", () => {
  it("reorders sections with a complete list", async () => {
    const { menuId, sectionA, sectionB } = seedMenuWithSections("administrator");
    const repo = getMenuRepository();
    const res = await repo.reorderSections("administrator", "actor-1", menuId, [
      sectionB,
      sectionA,
    ]);
    expect(res.ok).toBe(true);
    const detail = await repo.getMenuDetail("administrator", menuId);
    const ordered = detail!.sections.sort((a, b) => a.displayOrder - b.displayOrder);
    expect(ordered[0].id).toBe(sectionB);
    expect(ordered[1].id).toBe(sectionA);
  });

  it("rejects a partial (missing) reorder list without changing order", async () => {
    const { menuId, sectionA, sectionB } = seedMenuWithSections("administrator");
    const repo = getMenuRepository();
    // Only supply one of two sections.
    const res = await repo.reorderSections("administrator", "actor-1", menuId, [sectionA]);
    expect(res.ok).toBe(false);
    // Order is unchanged.
    const detail = await repo.getMenuDetail("administrator", menuId);
    const ordered = detail!.sections.sort((a, b) => a.displayOrder - b.displayOrder);
    expect(ordered[0].id).toBe(sectionA);
    expect(ordered[1].id).toBe(sectionB);
  });

  it("rejects duplicate IDs without changing order", async () => {
    const { menuId, sectionA, sectionB } = seedMenuWithSections("administrator");
    const repo = getMenuRepository();
    const res = await repo.reorderSections("administrator", "actor-1", menuId, [
      sectionA,
      sectionA,
    ]);
    expect(res.ok).toBe(false);
    const detail = await repo.getMenuDetail("administrator", menuId);
    const ordered = detail!.sections.sort((a, b) => a.displayOrder - b.displayOrder);
    expect(ordered[0].id).toBe(sectionA);
    expect(ordered[1].id).toBe(sectionB);
  });

  it("rejects an empty reorder list", async () => {
    const { menuId } = seedMenuWithSections("administrator");
    const repo = getMenuRepository();
    const res = await repo.reorderSections("administrator", "actor-1", menuId, []);
    expect(res.ok).toBe(false);
  });

  it("rejects cross-menu section IDs without changing order", async () => {
    const { menuId, sectionA, sectionB } = seedMenuWithSections("administrator");
    // Seed a second menu with its own section.
    const otherMenuId = newId();
    const otherSection = newId();
    const repo = __getMockMenuRepositoryForSeed();
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
          id: sectionA,
          menuId,
          name: "Starters",
          description: "",
          displayOrder: 0,
          isActive: true,
          createdAt: BASE_TIME,
          updatedAt: BASE_TIME,
        },
        {
          id: sectionB,
          menuId,
          name: "Mains",
          description: "",
          displayOrder: 1,
          isActive: true,
          createdAt: BASE_TIME,
          updatedAt: BASE_TIME,
        },
        {
          id: otherSection,
          menuId: otherMenuId,
          name: "Other Section",
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
    // Supply the other menu's section in place of sectionB.
    const res = await r.reorderSections("administrator", "actor-1", menuId, [
      sectionA,
      otherSection,
    ]);
    expect(res.ok).toBe(false);
    // Order unchanged.
    const detail = await r.getMenuDetail("administrator", menuId);
    const ordered = detail!.sections.sort((a, b) => a.displayOrder - b.displayOrder);
    expect(ordered[0].id).toBe(sectionA);
    expect(ordered[1].id).toBe(sectionB);
  });

  it("rejects reordering for a nonexistent menu", async () => {
    authenticateAs("administrator");
    const repo = getMenuRepository();
    const res = await repo.reorderSections("administrator", "actor-1", newId(), [newId()]);
    expect(res.ok).toBe(false);
  });
});

/* --------------------------- Concurrency conflict ------------------------ */

describe("admin sections — optimistic-concurrency conflict", () => {
  it("returns a conflict when expectedUpdatedAt is stale", async () => {
    const { menuId, sectionA } = seedMenuWithSections("administrator");
    const repo = getMenuRepository();
    const detail = await repo.getMenuDetail("administrator", menuId);
    const section = detail!.sections.find((s) => s.id === sectionA)!;
    // First successful update bumps updatedAt.
    const first = await repo.updateSection(
      "administrator",
      "actor-1",
      sectionA,
      { name: "First Edit" },
      section.updatedAt,
    );
    expect(first.ok).toBe(true);
    const afterFirst = await repo.getMenuDetail("administrator", menuId);
    const newUpdatedAt = afterFirst!.sections.find((s) => s.id === sectionA)!.updatedAt;

    // Stale expectedUpdatedAt must conflict.
    const stale = await repo.updateSection(
      "administrator",
      "actor-1",
      sectionA,
      { name: "Stale Edit" },
      section.updatedAt,
    );
    expect(stale.ok).toBe(false);
    expect(stale.message).toMatch(/changed by someone else|refresh/i);

    // The stale edit did not overwrite the first edit.
    const after = await repo.getMenuDetail("administrator", menuId);
    const s = after!.sections.find((x) => x.id === sectionA)!;
    expect(s.name).toBe("First Edit");
    expect(s.updatedAt).toBe(newUpdatedAt);
  });
});

/* --------------------- Double-submit prevention (UI) --------------------- */

describe("admin sections — double-submit prevention", () => {
  it("the sections panel uses a synchronous ref-backed lock", async () => {
    // The UI source must contain the synchronous lock pattern: check and set
    // a ref before awaiting, cleared in finally. This is a structural
    // guarantee that two immediate calls do not both proceed.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "src", "components", "admin", "menu-sections-panel.tsx"),
      "utf-8",
    );
    expect(src).toMatch(/actionLockRef/);
    expect(src).toMatch(/if \(actionLockRef\.current\) return/);
    expect(src).toMatch(/actionLockRef\.current = true/);
    expect(src).toMatch(/actionLockRef\.current = false/);
  });
});

/* ------------------------------- Validation ------------------------------ */

describe("admin sections — form validation", () => {
  it("requires a name", () => {
    const errors = validateSectionForm({ ...emptySectionFormValues(), name: "  " });
    expect(errors.name).toBeTruthy();
  });

  it("accepts a valid section", () => {
    const errors = validateSectionForm({
      ...emptySectionFormValues(),
      name: "Starters",
      displayOrder: "1",
    });
    expect(errors.name).toBeUndefined();
    expect(errors.displayOrder).toBeUndefined();
  });

  it("rejects a negative display order", () => {
    const errors = validateSectionForm({
      ...emptySectionFormValues(),
      name: "S",
      displayOrder: "-1",
    });
    expect(errors.displayOrder).toBeTruthy();
  });
});

/* --------------------- Protected-field / menuId immutability --------------------- */

describe("admin sections — protected fields and menuId immutability", () => {
  it("updateSection ignores a browser-supplied menuId (section stays on its menu)", async () => {
    const { menuId, sectionA } = seedMenuWithSections("administrator");
    // Seed a second menu to attempt a cross-menu move.
    const otherMenuId = newId();
    __getMockMenuRepositoryForSeed().__seed(
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
          id: sectionA,
          menuId,
          name: "Starters",
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
    const repo = getMenuRepository();
    const detail = await repo.getMenuDetail("administrator", menuId);
    const section = detail!.sections.find((s) => s.id === sectionA)!;
    // Attempt to smuggle a menuId change.
    const res = await repo.updateSection(
      "administrator",
      "actor-1",
      sectionA,
      { menuId: otherMenuId, name: "Moved" },
      section.updatedAt,
    );
    expect(res.ok).toBe(true);
    const after = await repo.getMenuDetail("administrator", menuId);
    // The section remains on the original menu; only its name changed.
    const s = after!.sections.find((x) => x.id === sectionA)!;
    expect(s.menuId).toBe(menuId);
    expect(s.name).toBe("Moved");
  });

  it("the section input schema strips protected audit fields", async () => {
    const { menuSectionInputSchema } = await import("@/lib/menu/schema");
    const parsed = menuSectionInputSchema.parse({
      menuId: crypto.randomUUID(),
      name: "S",
      id: "smuggled-id",
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    }) as Record<string, unknown>;
    expect(parsed.id).toBeUndefined();
    expect(parsed.createdAt).toBeUndefined();
    expect(parsed.updatedAt).toBeUndefined();
  });
});
