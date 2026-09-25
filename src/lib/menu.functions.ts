/**
 * Menu CMS — authenticated server functions (thin client-safe wrappers).
 *
 * Components import these (NOT the *.server.ts helpers). The build replaces
 * their implementations with RPC stubs in client bundles, so server-only
 * modules, secrets, and the service-role client never enter the client
 * dependency graph.
 *
 * AUTHORIZATION (per requirement 2):
 *  - Every CMS read or mutation resolves the CURRENT server-side Supabase user
 *    via resolveMenuActor() (auth.getUser() — never trusting decoded cookies or
 *    a browser-supplied role). The actor's role is the only role that reaches
 *    the repository.
 *  - Public reads (listPublishedMenus / getPublishedMenuBySlug) need no
 *    session; they return only content permitted by the live RLS/publication
 *    rules.
 *  - CMS reads (listAllMenus / getMenuDetail) require a draft-read role
 *    (content_manager, ops_manager, administrator). Guest and unauthenticated
 *    requests are rejected.
 *  - CMS mutations require a mutation role (content_manager, ops_manager,
 *    administrator). Guest and unauthenticated requests are rejected.
 *  - Before publishing, the existing publishingRuleViolations validation runs
 *    and incomplete menus (no active items) are rejected with a safe error.
 *  - Raw Supabase errors, credentials, and stack traces are never exposed.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getMenuRepository } from "@/lib/server/menu-repository.server";
import { resolveMenuActor } from "@/lib/server/menu-auth.server";
import { hasDraftReadRole, hasMutationRole } from "@/lib/server/menu-shared.server";
import {
  menuInputSchema,
  menuItemInputSchema,
  menuItemPatchSchema,
  menuPatchSchema,
  menuSectionInputSchema,
  publishingRuleViolations,
} from "@/lib/menu/schema";
import { MAX_PRICE_CENTS } from "@/lib/menu/constants";
import type { MenuActionResult, MenuListResult, MenuOneResult } from "@/lib/menu/types";

/* ----------------------------- Public reads ----------------------------- */

export const listPublishedMenus = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const repo = getMenuRepository();
    const menus = await repo.listPublishedMenus();
    return { ok: true, menus } as const;
  } catch {
    return { ok: false, kind: "unexpected", message: "Menu content could not be loaded." } as const;
  }
});

const slugSchema = z.object({ slug: z.string().min(1).max(160) }).strict();

export const getPublishedMenuBySlug = createServerFn({ method: "GET" })
  .validator((raw: unknown) => slugSchema.parse(raw))
  .handler(async ({ data }): Promise<MenuOneResult> => {
    try {
      const repo = getMenuRepository();
      const menu = await repo.getPublishedMenuBySlug(data.slug);
      return { ok: true, menu };
    } catch {
      return { ok: false, kind: "unexpected", message: "Menu content could not be loaded." };
    }
  });

/* ------------------------------- CMS reads ------------------------------- */

async function requireDraftActor() {
  const actor = await resolveMenuActor();
  if (!actor || !hasDraftReadRole(actor.role)) {
    return {
      ok: false as const,
      kind: "unauthorized" as const,
      message: "You are not authorized to view menu drafts.",
    };
  }
  return { ok: true as const, actor };
}

export const listAllMenus = createServerFn({ method: "GET" }).handler(
  async (): Promise<MenuListResult> => {
    try {
      const guard = await requireDraftActor();
      if (!guard.ok) return guard;
      const repo = getMenuRepository();
      const menus = await repo.listAllMenus(guard.actor.role);
      return { ok: true, menus };
    } catch {
      return { ok: false, kind: "unexpected", message: "Menu content could not be loaded." };
    }
  },
);

const idSchema = z.object({ id: z.string().uuid() }).strict();

export const getMenuDetail = createServerFn({ method: "GET" })
  .validator((raw: unknown) => idSchema.parse(raw))
  .handler(async ({ data }): Promise<MenuOneResult> => {
    try {
      const guard = await requireDraftActor();
      if (!guard.ok) return guard;
      const repo = getMenuRepository();
      const menu = await repo.getMenuDetail(guard.actor.role, data.id);
      return { ok: true, menu };
    } catch {
      return { ok: false, kind: "unexpected", message: "Menu content could not be loaded." };
    }
  });

/* ------------------------------ CMS mutations ------------------------------ */

async function requireMutationActor() {
  const actor = await resolveMenuActor();
  if (!actor || !hasMutationRole(actor.role)) {
    return {
      ok: false as const,
      kind: "unauthorized" as const,
      message: "You are not authorized to manage menu content.",
    };
  }
  return { ok: true as const, actor };
}

