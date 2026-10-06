import { z } from "zod";
import { normalizeSlug } from "@/lib/menu/constants";
import { MAX_PRICE_CENTS } from "@/lib/menu/constants";

export const feastOfferingSlugSchema = z
  .string()
  .trim()
  .min(1, "Slug is required")
  .max(120, "Slug must be 120 characters or fewer")
  .transform((v) => normalizeSlug(v));

export const createFeastOfferingSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(120, "Name must be 120 characters or fewer"),
    slug: feastOfferingSlugSchema,
    description: z.string().max(2000, "Description must be 2000 characters or fewer").default(""),
    pricePerPersonCents: z
      .number()
      .int()
      .min(0, "Price cannot be negative")
      .max(MAX_PRICE_CENTS, "Price exceeds safety maximum")
      .nullable()
      .optional()
      .default(null),
    inclusions: z
      .array(z.string().trim().min(1).max(200))
      .max(20, "Maximum 20 inclusions permitted")
      .default([]),
    coverImageUrl: z.string().trim().url("Invalid image URL").nullable().optional().default(null),
    coverImageAlt: z
      .string()
      .trim()
      .max(300, "Alt text must be 300 characters or fewer")
      .nullable()
      .optional()
      .default(null),
    isPublished: z.boolean().default(false),
    displayOrder: z.number().int().min(0, "Display order must be non-negative").default(0),
  })
  .superRefine((val, ctx) => {
    const hasUrl = Boolean(val.coverImageUrl && val.coverImageUrl.trim().length > 0);
    const hasAlt = Boolean(val.coverImageAlt && val.coverImageAlt.trim().length > 0);
    if (hasUrl && !hasAlt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["coverImageAlt"],
        message: "Alt text is required when a cover image is provided",
      });
    }
  });

export const updateFeastOfferingSchema = z
  .object({
    id: z.string().uuid("Invalid offering ID"),
    expectedUpdatedAt: z.string().min(1, "expectedUpdatedAt is required for concurrency control"),
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(120, "Name must be 120 characters or fewer")
      .optional(),
    slug: feastOfferingSlugSchema.optional(),
    description: z.string().max(2000, "Description must be 2000 characters or fewer").optional(),
    pricePerPersonCents: z
      .number()
      .int()
      .min(0, "Price cannot be negative")
      .max(MAX_PRICE_CENTS, "Price exceeds safety maximum")
      .nullable()
      .optional(),
    inclusions: z
      .array(z.string().trim().min(1).max(200))
      .max(20, "Maximum 20 inclusions permitted")
      .optional(),
    coverImageUrl: z.string().trim().url("Invalid image URL").nullable().optional(),
    coverImageAlt: z
      .string()
      .trim()
      .max(300, "Alt text must be 300 characters or fewer")
      .nullable()
      .optional(),
    isPublished: z.boolean().optional(),
    displayOrder: z.number().int().min(0, "Display order must be non-negative").optional(),
  })
  .superRefine((val, ctx) => {
    if (val.coverImageUrl !== undefined && val.coverImageAlt !== undefined) {
      const hasUrl = Boolean(val.coverImageUrl && val.coverImageUrl.trim().length > 0);
      const hasAlt = Boolean(val.coverImageAlt && val.coverImageAlt.trim().length > 0);
      if (hasUrl && !hasAlt) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["coverImageAlt"],
          message: "Alt text is required when a cover image is provided",
        });
      }
    }
  });
