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

export const menuItemInputObjectSchema = z.object({
  menuId: z.string().uuid(),
  sectionId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(MENU_LIMITS.menuItemName),
  description: z.string().trim().max(MENU_LIMITS.description).optional().default(""),
  priceCents: z.number().int().min(0).max(MAX_PRICE_CENTS),
  category: menuCategorySchema,
  imageUrl: nullableTrimmedString(MENU_LIMITS.imageUrl),
  imageAlt: nullableTrimmedString(MENU_LIMITS.imageAlt),
  dietaryTags: z.array(z.string().trim().min(1).max(60)).max(20).optional().default([]),
  allergens: z.array(z.string().trim().min(1).max(60)).max(20).optional().default([]),
  isActive: z.boolean().optional().default(true),
  isFeatured: z.boolean().optional().default(false),
  displayOrder: z.number().int().min(0).optional().default(0),
});

export const menuItemInputSchema = menuItemInputObjectSchema.superRefine((val, ctx) => {
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
 * Patch schema for partial menu-item updates. All fields are optional. The
 * accessibility rule is enforced only when a non-null image is supplied in the
 * patch without accompanying alt text; clearing the image (null) is allowed.
 */
export const menuItemPatchSchema = menuItemInputObjectSchema.partial().superRefine((val, ctx) => {
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

export type MenuInputSchema = z.infer<typeof menuInputSchema>;
export type MenuPatchSchema = z.infer<typeof menuPatchSchema>;
export type MenuSectionInputSchema = z.infer<typeof menuSectionInputSchema>;
export type MenuItemInputSchema = z.infer<typeof menuItemInputSchema>;
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
