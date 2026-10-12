/**
 * Reservation model — validation schemas (client-safe, framework-independent).
 *
 * Authoritative validation lives on the server (the repository re-validates
 * before writing). The server recalculates prices authoritatively; client
 * prices/totals/actors are never trusted.
 *
 * Party composition: adults + seniors + children must equal partySize.
 * Quantities are positive integers.
 */
import { z } from "zod";
import { GUEST_CATEGORIES } from "@/lib/ordering/constants";

const RESERVATION_NUMBER_RE = /^SDS-\d{8}-[A-Z0-9]{4}$/;
const NAME_RE = /^[\p{L}\p{M}'’.\- ]{1,120}$/u;
const PHONE_RE = /^[+]?[\d\s().-]{7,40}$/;

const includedSelectionSchema = z.object({
  menuItemId: z.string().uuid("Invalid menu item"),
  selectionCategory: z.enum(["meat", "side", "bread", "drink"]),
});

const guestInputSchema = z.object({
  guestIndex: z.number().int().min(0),
  // Pass the readonly literal tuple directly so z.enum infers the exact
  // GuestCategory union ("adult" | "senior" | "child") rather than widening
  // to string through an `as unknown as [string, ...string[]]` cast.
  category: z.enum(GUEST_CATEGORIES),
  name: z.string().max(160).optional(),
  packageId: z.string().uuid("Invalid package"),
  included: z.array(includedSelectionSchema),
  addons: z.array(
    z.object({
      addonId: z.string().uuid("Invalid add-on"),
      quantity: z.number().int().min(1, "Quantity must be at least 1"),
    }),
  ),
  // Per-guest notes — optional for backward compatibility with older callers.
  // Missing values default to empty strings on the server. Strings only, max
  // 1,000 characters each. Null and non-string values are rejected.
  foodAllergies: z.string().max(1000, "Allergy notes must be 1,000 characters or fewer").optional(),
  dietaryPreferences: z
    .string()
    .max(1000, "Dietary preferences must be 1,000 characters or fewer")
    .optional(),
  mealRequests: z.string().max(1000, "Meal requests must be 1,000 characters or fewer").optional(),
});

export const submitReservationRequestSchema = z
  .object({
    sundayServiceId: z.string().uuid("Invalid Sunday service"),
    seatingTimeId: z.string().uuid("Invalid seating time"),
    experienceType: z.enum(["standard", "private_room"]),
    partySize: z
      .number()
      .int()
      .min(1, "Party must include at least one guest")
      .max(950, "Party exceeds venue capacity"),
    adults: z.number().int().min(0),
    seniors: z.number().int().min(0),
    children: z.number().int().min(0),
    contactFirstName: z
      .string()
      .trim()
      .min(1, "First name is required")
      .max(120)
      .regex(NAME_RE, "Enter a valid first name"),
    contactLastName: z
      .string()
      .trim()
      .min(1, "Last name is required")
      .max(120)
      .regex(NAME_RE, "Enter a valid last name"),
    contactEmail: z
      .string()
      .trim()
      .min(1, "Email is required")
      .max(320)
      .email("Enter a valid email"),
    contactPhone: z
      .string()
      .trim()
      .min(1, "Phone is required")
      .max(40)
      .regex(PHONE_RE, "Enter a valid phone number"),
    guestNotes: z.string().max(2000).optional(),
    dietaryNotes: z.string().max(2000).optional(),
    accessibilityRequests: z.string().max(2000).optional(),
    occasion: z.string().max(160).optional(),
    guests: z.array(guestInputSchema),
    platters: z.array(
      z.object({
        platterId: z.string().uuid("Invalid platter"),
        quantity: z.number().int().min(1, "Quantity must be at least 1"),
      }),
    ),
    idempotencyKey: z.string().min(8, "Missing request key").max(120),
    clientPreviewSubtotalCents: z.number().int().min(0).optional(),
    clientPreviewPrice: z
      .object({
        subtotalCents: z.number().int().min(0),
        gratuityCents: z.number().int().min(0),
        taxCents: z.number().int().min(0),
        grandTotalCents: z.number().int().min(0),
        depositRequiredCents: z.number().int().min(0),
        appliedGratuityRateBasisPoints: z.number().int().min(0).max(10000),
        appliedTaxRateBasisPoints: z.number().int().min(0).max(10000),
        appliedTaxOnGratuity: z.boolean(),
        appliedDepositPercent: z.number().min(0).max(100),
      })
      .optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    // Composition must sum to party size.
    if (val.adults + val.seniors + val.children !== val.partySize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["partySize"],
        message: "Adults, seniors, and children must add up to the total party size.",
      });
    }
    // One guest allocation per party member.
    if (val.guests.length !== val.partySize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["guests"],
        message: "Each guest must have a meal allocation.",
      });
    }
    // Guest indices unique and in range.
    const indices = val.guests.map((g) => g.guestIndex);
    if (
      new Set(indices).size !== indices.length ||
      indices.some((i) => i < 0 || i >= val.partySize)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["guests"],
        message: "Guest allocations must be uniquely indexed.",
      });
    }
  });

export const listReservationsSchema = z
  .object({
    sundayServiceId: z.string().uuid().optional(),
    seatingTimeId: z.string().uuid().optional(),
    status: z
      .enum([
        "pending_review",
        "confirmed",
        "balance_due",
        "paid_in_full",
        "ready_for_service",
        "checked_in",
        "seated",
        "completed",
        "transfer_requested",
        "cancellation_requested",
        "cancelled",
        "no_show",
        "refund_review",
      ])
      .optional(),
    search: z.string().max(120).optional(),
  })
  .strict();

export type SubmitReservationRequestSchema = z.infer<typeof submitReservationRequestSchema>;
export type ListReservationsSchema = z.infer<typeof listReservationsSchema>;

/** Validate a generated reservation number format (server-side only). */
export function isValidReservationNumber(v: string): boolean {
  return RESERVATION_NUMBER_RE.test(v);
}

/** Reservation number format: SDS-YYYYMMDD-XXXX (date + 4 alphanumeric). */
export function generateReservationNumber(): string {
  const date = new Date();
  const yyyy = date.getUTCFullYear().toString();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `SDS-${yyyy}${mm}${dd}-${suffix}`;
}
