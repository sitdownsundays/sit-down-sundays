/**
 * Menu CMS — mock repository (server-only, local development only).
 *
 * In-memory implementation used when APP_DATA_MODE=mock. Mirrors the
 * Supabase repository's behavior (public filtering, role gating, audit
 * logging, cross-menu section protection, optimistic concurrency, and the
 * published-menu invariant) so tests exercise the same rules.
 *
 * No live persistence. Never imported by client code.
 */
import {
  conflict,
  hasDraftReadRole,
  hasMutationRole,
  notFound,
  unauthorized,
  type MenuRepository,
} from "./menu-shared.server";
import { type MenuCategory, type MenuStatus } from "@/lib/menu/constants";
import type {
  MenuItemInput,
  MenuInput,
  MenuMutationResult,
  MenuSectionInput,
  MenuWithContentDTO,
} from "@/lib/menu/types";
import type { RoleKey } from "@/lib/domain/types";
import type { MockAuditRow } from "./menu-shared.server";
import {
  filterPublicItems,
  menuIsVisible,
  menuToDTO,
  type MockItemRow,
  type MockMenuRow,
  type MockSectionRow,
} from "./menu-mock-helpers.server";

export type { MockItemRow, MockMenuRow, MockSectionRow };

interface Snapshot {
  menus: MockMenuRow[];
  sections: MockSectionRow[];
  items: MockItemRow[];
  auditLogs: MockAuditRow[];
}

/** Thrown when a mutation would leave a published menu with no eligible item. */
export class PublishedMenuEmptyError extends Error {
  constructor() {
    super("This change would leave a published menu with no active items.");
    this.name = "PublishedMenuEmptyError";
  }
}

export class MockMenuRepository implements MenuRepository {
  menus: MockMenuRow[] = [];
  sections: MockSectionRow[] = [];
  items: MockItemRow[] = [];
  auditLogs: MockAuditRow[] = [];

  /** When true, per-method invariant checks are skipped (a transaction
   *  wrapper checks the final state once). Mirrors DEFERRABLE INITIALLY
   *  DEFERRED behavior. */
  private suppressInvariant = false;

  private now(): string {
    return new Date().toISOString();
  }

  /* --------------------- Published-menu invariant --------------------- */

  private eligibleCount(menuId: string): number {
    return this.items.filter((i) => {
      if (i.menuId !== menuId || !i.isActive) return false;
      if (i.sectionId == null) return true;
      const s = this.sections.find((x) => x.id === i.sectionId);
      return !!s && s.menuId === menuId && s.isActive;
    }).length;
  }

  private invariantViolated(affectedMenuIds: string[]): boolean {
    for (const mid of affectedMenuIds) {
      const m = this.menus.find((x) => x.id === mid);
      if (m && m.status === "published" && this.eligibleCount(mid) === 0) {
        return true;
      }
    }
    return false;
  }

  private snapshot(): Snapshot {
    return {
      menus: this.menus.map((m) => ({ ...m })),
      sections: this.sections.map((s) => ({ ...s })),
      items: this.items.map((i) => ({ ...i })),
      auditLogs: [...this.auditLogs],
    };
  }

  private restore(snap: Snapshot): void {
    this.menus = snap.menus;
    this.sections = snap.sections;
    this.items = snap.items;
    this.auditLogs = snap.auditLogs;
  }

  /**
   * Run a multi-step mutation as one atomic unit. Per-method invariant
   * checks are suppressed; the final state is checked once at the end
   * (mirrors DEFERRABLE INITIALLY DEFERRED). On any failure, all changes
   * (including audit rows) are rolled back.
   */
  async transaction<T>(fn: (repo: this) => Promise<T>): Promise<T> {
    const snap = this.snapshot();
    const wasSuppressed = this.suppressInvariant;
    this.suppressInvariant = true;
    try {
      const result = await fn(this);
      const affected = this.menus.filter((m) => m.status === "published").map((m) => m.id);
      if (this.invariantViolated(affected)) {
        this.restore(snap);
        throw new PublishedMenuEmptyError();
      }
      return result;
    } catch (e) {
      this.restore(snap);
      throw e;
    } finally {
      this.suppressInvariant = wasSuppressed;
    }
  }

  private audit(
    actorId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
  ): void {
    this.auditLogs.push({
      id: crypto.randomUUID(),
      actor_user_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      created_at: this.now(),
    });
  }

  /* ----------------------------- Public reads ----------------------------- */

