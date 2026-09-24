/**
 * SERVER-ONLY — waitlist repository.
 *
 * Two implementations behind one interface:
 *  - MockWaitlistRepository: in-memory, local development only (APP_DATA_MODE=mock).
 *  - SupabaseWaitlistRepository: service-role client (APP_DATA_MODE=supabase).
 *
 * The server decides which repository is active. Browser code never chooses
 * the data mode and never imports this module.
 *
 * IDENTITY MODEL
 *  - normalized_email is the PRIMARY identity key.
 *  - normalized_phone is a lookup field only. Different people may share a
 *    household phone number, so phone is NEVER used to merge two entries.
 *  - Two entries are never merged solely because their phone numbers match.
 *
 * Duplicate handling (both implementations):
 *  - Match ONLY on normalized_email.
 *  - Return a neutral "duplicate" flag without revealing DB membership.
 *  - Never delete the original record.
 *  - Never downgrade existing consent (see mergeConsent).
 *  - Preserve evidence of material consent changes.
 *  - A matching phone with a DIFFERENT email creates a separate entry.
 *
 * Staff-facing read/mutation methods are declared on the interface for a
 * future authenticated phase but are NOT exposed through callable
 * unauthenticated server functions in Phase 2A.
 */
import { getAdminClient } from "./supabase-admin.server";
import { resolveDataMode } from "./env.server";
import { mergeConsent, type ConsentState } from "@/lib/waitlist/constants";
import type { WaitlistRecord } from "@/lib/waitlist/types";

export interface WaitlistInsertResult {
  /** Whether an existing record was matched (by normalized_email) and merged. */
  duplicate: boolean;
}

export interface WaitlistRepository {
  /** Duplicate-safe insert/merge (by normalized_email only). Never reveals membership. */
  upsert(input: WaitlistRecord): Promise<WaitlistInsertResult>;

  // --- Staff-facing (future authenticated phase) -------------------------
  // NOT callable through unauthenticated server functions in Phase 2A.
  listWaitlistEntries(): Promise<unknown[]>;
  getWaitlistEntry(id: string): Promise<unknown | null>;
  updateWaitlistStatus(id: string, status: string, reason?: string): Promise<void>;
  updateInternalNotes(id: string, notes: string): Promise<void>;
  exportWaitlistCsv(): Promise<string>;
}

/** Extract the consent state from a stored row for merging. */
interface StoredConsent {
  emailMarketingConsent: boolean;
  emailConsentText: string | null;
  emailConsentTextVersion: string | null;
  emailConsentTimestamp: string | null;
  smsConsent: boolean;
  smsConsentText: string | null;
  smsConsentTextVersion: string | null;
  smsConsentTimestamp: string | null;
}

function incomingConsent(input: WaitlistRecord): ConsentState {
  return {
    emailMarketingConsent: input.emailMarketingConsent,
    emailConsentText: input.emailConsentText,
    emailConsentTextVersion: input.emailConsentTextVersion,
    emailConsentTimestamp: input.emailConsentTimestamp,
    smsConsent: input.smsConsent,
    smsConsentText: input.smsConsentText,
    smsConsentTextVersion: input.smsConsentTextVersion,
    smsConsentTimestamp: input.smsConsentTimestamp,
  };
}

/* ----------------------------- Mock repository ----------------------------- */

interface MockRow extends WaitlistRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
}

class MockWaitlistRepository implements WaitlistRepository {
  private rows: MockRow[] = [];