/**
 * Map a neutral repository mutation result to a server-function action result.
 * A conflict message (optimistic-concurrency failure) maps to the "conflict"
 * kind so the caller can refresh and retry rather than silently overwriting.
 */
function toActionResult(result: { ok: boolean; message: string }): MenuActionResult {
  if (result.ok) return { ok: true, message: result.message };
  if (/changed by someone else|refresh/i.test(result.message)) {
    return { ok: false, kind: "conflict", message: result.message };
  }
  return { ok: false, kind: "validation", message: result.message };
}

export const createMenu = createServerFn({ method: "POST" })
  .validator((raw: unknown) => menuInputSchema.parse(raw))
  .handler(async ({ data }): Promise<MenuActionResult> => {
    try {
      const guard = await requireMutationActor();
      if (!guard.ok) return guard;
      const repo = getMenuRepository();
      const result = await repo.createMenu(guard.actor.role, guard.actor.userId, data);
      return toActionResult(result);
    } catch {
      return { ok: false, kind: "unexpected", message: "Menu content could not be saved." };
    }
  });

const updateMenuSchema = z
  .object({ id: z.string().uuid(), patch: menuPatchSchema, expectedUpdatedAt: z.string() })
  .strict();

export const updateMenu = createServerFn({ method: "POST" })
  .validator((raw: unknown) => updateMenuSchema.parse(raw))
  .handler(async ({ data }): Promise<MenuActionResult> => {
    try {
      const guard = await requireMutationActor();
      if (!guard.ok) return guard;
      const repo = getMenuRepository();
      const result = await repo.updateMenu(
        guard.actor.role,
        guard.actor.userId,
        data.id,
        data.patch,
        data.expectedUpdatedAt,
      );
      return toActionResult(result);
    } catch {
      return { ok: false, kind: "unexpected", message: "Menu content could not be saved." };
    }
  });

const publishSchema = z.object({ id: z.string().uuid() }).strict();

export const publishMenu = createServerFn({ method: "POST" })
  .validator((raw: unknown) => publishSchema.parse(raw))
  .handler(async ({ data }): Promise<MenuActionResult> => {
    try {
      const guard = await requireMutationActor();
      if (!guard.ok) return guard;
      const repo = getMenuRepository();
      // The repository's publishMenu delegates to the atomic
      // publish_menu_atomic RPC, which validates eligible active items and
      // publishes in one transaction (preventing the TOCTOU race). The
      // publishing-rule (date-window) check is still applied here first so a
      // clear validation message is returned before the RPC runs.
      const detail = await repo.getMenuDetail(guard.actor.role, data.id);
      if (!detail) {
        return { ok: false, kind: "validation", message: "Menu not found." };
      }
      const violations = publishingRuleViolations({
        status: "published",
        publishAt: detail.publishAt,
        unpublishAt: detail.unpublishAt,
      });
      if (violations.length > 0) {
        return { ok: false, kind: "validation", message: violations[0] };
      }
      const result = await repo.publishMenu(guard.actor.role, guard.actor.userId, data.id);
      return toActionResult(result);
    } catch {
      return { ok: false, kind: "unexpected", message: "Menu content could not be saved." };
    }
  });

export const archiveMenu = createServerFn({ method: "POST" })
  .validator((raw: unknown) => publishSchema.parse(raw))
  .handler(async ({ data }): Promise<MenuActionResult> => {
    try {
      const guard = await requireMutationActor();
      if (!guard.ok) return guard;
      const repo = getMenuRepository();
      const result = await repo.archiveMenu(guard.actor.role, guard.actor.userId, data.id);
      return toActionResult(result);
    } catch {
      return { ok: false, kind: "unexpected", message: "Menu content could not be saved." };
    }
  });

export const createSection = createServerFn({ method: "POST" })
  .validator((raw: unknown) => menuSectionInputSchema.parse(raw))
  .handler(async ({ data }): Promise<MenuActionResult> => {
    try {
      const guard = await requireMutationActor();
      if (!guard.ok) return guard;
      const repo = getMenuRepository();
      const result = await repo.createSection(guard.actor.role, guard.actor.userId, data);
      return toActionResult(result);
    } catch {
      return { ok: false, kind: "unexpected", message: "Menu content could not be saved." };
    }
  });

const updateSectionSchema = z
  .object({
    id: z.string().uuid(),
    patch: menuSectionInputSchema.partial(),
    expectedUpdatedAt: z.string(),
  })
  .strict();

