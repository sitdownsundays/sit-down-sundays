/**
 * Ordering model — validation schemas (client-safe, framework-independent).
 *
 * Authoritative validation lives on the server (the repository re-validates
 * before writing). These schemas are shared so the form layer and the server
 * layer agree on the rules. The database CHECK constraints in
 * 0009_ordering_model.sql are a third, independent enforcement layer.
 *
 * Strict schemas (.strict()) reject protected fields (id, audit fields,
 * timestamps, identity) from browser input. Optimistic concurrency is
 * enforced via required expectedUpdatedAt on every update.
 */
import { z } from "zod";
import { normalizeSlug } from "@/lib/menu/constants";
import {
  MAX_PRICE_CENTS,
  ORDERING_LIMITS,
  SELECTION_CATEGORIES,
  CHILD_RULE_TYPES,
} from "./constants";

const slugSchema = z
  .string()
  .trim()
  .min(1, "Slug is required")
  .max(ORDERING_LIMITS.slug, "Slug must be 120 characters or fewer")
  .transform((v) => normalizeSlug(v));

const eligibleItemSchema = z.object({
  menuItemId: z.string().uuid("Invalid menu item"),
  selectionCategory: z.enum(SELECTION_CATEGORIES as unknown as [string, ...string[]]),
});

/* ----------------------------- Packages ----------------------------- */

export const createMealPackageSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(ORDERING_LIMITS.name),
    slug: slugSchema,
    description: z.string().max(ORDERING_LIMITS.description).optional().default(""),
    pricePerPersonCents: z
      .number()
      .int("Price must be a whole number of cents")
      .min(0, "Price cannot be negative")
      .max(MAX_PRICE_CENTS, "Price exceeds the safety maximum"),
    includedMeatsCount: z.number().int().min(0, "Count cannot be negative"),
    includedSidesCount: z.number().int().min(0, "Count cannot be negative"),
    includesBread: z.boolean().optional().default(false),
    includesSoftDrink: z.boolean().optional().default(false),
    isActive: z.boolean().optional().default(true),
    displayOrder: z.number().int().min(0).optional().default(0),
    eligibleItems: z.array(eligibleItemSchema).optional().default([]),
  })
  .strict();

export const updateMealPackageSchema = z
  .object({
    id: z.string().uuid("Invalid package ID"),
    expectedUpdatedAt: z.string().min(1, "expectedUpdatedAt is required"),
    name: z.string().trim().min(1).max(ORDERING_LIMITS.name).optional(),
    slug: slugSchema.optional(),
    description: z.string().max(ORDERING_LIMITS.description).optional(),
    pricePerPersonCents: z.number().int().min(0).max(MAX_PRICE_CENTS).optional(),
    includedMeatsCount: z.number().int().min(0).optional(),
    includedSidesCount: z.number().int().min(0).optional(),
    includesBread: z.boolean().optional(),
    includesSoftDrink: z.boolean().optional(),
    isActive: z.boolean().optional(),
    displayOrder: z.number().int().min(0).optional(),
    eligibleItems: z.array(eligibleItemSchema).optional(),
  })
  .strict();

/* ----------------------------- Add-ons ----------------------------- */

export const createIndividualAddonSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(ORDERING_LIMITS.name),
    slug: slugSchema,
    description: z.string().max(ORDERING_LIMITS.description).optional().default(""),
    priceCents: z
      .number()
      .int("Price must be a whole number of cents")
      .min(0, "Price cannot be negative")
      .max(MAX_PRICE_CENTS, "Price exceeds the safety maximum"),
    isActive: z.boolean().optional().default(true),
    displayOrder: z.number().int().min(0).optional().default(0),
    eligiblePackageIds: z.array(z.string().uuid()).optional().default([]),
  })
  .strict();

export const updateIndividualAddonSchema = z
  .object({
    id: z.string().uuid("Invalid add-on ID"),
    expectedUpdatedAt: z.string().min(1, "expectedUpdatedAt is required"),
    name: z.string().trim().min(1).max(ORDERING_LIMITS.name).optional(),
    slug: slugSchema.optional(),
    description: z.string().max(ORDERING_LIMITS.description).optional(),
    priceCents: z.number().int().min(0).max(MAX_PRICE_CENTS).optional(),
    isActive: z.boolean().optional(),
    displayOrder: z.number().int().min(0).optional(),
    eligiblePackageIds: z.array(z.string().uuid()).optional(),
  })
  .strict();