  async upsert(input: WaitlistRecord): Promise<WaitlistInsertResult> {
    const now = new Date().toISOString();
    // Match ONLY on normalized_email. Phone is never an identity key.
    const existing = this.rows.find((r) => r.normalizedEmail === input.normalizedEmail);

    if (existing) {
      // Merge consent without downgrading. Preserve original record identity.
      const merged = mergeConsent(
        {
          emailMarketingConsent: existing.emailMarketingConsent,
          emailConsentText: existing.emailConsentText,
          emailConsentTextVersion: existing.emailConsentTextVersion,
          emailConsentTimestamp: existing.emailConsentTimestamp,
          smsConsent: existing.smsConsent,
          smsConsentText: existing.smsConsentText,
          smsConsentTextVersion: existing.smsConsentTextVersion,
          smsConsentTimestamp: existing.smsConsentTimestamp,
        },
        incomingConsent(input),
      );

      existing.firstName = input.firstName;
      existing.lastName = input.lastName;
      existing.email = input.email;
      // Phone is updated to the latest provided value for the same email identity.
      existing.phone = input.phone;
      existing.normalizedPhone = input.normalizedPhone;
      existing.partySize = input.partySize;
      existing.preferredDate = input.preferredDate;
      existing.preferredSeatingTime = input.preferredSeatingTime;
      existing.privateRoomInterest = existing.privateRoomInterest || input.privateRoomInterest;
      existing.emailMarketingConsent = merged.emailMarketingConsent;
      existing.emailConsentText = merged.emailConsentText;
      existing.emailConsentTextVersion = merged.emailConsentTextVersion;
      existing.emailConsentTimestamp = merged.emailConsentTimestamp;
      existing.smsConsent = merged.smsConsent;
      existing.smsConsentText = merged.smsConsentText;
      existing.smsConsentTextVersion = merged.smsConsentTextVersion;
      existing.smsConsentTimestamp = merged.smsConsentTimestamp;
      existing.updatedAt = now;
      return { duplicate: true };
    }

    // No email match — insert a brand-new entry, even if the phone matches an
    // existing row. Different people may share a household phone number.
    this.rows.push({
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    return { duplicate: false };
  }

  async listWaitlistEntries(): Promise<unknown[]> {
    return [...this.rows];
  }
  async getWaitlistEntry(): Promise<unknown | null> {
    return null;
  }
  async updateWaitlistStatus(): Promise<void> {}
  async updateInternalNotes(): Promise<void> {}
  async exportWaitlistCsv(): Promise<string> {
    return "";
  }
}

/* --------------------------- Supabase repository --------------------------- */

class SupabaseWaitlistRepository implements WaitlistRepository {
  async upsert(input: WaitlistRecord): Promise<WaitlistInsertResult> {
    const client = getAdminClient();

    // Find an existing row ONLY by normalized_email (the primary identity key).
    // Phone is never used to match — a shared household number must not merge
    // two different people.
    const { data: existingRows, error: findError } = await client
      .from("waitlist_entries")
      .select(
        "id, normalized_email, private_room_interest, email_marketing_consent, email_consent_text, email_consent_text_version, email_consent_timestamp, sms_consent, sms_consent_text, sms_consent_text_version, sms_consent_timestamp",
      )
      .eq("normalized_email", input.normalizedEmail)
      .limit(1);

    if (findError) {
      // Never surface raw DB errors to the browser.
      throw new Error("Waitlist submission could not be processed.");
    }

    const existing = (existingRows?.[0] ?? undefined) as
      | (StoredConsent & { id: string; normalized_email: string; private_room_interest: boolean })
      | undefined;

    if (existing) {
      // Merge consent without downgrading.
      const merged = mergeConsent(
        {
          emailMarketingConsent: existing.email_marketing_consent,
          emailConsentText: existing.email_consent_text,
          emailConsentTextVersion: existing.email_consent_text_version,
          emailConsentTimestamp: existing.email_consent_timestamp,
          smsConsent: existing.sms_consent,
          smsConsentText: existing.sms_consent_text,
          smsConsentTextVersion: existing.sms_consent_text_version,
          smsConsentTimestamp: existing.sms_consent_timestamp,
        },
        incomingConsent(input),
      );

      const { error: updateError } = await client
        .from("waitlist_entries")
        .update({
          first_name: input.firstName,
          last_name: input.lastName,
          email: input.email,
          phone: input.phone,
          normalized_phone: input.normalizedPhone,
          party_size: input.partySize,
          preferred_date: input.preferredDate,
          preferred_seating_time: input.preferredSeatingTime,
          private_room_interest: existing.private_room_interest || input.privateRoomInterest,
          email_marketing_consent: merged.emailMarketingConsent,
          email_consent_text: merged.emailConsentText,
          email_consent_text_version: merged.emailConsentTextVersion,
          email_consent_timestamp: merged.emailConsentTimestamp,
          sms_consent: merged.smsConsent,
          sms_consent_text: merged.smsConsentText,
          sms_consent_text_version: merged.smsConsentTextVersion,
          sms_consent_timestamp: merged.smsConsentTimestamp,
        })
        .eq("id", existing.id);

      if (updateError) {
        throw new Error("Waitlist submission could not be processed.");
      }
      return { duplicate: true };
    }

    // Insert a brand-new row. Protected fields (status, internal_notes,
    // timestamps, consent versions) come only from the server-built record.
    // A matching phone with a different email creates a separate entry.
    const { error: insertError } = await client.from("waitlist_entries").insert({
      first_name: input.firstName,
      last_name: input.lastName,
      email: input.email,
      normalized_email: input.normalizedEmail,
      phone: input.phone,
      normalized_phone: input.normalizedPhone,
      party_size: input.partySize,
      preferred_date: input.preferredDate,
      preferred_seating_time: input.preferredSeatingTime,
      private_room_interest: input.privateRoomInterest,
      email_marketing_consent: input.emailMarketingConsent,
      email_consent_text: input.emailConsentText,
      email_consent_text_version: input.emailConsentTextVersion,
      email_consent_timestamp: input.emailConsentTimestamp,
      sms_consent: input.smsConsent,
      sms_consent_text: input.smsConsentText,
      sms_consent_text_version: input.smsConsentTextVersion,
      sms_consent_timestamp: input.smsConsentTimestamp,
      privacy_policy_version: input.privacyPolicyVersion,
      terms_version: input.termsVersion,
      source: input.source,
      referral_url: input.referralUrl,
      utm_source: input.utmSource,
      utm_medium: input.utmMedium,
      utm_campaign: input.utmCampaign,
      utm_content: input.utmContent,
      utm_term: input.utmTerm,
      status: input.status,
    });

    if (insertError) {
      throw new Error("Waitlist submission could not be processed.");
    }
    return { duplicate: false };
  }

  // Staff-facing methods — NOT callable unauthenticated in Phase 2A.
  async listWaitlistEntries(): Promise<unknown[]> {
    throw new Error("Not available without authentication.");
  }
  async getWaitlistEntry(): Promise<unknown | null> {
    throw new Error("Not available without authentication.");
  }
  async updateWaitlistStatus(): Promise<void> {
    throw new Error("Not available without authentication.");
  }
  async updateInternalNotes(): Promise<void> {
    throw new Error("Not available without authentication.");
  }
  async exportWaitlistCsv(): Promise<string> {
    throw new Error("Not available without authentication.");
  }
}

/* ------------------------------ Dispatch --------------------------------- */

let mockInstance: MockWaitlistRepository | null = null;

/**
 * Reset the mock repository's in-memory state. Test-only helper used to keep
 * waitlist identity-model tests isolated. Has no effect in Supabase mode and
 * is never called by application code.
 */
export function __resetMockWaitlistRepository(): void {
  mockInstance = null;
}

/**
 * Return the active repository based on APP_DATA_MODE. The server decides;
 * the browser never chooses. Production cannot use mock mode (enforced in
 * resolveDataMode).
 */
export function getWaitlistRepository(): WaitlistRepository {
  const { dataMode } = resolveDataMode();
  if (dataMode === "mock") {
    if (!mockInstance) mockInstance = new MockWaitlistRepository();
    return mockInstance;
  }
  return new SupabaseWaitlistRepository();
}

export type { ConsentState };