export const updateSection = createServerFn({ method: "POST" })
  .validator((raw: unknown) => updateSectionSchema.parse(raw))
  .handler(async ({ data }): Promise<MenuActionResult> => {
    try {
      const guard = await requireMutationActor();
      if (!guard.ok) return guard;
      const repo = getMenuRepository();
      const result = await repo.updateSection(
        guard.actor.role,
        guard.actor.userId,
        data.id,
        data.patch,
        data.expectedUpdatedAt,
      );
      return toActionResult(result);
    } catch {
      return { ok: false, kind: "unexpected", message: "Menu content could not be saved." };
    }
  });

const setActiveSchema = z.object({ id: z.string().uuid(), isActive: z.boolean() }).strict();

export const setSectionActive = createServerFn({ method: "POST" })
  .validator((raw: unknown) => setActiveSchema.parse(raw))
  .handler(async ({ data }): Promise<MenuActionResult> => {
    try {
      const guard = await requireMutationActor();
      if (!guard.ok) return guard;
      const repo = getMenuRepository();
      const result = await repo.setSectionActive(
        guard.actor.role,
        guard.actor.userId,
        data.id,
        data.isActive,
      );
      return toActionResult(result);
    } catch {
      return { ok: false, kind: "unexpected", message: "Menu content could not be saved." };
    }
  });

export const createItem = createServerFn({ method: "POST" })
  .validator((raw: unknown) => menuItemInputSchema.parse(raw))
  .handler(async ({ data }): Promise<MenuActionResult> => {
    try {
      const guard = await requireMutationActor();
      if (!guard.ok) return guard;
      const repo = getMenuRepository();
      const result = await repo.createItem(guard.actor.role, guard.actor.userId, data);
      return toActionResult(result);
    } catch {
      return { ok: false, kind: "unexpected", message: "Menu content could not be saved." };
    }
  });

const updateItemSchema = z
  .object({ id: z.string().uuid(), patch: menuItemPatchSchema, expectedUpdatedAt: z.string() })
  .strict();

export const updateItem = createServerFn({ method: "POST" })
  .validator((raw: unknown) => updateItemSchema.parse(raw))
  .handler(async ({ data }): Promise<MenuActionResult> => {
    try {
      const guard = await requireMutationActor();
      if (!guard.ok) return guard;
      const repo = getMenuRepository();
      const result = await repo.updateItem(
        guard.actor.role,
        guard.actor.userId,
        data.id,
        data.patch,
        data.expectedUpdatedAt,
      );
      return toActionResult(result);
    } catch {
      return { ok: false, kind: "unexpected", message: "Menu content could not be saved." };
    }
  });

export const setItemActive = createServerFn({ method: "POST" })
  .validator((raw: unknown) => setActiveSchema.parse(raw))
  .handler(async ({ data }): Promise<MenuActionResult> => {
    try {
      const guard = await requireMutationActor();
      if (!guard.ok) return guard;
      const repo = getMenuRepository();
      const result = await repo.setItemActive(
        guard.actor.role,
        guard.actor.userId,
        data.id,
        data.isActive,
      );
      return toActionResult(result);
    } catch {
      return { ok: false, kind: "unexpected", message: "Menu content could not be saved." };
    }
  });

const reorderSchema = z
  .object({ menuId: z.string().uuid(), orderedIds: z.array(z.string().uuid()) })
  .strict();

export const reorderSections = createServerFn({ method: "POST" })
  .validator((raw: unknown) => reorderSchema.parse(raw))
  .handler(async ({ data }): Promise<MenuActionResult> => {
    try {
      const guard = await requireMutationActor();
      if (!guard.ok) return guard;
      const repo = getMenuRepository();
      const result = await repo.reorderSections(
        guard.actor.role,
        guard.actor.userId,
        data.menuId,
        data.orderedIds,
      );
      return toActionResult(result);
    } catch {
      return { ok: false, kind: "unexpected", message: "Menu content could not be saved." };
    }
  });

export const reorderItems = createServerFn({ method: "POST" })
  .validator((raw: unknown) => reorderSchema.parse(raw))
  .handler(async ({ data }): Promise<MenuActionResult> => {
    try {
      const guard = await requireMutationActor();
      if (!guard.ok) return guard;
      const repo = getMenuRepository();
      const result = await repo.reorderItems(
        guard.actor.role,
        guard.actor.userId,
        data.menuId,
        data.orderedIds,
      );
      return toActionResult(result);
    } catch {
      return { ok: false, kind: "unexpected", message: "Menu content could not be saved." };
    }
  });

// Keep MAX_PRICE_CENTS referenced so the server-side ceiling stays in sync.
export const MENU_PRICE_CEILING = MAX_PRICE_CENTS;
