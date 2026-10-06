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

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const createSundayServiceSchema = z.object({
  date: z.string().regex(dateRegex, "Use a valid date (YYYY-MM-DD)."),
  label: z.string().trim().max(120).optional(),
  status: z.enum(SUNDAY_STATUSES as [string, ...string[]]).optional(),
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
  status: z.enum(SUNDAY_STATUSES as [string, ...string[]]).optional(),
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
  seats: z.enum(TABLE_SIZES as [number, ...number[]]),
  zone: z.string().trim().max(120).optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).optional(),
});

export const updateDiningTableSchema = z.object({
  id: z.string().uuid(),
  expectedUpdatedAt: z.string().min(1),
  label: z.string().trim().min(1).max(120).optional(),
  seats: z.enum(TABLE_SIZES as [number, ...number[]]).optional(),
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
