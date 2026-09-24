/**
 * Waitlist public-input schema (zod) + structured parser.
 * Client-safe. Uses `.strict()` to reject unknown/protected fields.
 *
 * Protected fields (status, internal_notes, timestamps, consent versions,
 * audit fields, ids) are NOT in this schema, so any submission including
 * them is rejected.
 */
import { z } from "zod";
import { PARTY_MAX, PARTY_MIN } from "./constants";
import { isValidPreferredDate } from "./normalize";
import type { WaitlistSubmitInput } from "./types";

export const waitlistInputSchema = z
  .object({
    firstName: z.string().trim().min(1, "Please enter your first name.").max(80),
    lastName: z.string().trim().min(1, "Please enter your last name.").max(80),
    email: z.string().trim().toLowerCase().email("Please enter a valid email address.").max(254),
    phone: z
      .string()
      .trim()
      .min(7, "Please enter a valid mobile number.")
      .max(32, "Please enter a valid mobile number."),
    partySize: z
      .number()
      .int("Party size must be a whole number.")
      .min(PARTY_MIN, `Party size must be at least ${PARTY_MIN}.`)
      .max(PARTY_MAX, `Party size may not exceed ${PARTY_MAX}.`),
    preferredDate: z
      .string()
      .trim()
      .optional()
      .nullable()
      .refine((v) => isValidPreferredDate(v), "Please enter a valid date."),
    preferredSeatingTime: z.string().trim().max(60).optional().nullable(),
    privateRoomInterest: z.boolean().default(false),
    emailMarketingConsent: z.boolean().default(false),
    smsConsent: z.boolean().default(false),
    website: z.string().optional().nullable(),
    source: z.string().trim().max(60).optional().nullable(),
    referralUrl: z.string().trim().max(500).optional().nullable(),
    utmSource: z.string().trim().max(120).optional().nullable(),
    utmMedium: z.string().trim().max(120).optional().nullable(),
    utmCampaign: z.string().trim().max(120).optional().nullable(),
    utmContent: z.string().trim().max(120).optional().nullable(),
    utmTerm: z.string().trim().max(120).optional().nullable(),
  })
  .strict();

export type ParseResult =
  { success: true; data: WaitlistSubmitInput } | { success: false; errors: Record<string, string> };

function humanize(message: string): string {
  return message;
}

/** Strict parse returning structured, field-keyed errors (never throws). */
export function parseWaitlistInput(raw: unknown): ParseResult {
  const res = waitlistInputSchema.safeParse(raw);
  if (res.success) {
    return { success: true, data: res.data as WaitlistSubmitInput };
  }
  const errors: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key =
      issue.code === "unrecognized_keys" && issue.keys?.length
        ? issue.keys[0]
        : (issue.path[0]?.toString() ?? "_form");
    if (!errors[key]) {
      errors[key] = humanize(issue.message);
    }
  }
  return { success: false, errors };
}
