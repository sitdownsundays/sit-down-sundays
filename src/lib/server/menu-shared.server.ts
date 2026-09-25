/**
 * Menu CMS — shared server-only: repository interface, role helpers, row
 * shapes, mapping, and audit helpers.
 *
 * Split out of menu-repository.server.ts so each file stays focused. Server
 * only (blocked from the client bundle by filename). No secrets, no mock data.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MENU_DRAFT_READ_ROLES,
  MENU_MUTATION_ROLES,
  type MenuCategory,
  type MenuStatus,
} from "@/lib/menu/constants";
import type {
  MenuItemDTO,
  MenuItemInput,
  MenuInput,
  MenuMutationResult,
  MenuSectionDTO,
  MenuSectionInput,
  MenuWithContentDTO,
} from "@/lib/menu/types";
import type { RoleKey } from "@/lib/domain/types";

/* ----------------------------- Repository interface ----------------------------- */

export interface MenuRepository {
  listPublishedMenus(): Promise<MenuWithContentDTO[]>;
  getPublishedMenuBySlug(slug: string): Promise<MenuWithContentDTO | null>;
  listAllMenus(callerRole: RoleKey): Promise<MenuWithContentDTO[]>;
  getMenuDetail(callerRole: RoleKey, id: string): Promise<MenuWithContentDTO | null>;
  createMenu(
    callerRole: RoleKey,
    actorId: string | null,
    input: MenuInput,
  ): Promise<MenuMutationResult>;
  updateMenu(
    callerRole: RoleKey,
    actorId: string | null,
    id: string,
    input: Partial<MenuInput>,
    expectedUpdatedAt: string,
  ): Promise<MenuMutationResult>;
  publishMenu(callerRole: RoleKey, actorId: string | null, id: string): Promise<MenuMutationResult>;
  archiveMenu(callerRole: RoleKey, actorId: string | null, id: string): Promise<MenuMutationResult>;
  createSection(
    callerRole: RoleKey,
    actorId: string | null,
    input: MenuSectionInput,
  ): Promise<MenuMutationResult>;
  updateSection(
    callerRole: RoleKey,
    actorId: string | null,
    id: string,
    input: Partial<MenuSectionInput>,
    expectedUpdatedAt: string,
  ): Promise<MenuMutationResult>;
  setSectionActive(
    callerRole: RoleKey,
    actorId: string | null,
    id: string,
    isActive: boolean,
  ): Promise<MenuMutationResult>;
  createItem(
    callerRole: RoleKey,
    actorId: string | null,
    input: MenuItemInput,
  ): Promise<MenuMutationResult>;
  updateItem(
    callerRole: RoleKey,
    actorId: string | null,
    id: string,
    input: Partial<MenuItemInput>,
    expectedUpdatedAt: string,
  ): Promise<MenuMutationResult>;
  setItemActive(
    callerRole: RoleKey,
    actorId: string | null,
    id: string,
    isActive: boolean,
  ): Promise<MenuMutationResult>;
  reorderSections(
    callerRole: RoleKey,
    actorId: string | null,
    menuId: string,
    orderedSectionIds: string[],
  ): Promise<MenuMutationResult>;
  reorderItems(
    callerRole: RoleKey,
    actorId: string | null,
    menuId: string,
    orderedItemIds: string[],
  ): Promise<MenuMutationResult>;
}

/* ----------------------------- Role helpers ----------------------------- */

export function hasMutationRole(role: RoleKey): boolean {
  return (MENU_MUTATION_ROLES as readonly string[]).includes(role);
}

export function hasDraftReadRole(role: RoleKey): boolean {
  return (MENU_DRAFT_READ_ROLES as readonly string[]).includes(role);
}

export function unauthorized(): MenuMutationResult {
  return { ok: false, message: "You are not authorized to manage menu content." };
}

export function notFound(): MenuMutationResult {
  return { ok: false, message: "Menu content not found." };
}

/**
 * Optimistic-concurrency conflict: the expected updated_at did not match the
 * stored row. Returned instead of silently overwriting newer data. Never
 * exposes raw database errors.
 */
export function conflict(): MenuMutationResult {
  return {
    ok: false,
    message:
      "This content was changed by someone else. Please refresh and review the latest version before editing.",
  };
}

export interface MockAuditRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
}

/* ----------------------------- Supabase row shapes ----------------------------- */

