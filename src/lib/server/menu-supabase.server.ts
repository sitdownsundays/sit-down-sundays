/**
 * Menu CMS — Supabase repository (server-only).
 *
 * CMS writes use the service-role client (bypasses RLS by design — the 0003
 * migration defines no INSERT/UPDATE/DELETE policies for anon/authenticated).
 * The caller role is checked before every write. Audit logging is performed
 * by database triggers (0004) in the same transaction as each mutation, so
 * there are NO application-level audit inserts here.
 *
 * Public reads use the ANONYMOUS server client so live RLS controls
 * visibility — future, expired, draft, archived, inactive-section, and
 * inactive-item content cannot be returned.
 *
 * Atomic operations:
 *  - publishMenu calls the service-role-only publish_menu_atomic RPC, which
 *    validates eligible active items and publishes in one transaction.
 *  - reorderSections / reorderItems call the service-role-only
 *    reorder_menu_sections_atomic / reorder_menu_items_atomic RPCs, which
 *    validate unique, same-menu IDs and update all orders in one transaction.
 *
 * Optimistic concurrency: updateMenu / updateSection / updateItem require an
 * expected updated_at; a stale edit returns a safe conflict result instead of
 * overwriting newer data.
 */
import { getAdminClient } from "./supabase-admin.server";
import { getAnonClient } from "./supabase-anon.server";
import {
  buildMenuDTO,
  conflict,
  fetchMenuContent,
  hasDraftReadRole,
  hasMutationRole,
  notFound,
  safeMutationError,
  unauthorized,
  type ItemRow,
  type MenuRepository,
  type MenuRow,
  type SectionRow,
} from "./menu-shared.server";
import type {
  MenuItemInput,
  MenuInput,
  MenuMutationResult,
  MenuSectionInput,
  MenuWithContentDTO,
} from "@/lib/menu/types";
import type { RoleKey } from "@/lib/domain/types";

interface RpcResult {
  ok: boolean;
  message: string;
}

export class SupabaseMenuRepository implements MenuRepository {
  /* ----------------------------- Public reads ----------------------------- */
  // Uses the anonymous client so live RLS enforces publication/active rules.
  // Future, expired, draft, archived, inactive-section, and inactive-item
  // content is filtered out by the RLS policies defined in 0003.

  async listPublishedMenus(): Promise<MenuWithContentDTO[]> {
    const anon = getAnonClient();
    const { data: menus, error } = await anon
      .from("menus")
      .select(
        "id,name,slug,description,status,display_order,publish_at,unpublish_at,created_at,updated_at",
      )
      .order("display_order", { ascending: true });
    if (error) throw new Error("Menu content could not be loaded.");
    const menuRows = (menus ?? []) as unknown as MenuRow[];
    if (menuRows.length === 0) return [];
    const ids = menuRows.map((m) => m.id);
    const [sectionsRes, itemsRes] = await Promise.all([
      anon
        .from("menu_sections")
        .select("*")
        .in("menu_id", ids)
        .order("display_order", { ascending: true }),
      anon
        .from("menu_items")
        .select("*")
        .in("menu_id", ids)
        .order("display_order", { ascending: true }),
    ]);
    if (sectionsRes.error || itemsRes.error) throw new Error("Menu content could not be loaded.");
    const sections = (sectionsRes.data ?? []) as unknown as SectionRow[];
    const items = (itemsRes.data ?? []) as unknown as ItemRow[];
    return menuRows.map((m) => buildMenuDTO(m, sections, items, { publicOnly: true }));
  }

  async getPublishedMenuBySlug(slug: string): Promise<MenuWithContentDTO | null> {
    const anon = getAnonClient();
    const { data: menuRow, error } = await anon
      .from("menus")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    if (error || !menuRow) return null;
    const m = menuRow as unknown as MenuRow;
    const [sectionsRes, itemsRes] = await Promise.all([
      anon
        .from("menu_sections")
        .select("*")
        .eq("menu_id", m.id)
        .order("display_order", { ascending: true }),
      anon
        .from("menu_items")
        .select("*")
        .eq("menu_id", m.id)
        .order("display_order", { ascending: true }),
    ]);
    if (sectionsRes.error || itemsRes.error) return null;
    const sections = (sectionsRes.data ?? []) as unknown as SectionRow[];
    const items = (itemsRes.data ?? []) as unknown as ItemRow[];
    return buildMenuDTO(m, sections, items, { publicOnly: true });
  }

