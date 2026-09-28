/**
 * Admin Menu Items — shared helpers (validation, form value types, price
 * conversion, tag normalization).
 *
 * Framework-independent. No server-only imports.
 */
import type { MenuItemDTO, MenuSectionDTO } from "@/lib/menu/types";
import {
  MAX_PRICE_CENTS,
  MENU_CATEGORIES,
  MENU_LIMITS,
  type MenuCategory,
} from "@/lib/menu/constants";

export interface ItemFormValues {
  name: string;
  description: string;
  priceDollars: string;
  category: MenuCategory;
  sectionId: string;
  imageUrl: string;
  imageAlt: string;
  dietaryTags: string;
  allergens: string;
  isFeatured: boolean;
  displayOrder: string;
}

export function emptyItemFormValues(): ItemFormValues {
  return {
    name: "",
    description: "",
    priceDollars: "",
    category: "main",
    sectionId: "",
    imageUrl: "",
    imageAlt: "",
    dietaryTags: "",
    allergens: "",
    isFeatured: false,
    displayOrder: "0",
  };
}

export function itemToFormValues(item: MenuItemDTO): ItemFormValues {
  return {
    name: item.name,
    description: item.description ?? "",
    priceDollars: item.priceCents != null ? (item.priceCents / 100).toFixed(2) : "",
    category: item.category,
    sectionId: item.sectionId ?? "",
    imageUrl: item.imageUrl ?? "",
    imageAlt: item.imageAlt ?? "",
    dietaryTags: (item.dietaryTags ?? []).join(", "),
    allergens: (item.allergens ?? []).join(", "),
    isFeatured: item.isFeatured ?? false,
    displayOrder: String(item.displayOrder ?? 0),
  };
}

export interface ItemFormErrors {
  name?: string;
  description?: string;
  priceDollars?: string;
  category?: string;
  sectionId?: string;
  imageUrl?: string;
  imageAlt?: string;
  dietaryTags?: string;
  allergens?: string;
  displayOrder?: string;
}

/**
 * Convert a dollar string entered in the UI to integer cents.
 * Rejects negative values, excess precision (>2 decimals), NaN, and values
 * beyond the existing maximum. Returns null when invalid.
 */
export function dollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  const cents = Math.round(dollars * 100);
  if (cents > MAX_PRICE_CENTS) return null;
  return cents;
}

/**
 * Normalize a comma-separated tag string into a deduplicated, trimmed,
 * case-insensitively unique list bounded by the existing limit.
 */
/**
 * Normalize a comma-separated tag string: split, trim, drop blanks, and
 * deduplicate case-insensitively (preserving first-seen casing). Does NOT
 * truncate at a count or filter by length — validation handles those so an
 * over-length entry or too many entries raise a clear error instead of being
 * silently discarded (an allergen must never be silently dropped).
 */
