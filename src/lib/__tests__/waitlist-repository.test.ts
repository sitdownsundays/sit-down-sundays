/**
 * Waitlist Supabase repository — snake_case row mapping regression.
 *
 * Exercises the REAL SupabaseWaitlistRepository (not a copied mapping function)
 * against a MOCKED database client that returns snake_case rows exactly as
 * Postgres would. Verifies:
 *  - The repository maps snake_case DB columns into the camelCase consent model.
 *  - Existing stored consent is preserved by the merge policy.
 *  - Incoming UNCHECKED consent does NOT erase previously stored consent.
 *  - Consent text, version, and timestamp evidence survive the mapping.
 *
 * This is a mocked-client behavioral test, NOT live PostgreSQL. It does not
 * change the consent policy or database schema.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the service-role admin client factory.
const fromMock = vi.fn();
vi.mock("@/lib/server/supabase-admin.server", () => ({
  getAdminClient: () => ({ from: fromMock }),
}));

// Force Supabase mode for the repository dispatch.
vi.mock("@/lib/server/env.server", () => ({
  resolveDataMode: () => ({ dataMode: "supabase", isProduction: false }),
  getPublicDataMode: () => "supabase",
  requireSupabaseEnv: () => ({
    url: "https://example.supabase.co",
    anonKey: "anon",
    serviceRoleKey: "service",
  }),
}));

import { getWaitlistRepository } from "@/lib/server/waitlist-repository.server";
import type { WaitlistRecord } from "@/lib/waitlist/types";
import {
  SMS_CONSENT_TEXT,
  SMS_CONSENT_TEXT_VERSION,
  EMAIL_CONSENT_TEXT,
  EMAIL_CONSENT_TEXT_VERSION,
  PRIVACY_POLICY_VERSION,
  TERMS_VERSION,
} from "@/lib/waitlist/constants";

/** A complete protected record with consent granted. */
function recordWith(overrides: Partial<WaitlistRecord> = {}): WaitlistRecord {
  return {
    firstName: "Jordan",
    lastName: "Rivera",
    email: "jordan@example.com",
    normalizedEmail: "jordan@example.com",
    phone: "+15550123456",
    normalizedPhone: "+15550123456",
    partySize: 4,
    preferredDate: null,
    preferredSeatingTime: null,
    privateRoomInterest: false,
    emailMarketingConsent: true,
    emailConsentText: EMAIL_CONSENT_TEXT,
    emailConsentTextVersion: EMAIL_CONSENT_TEXT_VERSION,
    emailConsentTimestamp: "2026-01-01T00:00:00.000Z",
    smsConsent: true,
    smsConsentText: SMS_CONSENT_TEXT,
    smsConsentTextVersion: SMS_CONSENT_TEXT_VERSION,
    smsConsentTimestamp: "2026-01-01T00:00:00.000Z",
    privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    termsVersion: TERMS_VERSION,
    source: "waitlist_page",
    status: "new",
    ...overrides,
  };
}

/** Build a chainable query mock from a list of step behaviors. */
function chain(steps: Array<() => { data: unknown; error: null | object }>) {
  let i = 0;
  const q: Record<string, unknown> = {};
  const make = (): Record<string, unknown> => {
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    const terminal = step();
    const proxy: Record<string, unknown> = {
      select: () => make(),
      eq: () => make(),
      limit: () => terminal,
      update: () => make(),
      insert: () => terminal,
    };
    return proxy;
  };
  return make();
}