  /* ------------------------------- CMS reads ------------------------------- */

  async listAllMenus(callerRole: RoleKey): Promise<MenuWithContentDTO[]> {
    if (!hasDraftReadRole(callerRole)) return [];
    const admin = getAdminClient();
    const { data: menus, error } = await admin
      .from("menus")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw new Error("Menu content could not be loaded.");
    const menuRows = (menus ?? []) as unknown as MenuRow[];
    if (menuRows.length === 0) return [];
    const ids = menuRows.map((m) => m.id);
    const [sectionsRes, itemsRes] = await Promise.all([
      admin
        .from("menu_sections")
        .select("*")
        .in("menu_id", ids)
        .order("display_order", { ascending: true }),
      admin
        .from("menu_items")
        .select("*")
        .in("menu_id", ids)
        .order("display_order", { ascending: true }),
    ]);
    if (sectionsRes.error || itemsRes.error) throw new Error("Menu content could not be loaded.");
    const sections = (sectionsRes.data ?? []) as unknown as SectionRow[];
    const items = (itemsRes.data ?? []) as unknown as ItemRow[];
    return menuRows.map((m) => buildMenuDTO(m, sections, items));
  }

  async getMenuDetail(callerRole: RoleKey, id: string): Promise<MenuWithContentDTO | null> {
    if (!hasDraftReadRole(callerRole)) return null;
    const admin = getAdminClient();
    const { menu, sections, items } = await fetchMenuContent(admin, id);
    if (!menu) return null;
    return buildMenuDTO(menu, sections, items);
  }

  /* ------------------------------ CMS mutations ------------------------------ */
  // Audit logging is handled by DB triggers (0004) — no app-level audit here.

  async createMenu(
    callerRole: RoleKey,
    actorId: string | null,
    input: MenuInput,
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    const admin = getAdminClient();
    const { error } = await admin.from("menus").insert({
      name: input.name,
      slug: input.slug,
      description: input.description ?? "",
      // Status is always "draft" on creation — never read from input. A
      // caller cannot create a published or archived menu by supplying status.
      status: "draft",
      display_order: input.displayOrder ?? 0,
      publish_at: input.publishAt ?? null,
      unpublish_at: input.unpublishAt ?? null,
      created_by: actorId,
      updated_by: actorId,
    });
    if (error) return safeMutationError();
    return { ok: true, message: "Menu created." };
  }

