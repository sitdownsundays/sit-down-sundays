/**
 * Sundays & Seating — Zod validation schemas.
 *
 * Strict server-side validation. Protected fields (ids, timestamps, audit
 * fields) are never accepted from the browser.
 */
import { z } from "zod";
import {
  SUNDAY_STATUSES,
  TABLE_SIZES,
  DEFAULT_DEPOSIT_PERCENT,
  DEFAULT_BALANCE_DEADLINE_HOURS,
} from "./constants";
import type { SundayStatus } from "./constants";

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const sundayStatusEnum = z.enum(SUNDAY_STATUSES as [SundayStatus, ...SundayStatus[]]);

/** Numeric table-size schema accepting exactly 4, 6, 8, 10, or 12. */
const tableSizeSchema = z
  .number()
  .int()
  .refine(
    (n): n is (typeof TABLE_SIZES)[number] => (TABLE_SIZES as readonly number[]).includes(n),
    "Select a supported table size (4, 6, 8, 10, or 12).",
  );

export const createSundayServiceSchema = z.object({
  date: z.string().regex(dateRegex, "Use a valid date (YYYY-MM-DD)."),
  label: z.string().trim().max(120).optional(),
  status: sundayStatusEnum.optional(),
  spaceId: z.string().uuid("Select a venue space."),
  onlineBookingLimit: z.number().int().min(0).max(10000).nullable().optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export const updateSundayServiceSchema = z.object({
  id: z.string().uuid(),
  expectedUpdatedAt: z.string().min(1),
  date: z.string().regex(dateRegex).optional(),
  label: z.string().trim().max(120).optional(),
  status: sundayStatusEnum.optional(),
  spaceId: z.string().uuid().optional(),
  onlineBookingLimit: z.number().int().min(0).max(10000).nullable().optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export const createSeatingTimeSchema = z.object({
  sundayServiceId: z.string().uuid("Select a Sunday service."),
  label: z.string().trim().min(1, "Label is required.").max(120),
  startTime: z.string().regex(timeRegex, "Use HH:MM (24-hour)."),
  endTime: z.string().regex(timeRegex, "Use HH:MM (24-hour)."),
  onlineBookingLimit: z.number().int().min(0).max(10000).nullable().optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export const updateSeatingTimeSchema = z.object({
  id: z.string().uuid(),
  expectedUpdatedAt: z.string().min(1),
  label: z.string().trim().min(1).max(120).optional(),
  startTime: z.string().regex(timeRegex).optional(),
  endTime: z.string().regex(timeRegex).optional(),
  onlineBookingLimit: z.number().int().min(0).max(10000).nullable().optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export const createDiningTableSchema = z.object({
  spaceId: z.string().uuid("Select a venue space."),
  label: z.string().trim().min(1, "Label is required.").max(120),
  seats: tableSizeSchema,
  zone: z.string().trim().max(120).optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export const updateDiningTableSchema = z.object({
  id: z.string().uuid(),
  expectedUpdatedAt: z.string().min(1),
  label: z.string().trim().min(1).max(120).optional(),
  seats: tableSizeSchema.optional(),
  zone: z.string().trim().max(120).optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export const updatePaymentPolicySchema = z.object({
  expectedUpdatedAt: z.string().min(1),
  depositPercent: z.number().min(0).max(100),
  defaultBalanceDeadlineHours: z.number().int().min(0).max(720),
  restaurantTimezone: z.string().trim().max(120).nullable(),
});

export type CreateSundayServiceInput = z.infer<typeof createSundayServiceSchema>;
export type UpdateSundayServiceInput = z.infer<typeof updateSundayServiceSchema>;
export type CreateSeatingTimeInput = z.infer<typeof createSeatingTimeSchema>;
export type UpdateSeatingTimeInput = z.infer<typeof updateSeatingTimeSchema>;
export type CreateDiningTableInput = z.infer<typeof createDiningTableSchema>;
export type UpdateDiningTableInput = z.infer<typeof updateDiningTableSchema>;
export type UpdatePaymentPolicyInput = z.infer<typeof updatePaymentPolicySchema>;

export { DEFAULT_DEPOSIT_PERCENT, DEFAULT_BALANCE_DEADLINE_HOURS };

/* ----------------------------- Table assignments ----------------------------- */

/**
 * Browser input for assigning a reservation to physical tables.
 *
 * Only reservationId, tableIds, and expectedUpdatedAt are accepted. Actor
 * identity, room, capacity, status, and seating timestamps are NEVER accepted
 * from the browser — the RPC derives them authoritatively and the wrapper
 * supplies the verified session user ID.
 *
 * An empty tableIds array explicitly means "release all current assignments".
 * Duplicate table IDs are rejected.
 */
export const assignTablesSchema = z
  .object({
    reservationId: z.string().uuid("Select a valid reservation."),
    tableIds: z.array(z.string().uuid()).max(100),
    expectedUpdatedAt: z
      .string()
      .min(1)
      .refine((v) => isValidOffsetOrZTimestamp(v), {
        message: "Provide a valid timestamp with a timezone (Z or numeric offset).",
      }),
  })
  .strict()
  .refine((d) => new Set(d.tableIds).size === d.tableIds.length, {
    message: "Duplicate table selections are not allowed.",
    path: ["tableIds"],
  });

export type AssignTablesInput = z.infer<typeof assignTablesSchema>;

export const confirmReservationSchema = z
  .object({
    reservationId: z.string().uuid("Select a valid reservation."),
    expectedUpdatedAt: z
      .string()
      .min(1)
      .refine((v) => isValidOffsetOrZTimestamp(v), {
        message: "Provide a valid timestamp with a timezone (Z or numeric offset).",
      }),
  })
  .strict();

export type ConfirmReservationInput = z.infer<typeof confirmReservationSchema>;

export const cancelReservationSchema = z
  .object({
    reservationId: z.string().uuid("Select a valid reservation."),
    expectedUpdatedAt: z
      .string()
      .min(1)
      .refine((v) => isValidOffsetOrZTimestamp(v), {
        message: "Provide a valid timestamp with a timezone (Z or numeric offset).",
      }),
    reason: z
      .string()
      .min(1, "A cancellation reason is required.")
      .max(1000, "Reason must be 1,000 characters or fewer.")
      .refine((v) => /\S/.test(v), {
        message: "Reason must contain at least one non-whitespace character.",
      }),
  })
  .strict();

export type CancelReservationInput = z.infer<typeof cancelReservationSchema>;

/**
 * Validate that a string is a parseable ISO 8601 timestamp that carries an
 * explicit timezone — either a trailing "Z" (UTC) or a numeric offset
 * (±HH:MM). Naive timestamps without a timezone ("2026-01-01T00:00:00") are
 * rejected so they are never silently interpreted in the server/browser host
 * timezone when forwarded to the RPC.
 *
 * Fractional seconds are permitted and preserved verbatim — the original
 * string is passed to the RPC; this validator never re-serializes the value
 * through JavaScript's Date, which would round/truncate the fractional part.
 */
export function isValidOffsetOrZTimestamp(value: string): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  // Must parse as a real date/time. Date accepts offset-bearing ISO strings.
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return false;
  // Reject timezone-less (naive) timestamps: require Z or a trailing offset.
  // Numeric offsets look like ±HH:MM or ±HHMM (possibly with a colon).
  if (!/[zZ]$/.test(value) && !/[+-]\d{2}:?\d{2}$/.test(value)) return false;
  return true;
}