/* ----------------------------- Platters ----------------------------- */

export const createSharedPlatterSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(ORDERING_LIMITS.name),
    slug: slugSchema,
    description: z.string().max(ORDERING_LIMITS.description).optional().default(""),
    pricePerPlatterCents: z
      .number()
      .int("Price must be a whole number of cents")
      .min(0, "Price cannot be negative")
      .max(MAX_PRICE_CENTS, "Price exceeds the safety maximum"),
    servingGuidance: z
      .string()
      .max(ORDERING_LIMITS.servingGuidance)
      .nullable()
      .optional()
      .default(null),
    isActive: z.boolean().optional().default(true),
    displayOrder: z.number().int().min(0).optional().default(0),
  })
  .strict();

export const updateSharedPlatterSchema = z
  .object({
    id: z.string().uuid("Invalid platter ID"),
    expectedUpdatedAt: z.string().min(1, "expectedUpdatedAt is required"),
    name: z.string().trim().min(1).max(ORDERING_LIMITS.name).optional(),
    slug: slugSchema.optional(),
    description: z.string().max(ORDERING_LIMITS.description).optional(),
    pricePerPlatterCents: z.number().int().min(0).max(MAX_PRICE_CENTS).optional(),
    servingGuidance: z.string().max(ORDERING_LIMITS.servingGuidance).nullable().optional(),
    isActive: z.boolean().optional(),
    displayOrder: z.number().int().min(0).optional(),
  })
  .strict();

/* ----------------------------- Guest pricing rules ----------------------------- */

/**
 * Cross-field validation: a child rule type other than 'none' must carry the
 * matching value. fixed_package_price requires childFixedPackagePriceCents;
 * percentage_discount requires childDiscountPercent. Missing rules stay
 * visibly unconfigured — never silently free or full-price.
 */
export const updateGuestPricingRulesSchema = z
  .object({
    expectedUpdatedAt: z.string().min(1, "expectedUpdatedAt is required"),
    seniorDiscountPercent: z.number().int().min(0).max(100).nullable(),
    seniorMinAge: z.number().int().min(0).nullable(),
    seniorAppliesToPackages: z.boolean().optional().default(true),
    seniorAppliesToAddons: z.boolean().optional().default(false),
    seniorAppliesToPlatters: z.boolean().optional().default(false),
    childRuleType: z.enum(CHILD_RULE_TYPES as unknown as [string, ...string[]]),
    childDiscountPercent: z.number().int().min(0).max(100).nullable(),
    childFixedPackagePriceCents: z.number().int().min(0).max(MAX_PRICE_CENTS).nullable(),
    childMaxAge: z.number().int().min(0).nullable(),
    childAppliesToPackages: z.boolean().optional().default(true),
    childAppliesToAddons: z.boolean().optional().default(false),
    childAppliesToPlatters: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.childRuleType === "fixed_package_price") {
      if (
        val.childFixedPackagePriceCents === null ||
        val.childFixedPackagePriceCents === undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["childFixedPackagePriceCents"],
          message:
            "A fixed child package price is required when the rule type is fixed package price.",
        });
      }
    }
    if (val.childRuleType === "percentage_discount") {
      if (val.childDiscountPercent === null || val.childDiscountPercent === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["childDiscountPercent"],
          message: "A discount percentage is required when the rule type is percentage discount.",
        });
      }
    }
    if (val.seniorDiscountPercent !== null && val.seniorMinAge === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["seniorMinAge"],
        message: "A qualifying age is required when a senior discount is configured.",
      });
    }
  });

export type CreateMealPackageSchema = z.infer<typeof createMealPackageSchema>;
export type UpdateMealPackageSchema = z.infer<typeof updateMealPackageSchema>;
export type CreateIndividualAddonSchema = z.infer<typeof createIndividualAddonSchema>;
export type UpdateIndividualAddonSchema = z.infer<typeof updateIndividualAddonSchema>;
export type CreateSharedPlatterSchema = z.infer<typeof createSharedPlatterSchema>;
export type UpdateSharedPlatterSchema = z.infer<typeof updateSharedPlatterSchema>;
export type UpdateGuestPricingRulesSchema = z.infer<typeof updateGuestPricingRulesSchema>;
