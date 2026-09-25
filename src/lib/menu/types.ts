/**
 * Menu CMS — typed DTOs returned by repositories.
 *
 * These are the public/preview-facing and CMS-facing shapes. They are NOT the
 * historical ReservationMealSelection snapshots — those retain their own
 * item-name + price snapshots at booking time and are unaffected by later
 * edits to menu items here.
 *
 * Framework-independent. No server-only imports. No mock data.
 */
import type { ISODateString } from "../domain/types";
import type { MenuCategory, MenuStatus } from "./constants";

export interface MenuSectionDTO {
  id: string;
  menuId: string;
  name: string;
  description: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface MenuItemDTO {
  id: string;
  menuId: string;
  sectionId: string | null;
  name: string;
  description: string;
  priceCents: number;
  category: MenuCategory;
  imageUrl: string | null;
  imageAlt: string | null;
  dietaryTags: string[];
  allergens: string[];
  isActive: boolean;
  isFeatured: boolean;
  displayOrder: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface MenuDTO {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: MenuStatus;
  displayOrder: number;
  publishAt: ISODateString | null;
  unpublishAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/** A menu with its published sections and items nested. */
export interface MenuWithContentDTO extends MenuDTO {
  sections: MenuSectionDTO[];
  items: MenuItemDTO[];
}

/** Input shape for creating/updating a menu. */
export interface MenuInput {
  name: string;
  slug: string;
  description?: string;
  status?: MenuStatus;
  displayOrder?: number;
  publishAt?: ISODateString | null;
  unpublishAt?: ISODateString | null;
}

/** Input shape for creating/updating a menu section. */
export interface MenuSectionInput {
  menuId: string;
  name: string;
  description?: string;
  displayOrder?: number;
  isActive?: boolean;
}

/** Input shape for creating/updating a menu item. */
export interface MenuItemInput {
  menuId: string;
  sectionId?: string | null;
  name: string;
  description?: string;
  priceCents: number;
  category: MenuCategory;
  imageUrl?: string | null;
  imageAlt?: string | null;
  dietaryTags?: string[];
  allergens?: string[];
  isActive?: boolean;
  isFeatured?: boolean;
  displayOrder?: number;
}

/** Neutral repository result for mutations. */
export interface MenuMutationResult {
  ok: boolean;
  /** Never reveals internal membership; carries only a safe message. */
  message: string;
}

/** Server-function result for a menu list read. */
export type MenuListResult =
  | { ok: true; menus: MenuWithContentDTO[] }
  | { ok: false; kind: "unauthorized" | "unexpected"; message: string };

/** Server-function result for a single-menu read. */
export type MenuOneResult =
  | { ok: true; menu: MenuWithContentDTO | null }
  | { ok: false; kind: "unauthorized" | "unexpected"; message: string };

/**
 * Server-function result for a CMS mutation. The "conflict" kind signals an
 * optimistic-concurrency failure: the expected updated_at did not match the
 * stored row (a newer edit exists). The caller should refresh and retry
 * rather than silently overwriting newer data.
 */
export type MenuActionResult =
  | { ok: true; message: string }
  | { ok: false; kind: "unauthorized"; message: string }
  | { ok: false; kind: "validation"; message: string }
  | { ok: false; kind: "conflict"; message: string };