export function normalizeTags(input: string): string[] {
  const parts = input
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

export function validateItemForm(v: ItemFormValues): ItemFormErrors {
  const errors: ItemFormErrors = {};
  if (!v.name.trim()) errors.name = "Name is required.";
  else if (v.name.trim().length > MENU_LIMITS.menuItemName)
    errors.name = `Name must be ${MENU_LIMITS.menuItemName} characters or fewer.`;

  if (v.description.length > MENU_LIMITS.description)
    errors.description = `Description must be ${MENU_LIMITS.description} characters or fewer.`;

  const cents = dollarsToCents(v.priceDollars);
  if (cents === null) {
    if (v.priceDollars.trim() === "") errors.priceDollars = "Price is required.";
    else
      errors.priceDollars =
        "Enter a valid price in dollars (up to two decimals, no negative values).";
  }

  if (!MENU_CATEGORIES.includes(v.category)) errors.category = "Select a valid category.";

  if (v.imageUrl.length > MENU_LIMITS.imageUrl)
    errors.imageUrl = `Image URL must be ${MENU_LIMITS.imageUrl} characters or fewer.`;

  // Accessibility: a present (nonblank) image requires nonblank alt text.
  const hasImage = v.imageUrl.trim() !== "";
  const hasAlt = v.imageAlt.trim() !== "";
  if (hasImage && !hasAlt) {
    errors.imageAlt = "Descriptive alt text is required when an image is provided.";
  }
  if (v.imageAlt.length > MENU_LIMITS.imageAlt)
    errors.imageAlt = `Alt text must be ${MENU_LIMITS.imageAlt} characters or fewer.`;

  // Tags are normalized (trimmed, blanks dropped, case-insensitively deduped)
  // and THEN checked for per-entry length and total unique count — so an
  // over-length entry or too many entries raise a clear error instead of being
  // silently truncated or discarded (an allergen is never silently dropped).
  const dietaryTagList = normalizeTags(v.dietaryTags);
  if (dietaryTagList.some((t) => t.length > 60))
    errors.dietaryTags = "Each dietary tag must be 60 characters or fewer.";
  else if (dietaryTagList.length > 20) errors.dietaryTags = "At most 20 dietary tags are allowed.";

  const allergenList = normalizeTags(v.allergens);
  if (allergenList.some((t) => t.length > 60))
    errors.allergens = "Each allergen must be 60 characters or fewer.";
  else if (allergenList.length > 20) errors.allergens = "At most 20 allergens are allowed.";

  const order = Number(v.displayOrder);
  if (v.displayOrder === "" || Number.isNaN(order) || !Number.isInteger(order) || order < 0)
    errors.displayOrder = "Display order must be a whole number of 0 or more.";

  return errors;
}

/** Build the create payload from validated form values. */
export function buildCreatePayload(
  v: ItemFormValues,
  menuId: string,
): {
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
  isFeatured: boolean;
  displayOrder: number;
} {
  return {
    menuId,
    sectionId: v.sectionId.trim() === "" ? null : v.sectionId,
    name: v.name.trim(),
    description: v.description.trim(),
    priceCents: dollarsToCents(v.priceDollars) ?? 0,
    category: v.category,
    imageUrl: v.imageUrl.trim() === "" ? null : v.imageUrl.trim(),
    imageAlt: v.imageAlt.trim() === "" ? null : v.imageAlt.trim(),
    dietaryTags: normalizeTags(v.dietaryTags),
    allergens: normalizeTags(v.allergens),
    isFeatured: v.isFeatured,
    displayOrder: Number(v.displayOrder),
  };
}

/** Build the patch payload from validated form values (omits menuId/isActive). */
export function buildPatchPayload(v: ItemFormValues): {
  sectionId: string | null;
  name: string;
  description: string;
  priceCents: number;
  category: MenuCategory;
  imageUrl: string | null;
  imageAlt: string | null;
  dietaryTags: string[];
  allergens: string[];
  isFeatured: boolean;
  displayOrder: number;
} {
  return {
    sectionId: v.sectionId.trim() === "" ? null : v.sectionId,
    name: v.name.trim(),
    description: v.description.trim(),
    priceCents: dollarsToCents(v.priceDollars) ?? 0,
    category: v.category,
    imageUrl: v.imageUrl.trim() === "" ? null : v.imageUrl.trim(),
    imageAlt: v.imageAlt.trim() === "" ? null : v.imageAlt.trim(),
    dietaryTags: normalizeTags(v.dietaryTags),
    allergens: normalizeTags(v.allergens),
    isFeatured: v.isFeatured,
    displayOrder: Number(v.displayOrder),
  };
}

/** Human-readable section name for an item, or "Unassigned". */
export function sectionLabel(item: MenuItemDTO, sections: MenuSectionDTO[]): string {
  if (!item.sectionId) return "Unassigned";
  const s = sections.find((x) => x.id === item.sectionId);
  return s ? s.name : "Unassigned";
}
