/**
 * Centralized waitlist constants — consent text, versions, policy versions,
 * status values, and party-size boundaries.
 *
 * Client-safe (no secrets). The exact consent text displayed to the user is
 * retained verbatim when consent is granted.
 */

export const PARTY_MIN = 1;
export const PARTY_MAX = 20;

export const WAITLIST_STATUSES = [
  "new",
  "contacted",
  "invited",
  "booked",
  "not_interested",
  "invalid",
  "archived",
] as const;

export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

/**
 * Provisional SMS consent language. Versioned so the exact text a guest
 * agreed to is preserved alongside the consent record.
 */
export const SMS_CONSENT_TEXT =
  "By checking this box, I agree to receive recurring informational and promotional text messages from Sit Down Sundays at the mobile number provided. Consent is not a condition of purchase. Message frequency varies. Message and data rates may apply. Reply STOP to opt out and HELP for help. View our Terms and Privacy Policy.";

export const SMS_CONSENT_TEXT_VERSION = "sms_consent_v1";

/**
 * Provisional email-marketing consent language. Versioned so the exact text a
 * guest agreed to is preserved alongside the consent record.
 */
export const EMAIL_CONSENT_TEXT =
  "By checking this box, I agree to receive occasional informational and promotional email messages from Sit Down Sundays at the email address provided. Consent is not a condition of joining the waitlist. You can unsubscribe at any time. View our Terms and Privacy Policy.";

export const EMAIL_CONSENT_TEXT_VERSION = "email_consent_v1";

/** Provisional policy versions. Will be managed via CMS in a later phase. */
export const PRIVACY_POLICY_VERSION = "privacy_v1";
export const TERMS_VERSION = "terms_v1";

/** Default source label for public waitlist submissions. */
export const WAITLIST_DEFAULT_SOURCE = "public_waitlist";

/**
 * Consent state used by the merge helper. Captures the material consent
 * fields, their evidence text + version, and evidence timestamps.
 */
export interface ConsentState {
  emailMarketingConsent: boolean;
  emailConsentText: string | null;
  emailConsentTextVersion: string | null;
  emailConsentTimestamp: string | null;
  smsConsent: boolean;
  smsConsentText: string | null;
  smsConsentTextVersion: string | null;
  smsConsentTimestamp: string | null;
}

/**
 * Merge incoming consent into existing consent without ever downgrading.
 *
 * Rules:
 *  - A previous opt-in is never removed by a later submission that omits it.
 *  - Consent is only newly established when the incoming submission explicitly
 *    checks a box that was previously unchecked.
 *  - When consent is newly established, the incoming (server-generated)
 *    timestamp and incoming consent text + version are recorded as evidence.
 *  - When consent already existed, the original evidence (text, version,
 *    timestamp) is preserved.
 */
export function mergeConsent(existing: ConsentState, incoming: ConsentState): ConsentState {
  const smsNewlyConsented = incoming.smsConsent && !existing.smsConsent;
  const emailNewlyConsented = incoming.emailMarketingConsent && !existing.emailMarketingConsent;

  const sms = existing.smsConsent || incoming.smsConsent;
  const email = existing.emailMarketingConsent || incoming.emailMarketingConsent;

  return {
    emailMarketingConsent: email,
    emailConsentText: email
      ? emailNewlyConsented
        ? incoming.emailConsentText
        : existing.emailConsentText
      : null,
    emailConsentTextVersion: email
      ? emailNewlyConsented
        ? incoming.emailConsentTextVersion
        : existing.emailConsentTextVersion
      : null,
    emailConsentTimestamp: email
      ? emailNewlyConsented
        ? incoming.emailConsentTimestamp
        : existing.emailConsentTimestamp
      : null,
    smsConsent: sms,
    smsConsentText: sms
      ? smsNewlyConsented
        ? incoming.smsConsentText
        : existing.smsConsentText
      : null,
    smsConsentTextVersion: sms
      ? smsNewlyConsented
        ? incoming.smsConsentTextVersion
        : existing.smsConsentTextVersion
      : null,
    smsConsentTimestamp: sms
      ? smsNewlyConsented
        ? incoming.smsConsentTimestamp
        : existing.smsConsentTimestamp
      : null,
  };
}
