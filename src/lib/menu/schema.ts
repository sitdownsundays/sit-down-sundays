/**
 * Menu CMS — validation schemas (client-safe, framework-independent).
 *
 * Authoritative validation lives on the server (the repository re-validates
 * before writing). These schemas are shared so the form layer and the server
 * layer agree on the rules. The database CHECK constraints in
 * 0003_menu_catalog.sql are a third, independent enforcement layer.
 */
import { z } from "zod";
import {
  MAX_PRICE_CENTS,
  MENU_CATEGORIES,
  MENU_LIMITS,
  MENU_STATUSES,
  normalizeSlug,
} from "./constants";

export const menuStatusSchema = z.enum(MENU_STATUSES as unknown as [string, ...string[]]);
export const menuCategorySchema = z.enum(MENU_CATEGORIES as unknown as [string, ...string[]]);

/**
 * Create schema for a new menu. Status is INTENTIONALLY EXCLUDED and the
 * schema is strict: a browser-supplied status (or any protected field like
 * id, created_by, updated_at) is rejected. The server handler/repository
 * always assigns status: "draft" — a caller cannot create a published or
 * archived menu by supplying status.
 */
export const menuInputSchema = z
  .object({
    name: z.string().trim().min(1).max(MENU_LIMITS.menuName),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(MENU_LIMITS.menuSlug)
      .transform((v) => normalizeSlug(v)),
    description: z.string().trim().max(MENU_LIMITS.description).optional().default(""),
    displayOrder: z.number().int().min(0).optional().default(0),
    publishAt: z.string().datetime().nullable().optional(),
    unpublishAt: z.string().datetime().nullable().optional(),
  })
  .strict();

/**
 * Patch schema for partial menu updates. Status is INTENTIONALLY EXCLUDED:
 * menu status may change only through publishMenu / archiveMenu. Ordinary
 * metadata updates must never publish or archive a menu. publishAt /
 * unpublishAt remain editable here (they are scheduling metadata, not the
 * status transition itself); the publication-window constraint is enforced
 * by the database CHECK and publishingRuleViolations.
 */
export const menuPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(MENU_LIMITS.menuName).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(MENU_LIMITS.menuSlug)
      .transform((v) => normalizeSlug(v))
      .optional(),
    description: z.string().trim().max(MENU_LIMITS.description).optional(),
    displayOrder: z.number().int().min(0).optional(),
    publishAt: z.string().datetime().nullable().optional(),
    unpublishAt: z.string().datetime().nullable().optional(),
  })
  .strict();

export const menuSectionInputSchema = z.object({
  menuId: z.string().uuid(),
  name: z.string().trim().min(1).max(MENU_LIMITS.sectionName),
  description: z.string().trim().max(MENU_LIMITS.description).optional().default(""),
  displayOrder: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

/**
 * Strict section-CREATE schema. Contains ONLY menuId, name, description, and
 * displayOrder. `.strict()` rejects any other field — including status,
 * isActive, id, audit fields, and timestamps. A new section is always active
 * by default; activation changes must go through setSectionActive.
 */
export const menuSectionCreateSchema = z
  .object({
    menuId: z.string().uuid(),
    name: z.string().trim().min(1).max(MENU_LIMITS.sectionName),
    description: z.string().trim().max(MENU_LIMITS.description).optional().default(""),
    displayOrder: z.number().int().min(0).optional().default(0),
  })
  .strict();

/**
 * Strict section-PATCH schema. Contains ONLY name, description, and
 * displayOrder. `.strict()` rejects menuId, isActive, id, audit fields, and
 * timestamps. A section's menu is fixed at creation; activation changes must
 * use setSectionActive.
 */
export const menuSectionPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(MENU_LIMITS.sectionName).optional(),
    description: z.string().trim().max(MENU_LIMITS.description).optional(),
    displayOrder: z.number().int().min(0).optional(),
  })
  .strict();

/**
 * Normalize a blank/whitespace-only optional string to null. The database
 * accessibility constraint treats a blank image_url as "no image" (which does
 * not require alt text), so the validation layer must canonicalize blank
 * optional image values to null before they reach the repository.
 */
function nullableTrimmedString(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v == null || v === "" ? null : v));
}

/**
 * Normalize a list of tag strings: trim, drop empties, and deduplicate
 * case-insensitively (preserving the first-seen casing). Does NOT truncate or
 * filter by length — per-entry length and total count are validated by the
 * schema BEFORE this transform runs, so invalid entries raise a clear error
 * instead of being silently dropped (an allergen must never be silently
 * discarded). Used for dietary tags and allergens so stored values are
 * consistent and server-enforced.
 */
export function normalizeTagList(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of raw) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * A dietary-tag / allergen field: each entry is trimmed, 1–60 chars, with at
 * most 20 entries; the validated list is then normalized (deduplicated
 * case-insensitively) for storage. Validation runs before the transform, so an
 * over-length entry or too many entries produce a clear error rather than
 * silent truncation or filtering.
 */
