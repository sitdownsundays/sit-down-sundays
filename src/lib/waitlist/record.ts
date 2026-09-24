/**
 * Builds the protected WaitlistRecord from normalized input.
 * Client-safe (no secrets). Called server-side only.
 *
 * Consent timestamps, consent text + versions, and policy versions are
 * generated/attached here — never accepted from the browser.
 */
import {
  EMAIL_CONSENT_TEXT,
  EMAIL_CONSENT_TEXT_VERSION,
  PRIVACY_POLICY_VERSION,
  SMS_CONSENT_TEXT,
  SMS_CONSENT_TEXT_VERSION,
  TERMS_VERSION,
} from "./constants";
import type { NormalizedWaitlistInput, WaitlistRecord } from "./types";

export interface BuildRecordContext {
  /** ISO timestamp generated server-side. */
  now: string;
}

export function buildWaitlistRecord(
  input: NormalizedWaitlistInput,
  ctx: BuildRecordContext,
): WaitlistRecord {
  const emailConsentTimestamp = input.emailMarketingConsent ? ctx.now : null;
  const smsConsentTimestamp = input.smsConsent ? ctx.now : null;

  return {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    normalizedEmail: input.normalizedEmail,
    phone: input.phone,
    normalizedPhone: input.normalizedPhone,
    partySize: input.partySize,
    preferredDate: input.preferredDate,
    preferredSeatingTime: input.preferredSeatingTime,
    privateRoomInterest: input.privateRoomInterest,
    emailMarketingConsent: input.emailMarketingConsent,
    // Exact displayed consent text + version retained only when consented.
    emailConsentText: input.emailMarketingConsent ? EMAIL_CONSENT_TEXT : null,
    emailConsentTextVersion: input.emailMarketingConsent ? EMAIL_CONSENT_TEXT_VERSION : null,
    emailConsentTimestamp,
    smsConsent: input.smsConsent,
    smsConsentText: input.smsConsent ? SMS_CONSENT_TEXT : null,
    smsConsentTextVersion: input.smsConsent ? SMS_CONSENT_TEXT_VERSION : null,
    smsConsentTimestamp,
    privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    termsVersion: TERMS_VERSION,
    source: input.source,
    referralUrl: input.referralUrl,
    utmSource: input.utmSource,
    utmMedium: input.utmMedium,
    utmCampaign: input.utmCampaign,
    utmContent: input.utmContent,
    utmTerm: input.utmTerm,
    status: "new",
  };
}