  async updateMenu(
    callerRole: RoleKey,
    actorId: string | null,
    id: string,
    input: Partial<MenuInput>,
    expectedUpdatedAt: string,
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    const admin = getAdminClient();
    // Status is intentionally never set here — only publishMenu/archiveMenu
    // change status. Optimistic concurrency: require the expected updated_at.
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.description !== undefined) patch.description = input.description;
    if (input.displayOrder !== undefined) patch.display_order = input.displayOrder;
    if (input.publishAt !== undefined) patch.publish_at = input.publishAt;
    if (input.unpublishAt !== undefined) patch.unpublish_at = input.unpublishAt;
    patch.updated_by = actorId;
    const { data, error } = await admin
      .from("menus")
      .update(patch)
      .eq("id", id)
      .eq("updated_at", expectedUpdatedAt)
      .select("id")
      .maybeSingle();
    if (error) return safeMutationError();
    if (!data) {
      // Either the row does not exist, or updated_at mismatched (stale edit).
      const { data: exists } = await admin.from("menus").select("id").eq("id", id).maybeSingle();
      return exists ? conflict() : notFound();
    }
    return { ok: true, message: "Menu updated." };
  }

  async publishMenu(
    callerRole: RoleKey,
    actorId: string | null,
    id: string,
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    const admin = getAdminClient();
    // Atomic validate-and-publish RPC (service-role only). Prevents the
    // TOCTOU race where an item is deactivated between check and write.
    const { data, error } = await admin.rpc("publish_menu_atomic", {
      p_menu_id: id,
      p_actor: actorId,
    });
    if (error) return safeMutationError();
    const result = (data ?? null) as RpcResult | null;
    if (!result) return safeMutationError();
    return { ok: result.ok, message: result.message };
  }

  async archiveMenu(
    callerRole: RoleKey,
    actorId: string | null,
    id: string,
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    const admin = getAdminClient();
    const { data, error } = await admin
      .from("menus")
      .update({ status: "archived", publish_at: null, unpublish_at: null, updated_by: actorId })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) return safeMutationError();
    if (!data) {
      const { data: exists } = await admin.from("menus").select("id").eq("id", id).maybeSingle();
      return exists ? conflict() : notFound();
    }
    return { ok: true, message: "Menu archived." };
  }

  async createSection(
    callerRole: RoleKey,
    actorId: string | null,
    input: MenuSectionInput,
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    const admin = getAdminClient();
    const { data: menu } = await admin
      .from("menus")
      .select("id")
      .eq("id", input.menuId)
      .maybeSingle();
    if (!menu) return notFound();
    const { error } = await admin.from("menu_sections").insert({
      menu_id: input.menuId,
      name: input.name,
      description: input.description ?? "",
      display_order: input.displayOrder ?? 0,
      is_active: input.isActive ?? true,
      created_by: actorId,
      updated_by: actorId,
    });
    if (error) return safeMutationError();
    return { ok: true, message: "Section created." };
  }

  async updateSection(
    callerRole: RoleKey,
    actorId: string | null,
    id: string,
    input: Partial<MenuSectionInput>,
    expectedUpdatedAt: string,
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    const admin = getAdminClient();
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.displayOrder !== undefined) patch.display_order = input.displayOrder;
    if (input.isActive !== undefined) patch.is_active = input.isActive;
    patch.updated_by = actorId;
    const { data, error } = await admin
      .from("menu_sections")
      .update(patch)
      .eq("id", id)
      .eq("updated_at", expectedUpdatedAt)
      .select("id")
      .maybeSingle();
    if (error) return safeMutationError();
    if (!data) {
      const { data: exists } = await admin
        .from("menu_sections")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      return exists ? conflict() : notFound();
    }
    return { ok: true, message: "Section updated." };
  }

  async setSectionActive(
    callerRole: RoleKey,
    actorId: string | null,
    id: string,
    isActive: boolean,
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    const admin = getAdminClient();
    const { data, error } = await admin
      .from("menu_sections")
      .update({ is_active: isActive, updated_by: actorId })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) return safeMutationError();
    if (!data) {
      const { data: exists } = await admin
        .from("menu_sections")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      return exists ? conflict() : notFound();
    }
    return { ok: true, message: "Section updated." };
  }

  async createItem(
    callerRole: RoleKey,
    actorId: string | null,
    input: MenuItemInput,
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    const admin = getAdminClient();
    const { data: menu } = await admin
      .from("menus")
      .select("id")
      .eq("id", input.menuId)
      .maybeSingle();
    if (!menu) return notFound();
    // Cross-menu protection: validate an assigned section belongs to the menu
    // server-side, in addition to the composite FK enforced in the DB.
    if (input.sectionId != null) {
      const { data: section } = await admin
        .from("menu_sections")
        .select("id, menu_id")
        .eq("id", input.sectionId)
        .maybeSingle();
      if (!section || (section as { menu_id: string }).menu_id !== input.menuId) {
        return { ok: false, message: "That section does not belong to this menu." };
      }
    }
    const { error } = await admin.from("menu_items").insert({
      menu_id: input.menuId,
      section_id: input.sectionId ?? null,
      name: input.name,
      description: input.description ?? "",
      price_cents: input.priceCents,
      category: input.category,
      image_url: input.imageUrl ?? null,
      image_alt: input.imageAlt ?? null,
      dietary_tags: input.dietaryTags ?? [],
      allergens: input.allergens ?? [],
      is_active: input.isActive ?? true,
      is_featured: input.isFeatured ?? false,
      display_order: input.displayOrder ?? 0,
      created_by: actorId,
      updated_by: actorId,
    });
    if (error) return safeMutationError();
    return { ok: true, message: "Item created." };
  }

  async updateItem(
    callerRole: RoleKey,
    actorId: string | null,
    id: string,
    input: Partial<MenuItemInput>,
    expectedUpdatedAt: string,
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    const admin = getAdminClient();
    const { data: prev } = await admin.from("menu_items").select("*").eq("id", id).maybeSingle();
    if (!prev) return notFound();
    const currentItem = prev as { menu_id: string };
    if (input.sectionId !== undefined) {
      const newMenuId = input.menuId ?? currentItem.menu_id;
      if (input.sectionId != null) {
        const { data: section } = await admin
          .from("menu_sections")
          .select("id, menu_id")
          .eq("id", input.sectionId)
          .maybeSingle();
        if (!section || (section as { menu_id: string }).menu_id !== newMenuId) {
          return { ok: false, message: "That section does not belong to this menu." };
        }
      }
    }
    const patch: Record<string, unknown> = {};
    if (input.menuId !== undefined) patch.menu_id = input.menuId;
    if (input.sectionId !== undefined) patch.section_id = input.sectionId;
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.priceCents !== undefined) patch.price_cents = input.priceCents;
    if (input.category !== undefined) patch.category = input.category;
    if (input.imageUrl !== undefined) patch.image_url = input.imageUrl;
    if (input.imageAlt !== undefined) patch.image_alt = input.imageAlt;
    if (input.dietaryTags !== undefined) patch.dietary_tags = input.dietaryTags;
    if (input.allergens !== undefined) patch.allergens = input.allergens;
    if (input.isActive !== undefined) patch.is_active = input.isActive;
    if (input.isFeatured !== undefined) patch.is_featured = input.isFeatured;
    if (input.displayOrder !== undefined) patch.display_order = input.displayOrder;
    patch.updated_by = actorId;
    const { data, error } = await admin
      .from("menu_items")
      .update(patch)
      .eq("id", id)
      .eq("updated_at", expectedUpdatedAt)
      .select("id")
      .maybeSingle();
    if (error) return safeMutationError();
    if (!data) {
      const { data: exists } = await admin
        .from("menu_items")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      return exists ? conflict() : notFound();
    }
    return { ok: true, message: "Item updated." };
  }

  async setItemActive(
    callerRole: RoleKey,
    actorId: string | null,
    id: string,
    isActive: boolean,
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    const admin = getAdminClient();
    const { data, error } = await admin
      .from("menu_items")
      .update({ is_active: isActive, updated_by: actorId })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) return safeMutationError();
    if (!data) {
      const { data: exists } = await admin
        .from("menu_items")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      return exists ? conflict() : notFound();
    }
    return { ok: true, message: "Item updated." };
  }

  async reorderSections(
    callerRole: RoleKey,
    actorId: string | null,
    menuId: string,
    orderedSectionIds: string[],
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    const admin = getAdminClient();
    // Atomic reorder RPC (service-role only). Validates unique, same-menu IDs
    // and updates all orders in one transaction; invalid input leaves every
    // previous order unchanged.
    const { data, error } = await admin.rpc("reorder_menu_sections_atomic", {
      p_menu_id: menuId,
      p_section_ids: orderedSectionIds,
      p_actor: actorId,
    });
    if (error) return safeMutationError();
    const result = (data ?? null) as RpcResult | null;
    if (!result) return safeMutationError();
    return { ok: result.ok, message: result.message };
  }

  async reorderItems(
    callerRole: RoleKey,
    actorId: string | null,
    menuId: string,
    orderedItemIds: string[],
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    const admin = getAdminClient();
    const { data, error } = await admin.rpc("reorder_menu_items_atomic", {
      p_menu_id: menuId,
      p_item_ids: orderedItemIds,
      p_actor: actorId,
    });
    if (error) return safeMutationError();
    const result = (data ?? null) as RpcResult | null;
    if (!result) return safeMutationError();
    return { ok: result.ok, message: result.message };
  }
}
