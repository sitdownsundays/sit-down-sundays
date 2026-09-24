/**
 * Pure waitlist normalization & validation helpers.
 * Client-safe (no secrets, no I/O). Shared by client preview and server.
 */
import type { NormalizedWaitlistInput, WaitlistSubmitInput } from "./types";

/** Trim a name and collapse internal whitespace. */
export function trimName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Lowercase + trim an email for storage/lookup. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Normalize a phone number for storage: keep a leading "+" and all digits,
 * strip everything else. Returns "" when no digits are present.
 */
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return "";
  return plus + digits;
}

/** Validate an optional preferred date (YYYY-MM-DD, sane range). */
export function isValidPreferredDate(value: string | null | undefined): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const year = d.getUTCFullYear();
  const now = new Date();
  return year >= now.getUTCFullYear() - 2 && year <= now.getUTCFullYear() + 2;
}

/** Honeypot is triggered when the hidden field is non-empty. */
export function isHoneypotTriggered(value: string | null | undefined): boolean {
  return !!value && value.trim().length > 0;
}

/** Transform parsed input into a normalized input ready for record building. */
export function normalizeWaitlistInput(input: WaitlistSubmitInput): NormalizedWaitlistInput {
  return {
    firstName: trimName(input.firstName),
    lastName: trimName(input.lastName),
    email: input.email.trim().toLowerCase(),
    normalizedEmail: normalizeEmail(input.email),
    phone: input.phone.trim(),
    normalizedPhone: normalizePhone(input.phone),
    partySize: input.partySize,
    preferredDate: input.preferredDate ? input.preferredDate.trim() : null,
    preferredSeatingTime: input.preferredSeatingTime ? input.preferredSeatingTime.trim() : null,
    privateRoomInterest: input.privateRoomInterest,
    emailMarketingConsent: input.emailMarketingConsent,
    smsConsent: input.smsConsent,
    source: input.source ?? null,
    referralUrl: input.referralUrl ?? null,
    utmSource: input.utmSource ?? null,
    utmMedium: input.utmMedium ?? null,
    utmCampaign: input.utmCampaign ?? null,
    utmContent: input.utmContent ?? null,
    utmTerm: input.utmTerm ?? null,
  };
}
