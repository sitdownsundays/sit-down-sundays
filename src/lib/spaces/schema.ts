/**
 * Venue Spaces — Zod validation schemas.
 *
 * Strict create/patch schemas. Protected fields (id, createdAt, updatedAt,
 * createdBy, updatedBy) are never accepted from the browser. is_active is
 * accepted only through the dedicated update patch (staff may toggle a space),
 * but server functions assign audit/identity fields themselves.
 */
import { z } from "zod";
import { feastOfferingSlugSchema } from "@/lib/feast/schema";
import { SPACE_TYPES, VENUE_SPACE_LIMITS } from "./constants";

// Reuse the canonical slug schema (same format as menus and feast offerings).
const spaceSlugSchema = feastOfferingSlugSchema;

export const createVenueSpaceSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(VENUE_SPACE_LIMITS.name, `Name must be ${VENUE_SPACE_LIMITS.name} characters or fewer`),
    slug: spaceSlugSchema,
    description: z
      .string()
      .max(VENUE_SPACE_LIMITS.description, "Description must be 2000 characters or fewer")
      .default(""),
    spaceType: z.enum(SPACE_TYPES).default("general_dining"),
    reportedCapacity: z.number().int().min(0, "Reported capacity cannot be negative").default(0),
    onlineBookingLimit: z
      .number()
      .int()
      .min(0, "Booking limit cannot be negative")
      .nullable()
      .optional()
      .default(null),
    isActive: z.boolean().default(true),
    displayOrder: z.number().int().min(0, "Display order must be non-negative").default(0),
  })
  .strict();

export const updateVenueSpaceSchema = z
  .object({
    id: z.string().uuid("Invalid space ID"),
    expectedUpdatedAt: z.string().min(1, "expectedUpdatedAt is required for concurrency control"),
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(VENUE_SPACE_LIMITS.name, `Name must be ${VENUE_SPACE_LIMITS.name} characters or fewer`)
      .optional(),
    slug: spaceSlugSchema.optional(),
    description: z
      .string()
      .max(VENUE_SPACE_LIMITS.description, "Description must be 2000 characters or fewer")
      .optional(),
    spaceType: z.enum(SPACE_TYPES).optional(),
    reportedCapacity: z.number().int().min(0, "Reported capacity cannot be negative").optional(),
    onlineBookingLimit: z
      .number()
      .int()
      .min(0, "Booking limit cannot be negative")
      .nullable()
      .optional(),
    isActive: z.boolean().optional(),
    displayOrder: z.number().int().min(0, "Display order must be non-negative").optional(),
  })
  .strict();