  async listPublishedMenus(): Promise<MenuWithContentDTO[]> {
    const at = new Date();
    return this.menus
      .filter((m) => menuIsVisible(m, at))
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((m) => {
        const dto = menuToDTO(m, this.sections, this.items);
        dto.sections = dto.sections.filter((s) => s.isActive);
        dto.items = filterPublicItems(m, this.sections, this.items);
        return dto;
      });
  }

  async getPublishedMenuBySlug(slug: string): Promise<MenuWithContentDTO | null> {
    const at = new Date();
    const m = this.menus.find((x) => x.slug === slug && menuIsVisible(x, at));
    if (!m) return null;
    const dto = menuToDTO(m, this.sections, this.items);
    dto.sections = dto.sections.filter((s) => s.isActive);
    dto.items = filterPublicItems(m, this.sections, this.items);
    return dto;
  }

  /* ------------------------------- CMS reads ------------------------------- */

  async listAllMenus(callerRole: RoleKey): Promise<MenuWithContentDTO[]> {
    if (!hasDraftReadRole(callerRole)) return [];
    return [...this.menus]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((m) => menuToDTO(m, this.sections, this.items));
  }

  async getMenuDetail(callerRole: RoleKey, id: string): Promise<MenuWithContentDTO | null> {
    if (!hasDraftReadRole(callerRole)) return null;
    const m = this.menus.find((x) => x.id === id);
    return m ? menuToDTO(m, this.sections, this.items) : null;
  }

  /* ------------------------------ CMS mutations ------------------------------ */

  async createMenu(
    callerRole: RoleKey,
    actorId: string | null,
    input: MenuInput,
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    const now = this.now();
    const id = crypto.randomUUID();
    this.menus.push({
      id,
      name: input.name,
      slug: input.slug,
      description: input.description ?? "",
      // Status is always "draft" on creation — never read from input. A
      // caller cannot create a published or archived menu by supplying status.
      status: "draft",
      displayOrder: input.displayOrder ?? 0,
      publishAt: input.publishAt ?? null,
      unpublishAt: input.unpublishAt ?? null,
      createdAt: now,
      updatedAt: now,
    });
    this.audit(actorId, "menu.create", "menu", id);
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
    const m = this.menus.find((x) => x.id === id);
    if (!m) return notFound();
    if (m.updatedAt !== expectedUpdatedAt) return conflict();
    if (input.name !== undefined) m.name = input.name;
    if (input.slug !== undefined) m.slug = input.slug;
    if (input.description !== undefined) m.description = input.description;
    if (input.displayOrder !== undefined) m.displayOrder = input.displayOrder;
    if (input.publishAt !== undefined) m.publishAt = input.publishAt;
    if (input.unpublishAt !== undefined) m.unpublishAt = input.unpublishAt;
    m.updatedAt = this.now();
    this.audit(actorId, "menu.update", "menu", id);
    return { ok: true, message: "Menu updated." };
  }

  async publishMenu(
    callerRole: RoleKey,
    actorId: string | null,
    id: string,
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    if (actorId == null) return { ok: false, message: "Actor is required." };
    const m = this.menus.find((x) => x.id === id);
    if (!m) return notFound();
    if (m.status === "archived") {
      return { ok: false, message: "An archived menu cannot be published again." };
    }
    if (m.status !== "draft" && m.status !== "published") {
      return { ok: false, message: "This menu cannot be published in its current state." };
    }
    const hasEligible = this.items.some((i) => {
      if (i.menuId !== id || !i.isActive) return false;
      if (i.sectionId == null) return true;
      const s = this.sections.find((x) => x.id === i.sectionId);
      return !!s && s.menuId === id && s.isActive;
    });
    if (!hasEligible) {
      return {
        ok: false,
        message: "A published menu needs at least one active item before it can go live.",
      };
    }
    m.status = "published";
    m.updatedAt = this.now();
    this.audit(actorId, "menu.publish", "menu", id);
    return { ok: true, message: "Menu published." };
  }

  async archiveMenu(
    callerRole: RoleKey,
    actorId: string | null,
    id: string,
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    const m = this.menus.find((x) => x.id === id);
    if (!m) return notFound();
    m.status = "archived";
    m.publishAt = null;
    m.unpublishAt = null;
    m.updatedAt = this.now();
    this.audit(actorId, "menu.archive", "menu", id);
    return { ok: true, message: "Menu archived." };
  }