function tagListField() {
  return z
    .array(z.string().trim().min(1).max(60))
    .max(20)
    .transform((arr) => normalizeTagList(arr))
    .optional()
    .default([]);
}

/**
 * Base object schema for menu-item fields (shared by create and patch).
 * NOT exported for direct use — use the strict create/patch schemas below.
 */
const menuItemFieldsSchema = z.object({
  menuId: z.string().uuid(),
  sectionId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(MENU_LIMITS.menuItemName),
  description: z.string().trim().max(MENU_LIMITS.description).optional().default(""),
  priceCents: z.number().int().min(0).max(MAX_PRICE_CENTS),
  category: menuCategorySchema,
  imageUrl: nullableTrimmedString(MENU_LIMITS.imageUrl),
  imageAlt: nullableTrimmedString(MENU_LIMITS.imageAlt),
  dietaryTags: tagListField(),
  allergens: tagListField(),
  isActive: z.boolean().optional().default(true),
  isFeatured: z.boolean().optional().default(false),
  displayOrder: z.number().int().min(0).optional().default(0),
});

/**
 * Strict menu-item CREATE schema. Contains only intended item fields.
 * `.strict()` rejects status, id, audit fields, timestamps, and any other
 * protected field. The server handler/repository forces isActive=true on
 * creation — a caller cannot create an inactive item by supplying isActive.
 * (isActive is accepted here only for the invariant transaction helper that
 * seeds a replacement item; the repository ignores it and forces true.)
 */
export const menuItemCreateSchema = menuItemFieldsSchema
  .omit({ isActive: true })
  .strict()
  .superRefine((val, ctx) => {
    // Accessibility rule: a present (nonblank) image requires nonblank alt text.
    const hasImage = val.imageUrl != null && val.imageUrl !== "";
    const hasAlt = val.imageAlt != null && val.imageAlt !== "";
    if (hasImage && !hasAlt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imageAlt"],
        message: "Descriptive alt text is required when an image is provided.",
      });
    }
  });

/**
 * Strict menu-item PATCH schema. Contains only editable item fields.
 * `.strict()` rejects menuId, id, isActive, audit fields, and timestamps.
 * menuId is fixed at creation (moving items across menus is not supported in
 * this phase); activation changes must use setItemActive. The accessibility
 * rule is enforced only when a non-null image is supplied without alt text;
 * clearing the image (null) is allowed and permits clearing alt text.
 */
export const menuItemPatchSchema = menuItemFieldsSchema
  .omit({ menuId: true, isActive: true })
  .partial()
  .strict()
  .superRefine((val, ctx) => {
    if (val.imageUrl != null && val.imageUrl !== "") {
      if (val.imageAlt != null && val.imageAlt === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["imageAlt"],
          message: "Descriptive alt text is required when an image is provided.",
        });
      }
    }
  });

/**
 * Legacy input schema retained for backward compatibility with existing
 * tests and the invariant transaction helper. New code should use
 * menuItemCreateSchema / menuItemPatchSchema.
 */
export const menuItemInputObjectSchema = menuItemFieldsSchema;

export const menuItemInputSchema = menuItemFieldsSchema.superRefine((val, ctx) => {
  // Accessibility rule: a present (nonblank) image requires nonblank alt text.
  const hasImage = val.imageUrl != null && val.imageUrl !== "";
  const hasAlt = val.imageAlt != null && val.imageAlt !== "";
  if (hasImage && !hasAlt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["imageAlt"],
      message: "Descriptive alt text is required when an image is provided.",
    });
  }
});

export type MenuInputSchema = z.infer<typeof menuInputSchema>;
export type MenuPatchSchema = z.infer<typeof menuPatchSchema>;
export type MenuSectionInputSchema = z.infer<typeof menuSectionInputSchema>;
export type MenuSectionCreateSchema = z.infer<typeof menuSectionCreateSchema>;
export type MenuSectionPatchSchema = z.infer<typeof menuSectionPatchSchema>;
export type MenuItemInputSchema = z.infer<typeof menuItemInputSchema>;
export type MenuItemCreateSchema = z.infer<typeof menuItemCreateSchema>;
export type MenuItemPatchSchema = z.infer<typeof menuItemPatchSchema>;

/**
 * Publishing rule: a published menu must not be archived, and a scheduled
 * unpublish must not precede its publish. Returns a list of human-readable
 * violations (empty when valid).
 */
export function publishingRuleViolations(input: {
  status: string;
  publishAt?: string | null;
  unpublishAt?: string | null;
}): string[] {
  const violations: string[] = [];
  if (input.status === "archived") {
    // archiving is allowed, but a menu cannot be both archived and scheduled.
    if (input.publishAt || input.unpublishAt) {
      violations.push("An archived menu cannot carry publish or unpublish dates.");
    }
  }
  if (input.publishAt && input.unpublishAt) {
    if (new Date(input.unpublishAt) <= new Date(input.publishAt)) {
      violations.push("Unpublish date must be later than the publish date.");
    }
  }
  return violations;
}
