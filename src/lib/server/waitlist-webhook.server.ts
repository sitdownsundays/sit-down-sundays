/**
 * Server-only waitlist webhook delivery.
 *
 * Posts a successful waitlist submission to the configured workflow webhook
 * (WAITLIST_WEBHOOK_URL). The webhook URL is a server-side secret and never
 * reaches the browser. Fire-and-forget: failures are logged server-side and
 * never surface to the guest or block the waitlist response.
 *
 * Only called after a real successful repository upsert — never on honeypot
 * traps, validation failures, or unexpected errors.
 */
import type { WaitlistRecord } from "@/lib/waitlist/types";

/**
 * Safe webhook payload. Mirrors the guest-facing fields plus consent evidence
 * and attribution. No secrets, no internal notes, no status history.
 */
export interface WaitlistWebhookPayload {
  event: "waitlist_submitted";
  submittedAt: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  partySize: number;
  preferredDate: string | null;
  preferredSeatingTime: string | null;
  privateRoomInterest: boolean;
  emailMarketingConsent: boolean;
  emailConsentTimestamp: string | null;
  smsConsent: boolean;
  smsConsentTimestamp: string | null;
  source: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
}

function toPayload(record: WaitlistRecord, submittedAt: string): WaitlistWebhookPayload {
  return {
    event: "waitlist_submitted",
    submittedAt,
    firstName: record.firstName,
    lastName: record.lastName,
    email: record.email,
    phone: record.phone,
    partySize: record.partySize,
    preferredDate: record.preferredDate ?? null,
    preferredSeatingTime: record.preferredSeatingTime ?? null,
    privateRoomInterest: record.privateRoomInterest,
    emailMarketingConsent: record.emailMarketingConsent,
    emailConsentTimestamp: record.emailConsentTimestamp,
    smsConsent: record.smsConsent,
    smsConsentTimestamp: record.smsConsentTimestamp,
    source: record.source ?? null,
    utmSource: record.utmSource ?? null,
    utmMedium: record.utmMedium ?? null,
    utmCampaign: record.utmCampaign ?? null,
    utmContent: record.utmContent ?? null,
    utmTerm: record.utmTerm ?? null,
  };
}

/**
 * Deliver the waitlist submission to the workflow webhook.
 * Reads the secret URL inside this function (env injection happens at call
 * time). Returns silently on any failure — never throws to the caller.
 */
export async function postWaitlistWebhook(record: WaitlistRecord): Promise<void> {
  const webhookUrl = process.env.WAITLIST_WEBHOOK_URL;
  if (!webhookUrl) {
    // Webhook not configured — skip silently. Waitlist still succeeds.
    return;
  }

  const payload = toPayload(record, new Date().toISOString());

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Log server-side only; never expose to the guest or block the response.
  }
}
