/**
 * Analytics extension points for the waitlist flow.
 *
 * No third-party analytics service is connected in this phase. `trackAnalytics`
 * is a labeled no-op hook (dev console.debug only) that future phases can wire
 * to a real provider. It MUST NEVER carry personal information.
 */
import type { NormalizedWaitlistInput, WaitlistRecord } from "./types";

export type WaitlistAnalyticsEvent =
  | "waitlist_viewed"
  | "waitlist_started"
  | "waitlist_validation_failed"
  | "waitlist_submitted"
  | "waitlist_succeeded"
  | "waitlist_failed"
  | "private_room_interest_selected"
  | "email_consent_selected"
  | "sms_consent_selected";

export interface AnalyticsContext {
  partySize?: number;
  privateRoomInterest?: boolean;
  emailConsent?: boolean;
  smsConsent?: boolean;
  hasUtm?: boolean;
  utmSource?: string | null;
  utmCampaign?: string | null;
  errorFields?: string[];
}

/**
 * Build a PII-free analytics payload. Explicitly excludes names, email,
 * phone, free-form notes, and full referral URLs.
 */
export function buildAnalyticsPayload(
  event: WaitlistAnalyticsEvent,
  ctx: AnalyticsContext = {},
): Record<string, unknown> {
  return {
    event,
    partySize: ctx.partySize ?? null,
    privateRoomInterest: ctx.privateRoomInterest ?? false,
    emailConsent: ctx.emailConsent ?? false,
    smsConsent: ctx.smsConsent ?? false,
    hasUtm: ctx.hasUtm ?? false,
    utmSource: ctx.utmSource ?? null,
    utmCampaign: ctx.utmCampaign ?? null,
    errorFields: ctx.errorFields ?? null,
    // Intentionally absent: firstName, lastName, email, phone, notes,
    // referralUrl, and any free-form text.
  };
}

/** Labeled extension point — no-op in Phase 2A. Never sends PII. */
export function trackAnalytics(
  event: WaitlistAnalyticsEvent,
  payload: Record<string, unknown> = {},
): void {
  if (process.env.NODE_ENV !== "production") {
    console.debug(`[analytics:${event}]`, payload);
  }
  // Future phase: forward `payload` to an analytics provider.
}

/** Convenience: derive analytics context from a normalized input. */
export function analyticsContextFromInput(input: NormalizedWaitlistInput): AnalyticsContext {
  return {
    partySize: input.partySize,
    privateRoomInterest: input.privateRoomInterest,
    emailConsent: input.emailMarketingConsent,
    smsConsent: input.smsConsent,
    hasUtm: Boolean(input.utmSource || input.utmCampaign || input.utmMedium),
    utmSource: input.utmSource,
    utmCampaign: input.utmCampaign,
  };
}

/** Convenience: derive analytics context from a built record. */
export function analyticsContextFromRecord(record: WaitlistRecord): AnalyticsContext {
  return {
    partySize: record.partySize,
    privateRoomInterest: record.privateRoomInterest,
    emailConsent: record.emailMarketingConsent,
    smsConsent: record.smsConsent,
    hasUtm: Boolean(record.utmSource || record.utmCampaign || record.utmMedium),
    utmSource: record.utmSource,
    utmCampaign: record.utmCampaign,
  };
}
