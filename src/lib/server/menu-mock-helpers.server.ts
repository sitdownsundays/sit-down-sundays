/**
 * Menu CMS — mock DTO-mapping helpers (server-only).
 *
 * Pure mapping functions extracted from MockMenuRepository to keep that file
 * focused. Server-only (blocked from the client bundle by filename).
 */
import type { MenuCategory, MenuStatus } from "@/lib/menu/constants";
import type { MenuItemDTO, MenuSectionDTO, MenuWithContentDTO } from "@/lib/menu/types";

export interface MockMenuRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: MenuStatus;
  displayOrder: number;
  publishAt: string | null;
  unpublishAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MockSectionRow {
  id: string;
  menuId: string;
  name: string;
  description: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MockItemRow {
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
  createdAt: string;
  updatedAt: string;
}

export function sectionToDTO(s: MockSectionRow): MenuSectionDTO {
  return {
    id: s.id,
    menuId: s.menuId,
    name: s.name,
    description: s.description,
    displayOrder: s.displayOrder,
    isActive: s.isActive,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export function itemToDTO(i: MockItemRow): MenuItemDTO {
  return {
    id: i.id,
    menuId: i.menuId,
    sectionId: i.sectionId,
    name: i.name,
    description: i.description,
    priceCents: i.priceCents,
    category: i.category,
    imageUrl: i.imageUrl,
    imageAlt: i.imageAlt,
    dietaryTags: i.dietaryTags,
    allergens: i.allergens,
    isActive: i.isActive,
    isFeatured: i.isFeatured,
    displayOrder: i.displayOrder,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

export function menuToDTO(
  m: MockMenuRow,
  sections: MockSectionRow[],
  items: MockItemRow[],
): MenuWithContentDTO {
  return {
    id: m.id,
    name: m.name,
    slug: m.slug,
    description: m.description,
    status: m.status,
    displayOrder: m.displayOrder,
    publishAt: m.publishAt,
    unpublishAt: m.unpublishAt,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    sections: sections
      .filter((s) => s.menuId === m.id)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(sectionToDTO),
    items: items
      .filter((i) => i.menuId === m.id)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(itemToDTO),
  };
}

export function filterPublicItems(
  m: MockMenuRow,
  sections: MockSectionRow[],
  items: MockItemRow[],
): MenuItemDTO[] {
  return items
    .filter((i) => i.menuId === m.id && i.isActive)
    .filter((i) => {
      if (i.sectionId == null) return true;
      const s = sections.find((x) => x.id === i.sectionId);
      return !!s && s.menuId === m.id && s.isActive;
    })
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(itemToDTO);
}

export function menuIsVisible(m: MockMenuRow, at = new Date()): boolean {
  if (m.status !== "published") return false;
  if (m.publishAt && new Date(m.publishAt) > at) return false;
  if (m.unpublishAt && new Date(m.unpublishAt) <= at) return false;
  return true;
}