  async createSection(
    callerRole: RoleKey,
    actorId: string | null,
    input: MenuSectionInput,
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    if (!this.menus.some((m) => m.id === input.menuId)) return notFound();
    const now = this.now();
    const id = crypto.randomUUID();
    this.sections.push({
      id,
      menuId: input.menuId,
      name: input.name,
      description: input.description ?? "",
      displayOrder: input.displayOrder ?? 0,
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });
    this.audit(actorId, "menu_section.create", "menu_section", id);
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
    const s = this.sections.find((x) => x.id === id);
    if (!s) return notFound();
    if (s.updatedAt !== expectedUpdatedAt) return conflict();
    const oldMenuId = s.menuId;
    const before = { ...s };
    if (input.name !== undefined) s.name = input.name;
    if (input.description !== undefined) s.description = input.description;
    if (input.displayOrder !== undefined) s.displayOrder = input.displayOrder;
    if (input.isActive !== undefined) s.isActive = input.isActive;
    if (input.menuId !== undefined) s.menuId = input.menuId;
    s.updatedAt = this.now();
    if (!this.suppressInvariant) {
      const affected = [oldMenuId, s.menuId];
      if (this.invariantViolated(affected)) {
        Object.assign(s, before);
        return {
          ok: false,
          message: "This change would leave a published menu with no active items.",
        };
      }
    }
    this.audit(actorId, "menu_section.update", "menu_section", id);
    return { ok: true, message: "Section updated." };
  }

  async setSectionActive(
    callerRole: RoleKey,
    actorId: string | null,
    id: string,
    isActive: boolean,
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    const s = this.sections.find((x) => x.id === id);
    if (!s) return notFound();
    const before = { ...s };
    s.isActive = isActive;
    s.updatedAt = this.now();
    if (!this.suppressInvariant && this.invariantViolated([s.menuId])) {
      Object.assign(s, before);
      return {
        ok: false,
        message: "This change would leave a published menu with no active items.",
      };
    }
    this.audit(
      actorId,
      isActive ? "menu_section.activate" : "menu_section.deactivate",
      "menu_section",
      id,
    );
    return { ok: true, message: "Section updated." };
  }

  async createItem(
    callerRole: RoleKey,
    actorId: string | null,
    input: MenuItemInput,
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    if (!this.menus.some((m) => m.id === input.menuId)) return notFound();
    if (input.sectionId != null) {
      const s = this.sections.find((x) => x.id === input.sectionId);
      if (!s || s.menuId !== input.menuId) {
        return { ok: false, message: "That section does not belong to this menu." };
      }
    }
    const now = this.now();
    const id = crypto.randomUUID();
    this.items.push({
      id,
      menuId: input.menuId,
      sectionId: input.sectionId ?? null,
      name: input.name,
      description: input.description ?? "",
      priceCents: input.priceCents,
      category: input.category,
      imageUrl: input.imageUrl ?? null,
      imageAlt: input.imageAlt ?? null,
      dietaryTags: input.dietaryTags ?? [],
      allergens: input.allergens ?? [],
      isActive: input.isActive ?? true,
      isFeatured: input.isFeatured ?? false,
      displayOrder: input.displayOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    });
    this.audit(actorId, "menu_item.create", "menu_item", id);
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
    const i = this.items.find((x) => x.id === id);
    if (!i) return notFound();
    if (i.updatedAt !== expectedUpdatedAt) return conflict();
    const oldMenuId = i.menuId;
    const before = { ...i };
    if (input.sectionId !== undefined) {
      const newMenuId = input.menuId ?? i.menuId;
      if (input.sectionId != null) {
        const s = this.sections.find((x) => x.id === input.sectionId);
        if (!s || s.menuId !== newMenuId) {
          return { ok: false, message: "That section does not belong to this menu." };
        }
      }
      i.sectionId = input.sectionId;
    }
    if (input.menuId !== undefined) i.menuId = input.menuId;
    if (input.name !== undefined) i.name = input.name;
    if (input.description !== undefined) i.description = input.description;
    if (input.priceCents !== undefined) i.priceCents = input.priceCents;
    if (input.category !== undefined) i.category = input.category;
    if (input.imageUrl !== undefined) i.imageUrl = input.imageUrl;
    if (input.imageAlt !== undefined) i.imageAlt = input.imageAlt;
    if (input.dietaryTags !== undefined) i.dietaryTags = input.dietaryTags;
    if (input.allergens !== undefined) i.allergens = input.allergens;
    if (input.isActive !== undefined) i.isActive = input.isActive;
    if (input.isFeatured !== undefined) i.isFeatured = input.isFeatured;
    if (input.displayOrder !== undefined) i.displayOrder = input.displayOrder;
    i.updatedAt = this.now();
    if (!this.suppressInvariant) {
      const affected = [oldMenuId, i.menuId];
      if (this.invariantViolated(affected)) {
        Object.assign(i, before);
        return {
          ok: false,
          message: "This change would leave a published menu with no active items.",
        };
      }
    }
    this.audit(actorId, "menu_item.update", "menu_item", id);
    return { ok: true, message: "Item updated." };
  }

