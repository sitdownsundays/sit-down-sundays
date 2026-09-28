/**
 * Admin Menu Sections — strict schema + setSectionActive conflict tests.
 *
 * Behavioral tests for the strict section-create/patch schemas and the
 * optimistic-concurrency conflict on setSectionActive. These exercise real
 * schema parsing and the mock repository.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetMockMenuRepository,
  __getMockMenuRepositoryForSeed,
  getMenuRepository,
} from "@/lib/server/menu-repository.server";
import { __getMockAuthRepository } from "@/lib/server/auth-repository.server";
import type { RoleKey } from "@/lib/domain/types";

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

function seedMenuWithSections(role: RoleKey) {
  const menuId = newId();
  const sectionA = newId();
  const sectionB = newId();
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

afterEach(() => {
  try {
    unauthenticate();
  } catch {
    /* ignore */
  }
});

describe("admin sections — strict section schemas", () => {
  it("section-create schema rejects status, isActive, id, and audit fields", async () => {
    const { menuSectionCreateSchema } = await import("@/lib/menu/schema");
    expect(() =>
      menuSectionCreateSchema.parse({
        menuId: crypto.randomUUID(),
        name: "S",
        status: "published",
        isActive: false,
        id: "smuggled",
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      }),
    ).toThrow();
  });

  it("section-create schema accepts only menuId, name, description, displayOrder", async () => {
    const { menuSectionCreateSchema } = await import("@/lib/menu/schema");
    const parsed = menuSectionCreateSchema.parse({
      menuId: crypto.randomUUID(),
      name: "S",
      description: "desc",
      displayOrder: 3,
    }) as Record<string, unknown>;
    expect(parsed.name).toBe("S");
    expect(parsed.displayOrder).toBe(3);
    expect(parsed.status).toBeUndefined();
    expect(parsed.isActive).toBeUndefined();
    expect(parsed.id).toBeUndefined();
  });

  it("section-patch schema rejects menuId, isActive, id, and audit fields", async () => {
    const { menuSectionPatchSchema } = await import("@/lib/menu/schema");
    expect(() =>
      menuSectionPatchSchema.parse({
        menuId: crypto.randomUUID(),
        isActive: true,
        id: "smuggled",
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      }),
    ).toThrow();
  });

  it("section-patch schema accepts only name, description, displayOrder", async () => {
    const { menuSectionPatchSchema } = await import("@/lib/menu/schema");
    const parsed = menuSectionPatchSchema.parse({
      name: "New",
      displayOrder: 5,
    }) as Record<string, unknown>;
    expect(parsed.name).toBe("New");
    expect(parsed.displayOrder).toBe(5);
    expect(parsed.menuId).toBeUndefined();
    expect(parsed.isActive).toBeUndefined();
  });
});

describe("admin sections — setSectionActive optimistic-concurrency conflict", () => {
  it("returns a conflict when expectedUpdatedAt is stale", async () => {
    const { menuId, sectionA } = seedMenuWithSections("administrator");
    const repo = getMenuRepository();
    let detail = await repo.getMenuDetail("administrator", menuId);
    const section = detail!.sections.find((s) => s.id === sectionA)!;
    // First successful deactivation bumps updatedAt.
    const first = await repo.setSectionActive(
      "administrator",
      "actor-1",
      sectionA,
      false,
      section.updatedAt,
    );
    expect(first.ok).toBe(true);
    // Stale expectedUpdatedAt must conflict.
    const stale = await repo.setSectionActive(
      "administrator",
      "actor-1",
      sectionA,
      true,
      section.updatedAt,
    );
    expect(stale.ok).toBe(false);
    expect(stale.message).toMatch(/changed by someone else|refresh/i);
    // The stale edit did not reactivate the section.
    detail = await repo.getMenuDetail("administrator", menuId);
    expect(detail!.sections.find((s) => s.id === sectionA)!.isActive).toBe(false);
  });
});
