/**
 * Waitlist domain types — framework-independent, client-safe.
 * No secrets, no server-only imports. Shared by client and server code.
 */

/** Public-facing input accepted from the browser (after strict parsing). */
export interface WaitlistSubmitInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  partySize: number;
  preferredDate?: string | null;
  preferredSeatingTime?: string | null;
  privateRoomInterest: boolean;
  emailMarketingConsent: boolean;
  smsConsent: boolean;
  /** Honeypot — must always be empty. */
  website?: string | null;
  source?: string | null;
  referralUrl?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
}

/** Normalized input ready to be turned into a protected record. */
export interface NormalizedWaitlistInput {
  firstName: string;
  lastName: string;
  email: string;
  normalizedEmail: string;
  phone: string;
  normalizedPhone: string;
  partySize: number;
  preferredDate?: string | null;
  preferredSeatingTime?: string | null;
  privateRoomInterest: boolean;
  emailMarketingConsent: boolean;
  smsConsent: boolean;
  source?: string | null;
  referralUrl?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
}

/**
 * Protected waitlist record — built entirely server-side.
 * The browser never supplies protected fields (status, internal notes,
 * timestamps, consent text + versions, policy versions, audit fields, ids).
 *
 * IDENTITY MODEL
 *   normalized_email is the primary identity key. normalized_phone is a
 *   lookup field only — different people may share a household phone number,
 *   so phone never triggers an automatic merge.
 */
export interface WaitlistRecord {
  firstName: string;
  lastName: string;
  email: string;
  normalizedEmail: string;
  phone: string;
  normalizedPhone: string;
  partySize: number;
  preferredDate?: string | null;
  preferredSeatingTime?: string | null;
  privateRoomInterest: boolean;
  emailMarketingConsent: boolean;
  emailConsentText: string | null;
  emailConsentTextVersion: string | null;
  emailConsentTimestamp: string | null;
  smsConsent: boolean;
  smsConsentText: string | null;
  smsConsentTextVersion: string | null;
  smsConsentTimestamp: string | null;
  privacyPolicyVersion: string;
  termsVersion: string;
  source?: string | null;
  referralUrl?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  status: "new";
}

/** Neutral result returned to the browser. Never reveals DB membership. */
export type WaitlistSubmitResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; kind: "validation"; errors: Record<string, string> }
  | { ok: false; kind: "unexpected" };

/** Public configuration safe to expose to the browser (no secrets). */
export interface WaitlistPublicConfig {
  dataMode: "mock" | "supabase";
}