  async setItemActive(
    callerRole: RoleKey,
    actorId: string | null,
    id: string,
    isActive: boolean,
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    const i = this.items.find((x) => x.id === id);
    if (!i) return notFound();
    const before = { ...i };
    i.isActive = isActive;
    i.updatedAt = this.now();
    if (!this.suppressInvariant && this.invariantViolated([i.menuId])) {
      Object.assign(i, before);
      return {
        ok: false,
        message: "This change would leave a published menu with no active items.",
      };
    }
    this.audit(actorId, isActive ? "menu_item.activate" : "menu_item.deactivate", "menu_item", id);
    return { ok: true, message: "Item updated." };
  }

  async reorderSections(
    callerRole: RoleKey,
    actorId: string | null,
    menuId: string,
    orderedSectionIds: string[],
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    if (actorId == null) return { ok: false, message: "Actor is required." };
    if (!this.menus.some((m) => m.id === menuId)) return notFound();
    if (orderedSectionIds.length === 0) {
      return { ok: false, message: "No sections provided." };
    }
    if (new Set(orderedSectionIds).size !== orderedSectionIds.length) {
      return { ok: false, message: "Duplicate section IDs are not allowed." };
    }
    const existing = this.sections.filter((x) => x.menuId === menuId);
    if (existing.length !== orderedSectionIds.length) {
      return { ok: false, message: "Reorder list must include every section for this menu." };
    }
    const matching = orderedSectionIds.filter((sid) =>
      this.sections.some((x) => x.id === sid && x.menuId === menuId),
    );
    if (matching.length !== orderedSectionIds.length) {
      return { ok: false, message: "One or more sections do not belong to this menu." };
    }
    orderedSectionIds.forEach((sid, idx) => {
      const s = this.sections.find((x) => x.id === sid && x.menuId === menuId);
      if (s) {
        s.displayOrder = idx;
        s.updatedAt = this.now();
      }
    });
    this.audit(actorId, "menu_section.reorder", "menu", menuId);
    return { ok: true, message: "Sections reordered." };
  }

  async reorderItems(
    callerRole: RoleKey,
    actorId: string | null,
    menuId: string,
    orderedItemIds: string[],
  ): Promise<MenuMutationResult> {
    if (!hasMutationRole(callerRole)) return unauthorized();
    if (actorId == null) return { ok: false, message: "Actor is required." };
    if (!this.menus.some((m) => m.id === menuId)) return notFound();
    if (orderedItemIds.length === 0) {
      return { ok: false, message: "No items provided." };
    }
    if (new Set(orderedItemIds).size !== orderedItemIds.length) {
      return { ok: false, message: "Duplicate item IDs are not allowed." };
    }
    const existing = this.items.filter((x) => x.menuId === menuId);
    if (existing.length !== orderedItemIds.length) {
      return { ok: false, message: "Reorder list must include every item for this menu." };
    }
    const matching = orderedItemIds.filter((iid) =>
      this.items.some((x) => x.id === iid && x.menuId === menuId),
    );
    if (matching.length !== orderedItemIds.length) {
      return { ok: false, message: "One or more items do not belong to this menu." };
    }
    orderedItemIds.forEach((iid, idx) => {
      const i = this.items.find((x) => x.id === iid && x.menuId === menuId);
      if (i) {
        i.displayOrder = idx;
        i.updatedAt = this.now();
      }
    });
    this.audit(actorId, "menu_item.reorder", "menu", menuId);
    return { ok: true, message: "Items reordered." };
  }

  /** Test-only seed. Not called by application code. */
  __seed(menus: MockMenuRow[], sections: MockSectionRow[], items: MockItemRow[]): void {
    this.menus = [...menus];
    this.sections = [...sections];
    this.items = [...items];
    this.auditLogs = [];
  }
}