describe("SupabaseWaitlistRepository — snake_case row mapping", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("maps a snake_case existing row and preserves stored consent on merge", async () => {
    // The DB returns snake_case columns, exactly as selected by the repository.
    const snakeRow = {
      id: "row-1",
      normalized_email: "jordan@example.com",
      private_room_interest: false,
      email_marketing_consent: true,
      email_consent_text: EMAIL_CONSENT_TEXT,
      email_consent_text_version: EMAIL_CONSENT_TEXT_VERSION,
      email_consent_timestamp: "2026-01-01T00:00:00.000Z",
      sms_consent: true,
      sms_consent_text: SMS_CONSENT_TEXT,
      sms_consent_text_version: SMS_CONSENT_TEXT_VERSION,
      sms_consent_timestamp: "2026-01-01T00:00:00.000Z",
    };

    let updatePayload: Record<string, unknown> | undefined;
    fromMock.mockImplementation(() => {
      let step = 0;
      const proxy: Record<string, unknown> = {
        select: () => proxy,
        eq: () => proxy,
        limit: () => {
          if (step === 0) {
            step++;
            return { data: [snakeRow], error: null };
          }
          return { data: [], error: null };
        },
        update: (payload: Record<string, unknown>) => {
          updatePayload = payload;
          return proxy;
        },
        insert: () => ({ data: null, error: null }),
      };
      return proxy;
    });

    const repo = getWaitlistRepository();
    // Incoming submission with consent STILL granted — should preserve it.
    const result = await repo.upsert(recordWith());

    expect(result.duplicate).toBe(true);
    expect(updatePayload).toBeDefined();
    // Consent evidence must survive the snake_case → camelCase mapping.
    expect(updatePayload?.email_marketing_consent).toBe(true);
    expect(updatePayload?.email_consent_text).toBe(EMAIL_CONSENT_TEXT);
    expect(updatePayload?.email_consent_text_version).toBe(EMAIL_CONSENT_TEXT_VERSION);
    expect(updatePayload?.email_consent_timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(updatePayload?.sms_consent).toBe(true);
    expect(updatePayload?.sms_consent_text).toBe(SMS_CONSENT_TEXT);
    expect(updatePayload?.sms_consent_text_version).toBe(SMS_CONSENT_TEXT_VERSION);
    expect(updatePayload?.sms_consent_timestamp).toBe("2026-01-01T00:00:00.000Z");
  });

  it("does NOT erase previously stored consent when the incoming submission leaves it unchecked", async () => {
    // Stored row: BOTH consents previously granted with full evidence.
    const snakeRow = {
      id: "row-2",
      normalized_email: "jordan@example.com",
      private_room_interest: false,
      email_marketing_consent: true,
      email_consent_text: EMAIL_CONSENT_TEXT,
      email_consent_text_version: EMAIL_CONSENT_TEXT_VERSION,
      email_consent_timestamp: "2026-01-01T00:00:00.000Z",
      sms_consent: true,
      sms_consent_text: SMS_CONSENT_TEXT,
      sms_consent_text_version: SMS_CONSENT_TEXT_VERSION,
      sms_consent_timestamp: "2026-01-01T00:00:00.000Z",
    };

    let updatePayload: Record<string, unknown> | undefined;
    fromMock.mockImplementation(() => {
      let step = 0;
      const proxy: Record<string, unknown> = {
        select: () => proxy,
        eq: () => proxy,
        limit: () => {
          if (step === 0) {
            step++;
            return { data: [snakeRow], error: null };
          }
          return { data: [], error: null };
        },
        update: (payload: Record<string, unknown>) => {
          updatePayload = payload;
          return proxy;
        },
        insert: () => ({ data: null, error: null }),
      };
      return proxy;
    });

    const repo = getWaitlistRepository();
    // Incoming submission: BOTH consents UNCHECKED (false). Under the
    // no-downgrade merge policy, the previously granted consent must survive.
    const result = await repo.upsert(
      recordWith({
        emailMarketingConsent: false,
        emailConsentText: null,
        emailConsentTextVersion: null,
        emailConsentTimestamp: null,
        smsConsent: false,
        smsConsentText: null,
        smsConsentTextVersion: null,
        smsConsentTimestamp: null,
      }),
    );

    expect(result.duplicate).toBe(true);
    expect(updatePayload).toBeDefined();
    // Consent must NOT be downgraded to false by an unchecked re-submission.
    expect(updatePayload?.email_marketing_consent).toBe(true);
    expect(updatePayload?.email_consent_text).toBe(EMAIL_CONSENT_TEXT);
    expect(updatePayload?.email_consent_text_version).toBe(EMAIL_CONSENT_TEXT_VERSION);
    expect(updatePayload?.email_consent_timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(updatePayload?.sms_consent).toBe(true);
    expect(updatePayload?.sms_consent_text).toBe(SMS_CONSENT_TEXT);
    expect(updatePayload?.sms_consent_text_version).toBe(SMS_CONSENT_TEXT_VERSION);
    expect(updatePayload?.sms_consent_timestamp).toBe("2026-01-01T00:00:00.000Z");
  });

  it("inserts a new row (no email match) and never reveals a DB error", async () => {
    fromMock.mockImplementation(() => {
      const proxy: Record<string, unknown> = {
        select: () => proxy,
        eq: () => proxy,
        limit: () => ({ data: [], error: null }),
        insert: () => ({ data: null, error: null }),
      };
      return proxy;
    });

    const repo = getWaitlistRepository();
    const result = await repo.upsert(recordWith());
    expect(result.duplicate).toBe(false);
  });

  it("throws a safe generic error (never a raw DB error) on a find failure", async () => {
    fromMock.mockImplementation(() => {
      const proxy: Record<string, unknown> = {
        select: () => proxy,
        eq: () => proxy,
        limit: () => ({ data: null, error: { message: "relation does not exist" } }),
        insert: () => ({ data: null, error: null }),
      };
      return proxy;
    });

    const repo = getWaitlistRepository();
    await expect(repo.upsert(recordWith())).rejects.toThrow(
      "Waitlist submission could not be processed.",
    );
  });
});