export interface MenuRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  display_order: number;
  publish_at: string | null;
  unpublish_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SectionRow {
  id: string;
  menu_id: string;
  name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ItemRow {
  id: string;
  menu_id: string;
  section_id: string | null;
  name: string;
  description: string | null;
  price_cents: number;
  category: string;
  image_url: string | null;
  image_alt: string | null;
  dietary_tags: string[] | null;
  allergens: string[] | null;
  is_active: boolean;
  is_featured: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

/* ----------------------------- Mapping helpers ----------------------------- */

export function menuRowToDTO(m: MenuRow): Omit<MenuWithContentDTO, "sections" | "items"> {
  return {
    id: m.id,
    name: m.name,
    slug: m.slug,
    description: m.description ?? "",
    status: m.status as MenuStatus,
    displayOrder: m.display_order,
    publishAt: m.publish_at,
    unpublishAt: m.unpublish_at,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  };
}

export function sectionRowToDTO(s: SectionRow): MenuSectionDTO {
  return {
    id: s.id,
    menuId: s.menu_id,
    name: s.name,
    description: s.description ?? "",
    displayOrder: s.display_order,
    isActive: s.is_active,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

export function itemRowToDTO(i: ItemRow): MenuItemDTO {
  return {
    id: i.id,
    menuId: i.menu_id,
    sectionId: i.section_id,
    name: i.name,
    description: i.description ?? "",
    priceCents: i.price_cents,
    category: i.category as MenuCategory,
    imageUrl: i.image_url,
    imageAlt: i.image_alt,
    dietaryTags: i.dietary_tags ?? [],
    allergens: i.allergens ?? [],
    isActive: i.is_active,
    isFeatured: i.is_featured,
    displayOrder: i.display_order,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
  };
}

/** Build a full menu DTO with nested sections/items, applying the public filter
 *  when publicOnly is true (active only, same-menu active section). */
export function buildMenuDTO(
  m: MenuRow,
  sections: SectionRow[],
  items: ItemRow[],
  { publicOnly = false }: { publicOnly?: boolean } = {},
): MenuWithContentDTO {
  const visibleSections = sections
    .filter((s) => s.menu_id === m.id)
    .filter((s) => !publicOnly || s.is_active)
    .sort((a, b) => a.display_order - b.display_order)
    .map(sectionRowToDTO);
  const visibleItems = items
    .filter((i) => i.menu_id === m.id)
    .filter((i) => !publicOnly || i.is_active)
    .filter((i) => {
      if (!publicOnly) return true;
      if (i.section_id == null) return true;
      const sec = sections.find((s) => s.id === i.section_id);
      return !!sec && sec.menu_id === m.id && sec.is_active;
    })
    .sort((a, b) => a.display_order - b.display_order)
    .map(itemRowToDTO);
  return { ...menuRowToDTO(m), sections: visibleSections, items: visibleItems };
}

/** Fetch the three rows needed for a full menu DTO, in parallel. */
export async function fetchMenuContent(
  admin: SupabaseClient,
  menuId: string,
): Promise<{ menu: MenuRow | null; sections: SectionRow[]; items: ItemRow[] }> {
  const [menuRes, sectionsRes, itemsRes] = await Promise.all([
    admin.from("menus").select("*").eq("id", menuId).maybeSingle(),
    admin.from("menu_sections").select("*").eq("menu_id", menuId),
    admin.from("menu_items").select("*").eq("menu_id", menuId),
  ]);
  return {
    menu: (menuRes.data as MenuRow | null) ?? null,
    sections: (sectionsRes.data as SectionRow[] | null) ?? [],
    items: (itemsRes.data as ItemRow[] | null) ?? [],
  };
}

/**
 * NOTE: Application-level audit inserts for menus, menu_sections, and
 * menu_items have been REMOVED. Audit logging is now performed by database
 * triggers (0004_menu_cms_atomic_operations.sql) that write to audit_logs in
 * the SAME transaction as each mutation. This guarantees the audit row and
 * the mutation succeed or roll back together, with no duplicate writes and no
 * best-effort loss. Do not re-introduce application-level audit writes for
 * these tables.
 */

/** Map a Supabase error to a safe, secret-free mutation result. */
export function safeMutationError(): { ok: false; message: string } {
  return {
    ok: false,
    message: "Menu content could not be saved. Please review your changes and try again.",
  };
}
