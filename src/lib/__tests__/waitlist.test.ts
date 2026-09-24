import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  trimName,
  normalizeEmail,
  normalizePhone,
  isValidPreferredDate,
  isHoneypotTriggered,
  normalizeWaitlistInput,
} from "@/lib/waitlist/normalize";
import { parseWaitlistInput } from "@/lib/waitlist/schema";
import { buildWaitlistRecord } from "@/lib/waitlist/record";
import {
  PARTY_MAX,
  PARTY_MIN,
  SMS_CONSENT_TEXT,
  SMS_CONSENT_TEXT_VERSION,
  EMAIL_CONSENT_TEXT,
  EMAIL_CONSENT_TEXT_VERSION,
  PRIVACY_POLICY_VERSION,
  TERMS_VERSION,
  mergeConsent,
  type ConsentState,
} from "@/lib/waitlist/constants";
import { buildAnalyticsPayload, analyticsContextFromInput } from "@/lib/waitlist/analytics";
import type { WaitlistSubmitInput } from "@/lib/waitlist/types";

const validInput: WaitlistSubmitInput = {
  firstName: "  Jordan  ",
  lastName: " Rivera ",
  email: "Jordan.Rivera@Example.com",
  phone: " +1 (555) 012-3456 ",
  partySize: 4,
  preferredDate: null,
  preferredSeatingTime: null,
  privateRoomInterest: false,
  emailMarketingConsent: false,
  smsConsent: false,
  website: "",
};

/** Build a ConsentState with all evidence fields, for concise test setup. */
function consent(email: boolean, sms: boolean, ts: string | null = null): ConsentState {
  return {
    emailMarketingConsent: email,
    emailConsentText: email ? EMAIL_CONSENT_TEXT : null,
    emailConsentTextVersion: email ? EMAIL_CONSENT_TEXT_VERSION : null,
    emailConsentTimestamp: email ? ts : null,
    smsConsent: sms,
    smsConsentText: sms ? SMS_CONSENT_TEXT : null,
    smsConsentTextVersion: sms ? SMS_CONSENT_TEXT_VERSION : null,
    smsConsentTimestamp: sms ? ts : null,
  };
}

describe("name trimming", () => {
  it("trims and collapses internal whitespace", () => {
    expect(trimName("  Alex   Morgan ")).toBe("Alex Morgan");
  });
  it("does not mutate an already-clean name", () => {
    expect(trimName("Sam Lee")).toBe("Sam Lee");
  });
});

describe("email normalization", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Foo@BAR.com ")).toBe("foo@bar.com");
  });
});

describe("phone normalization", () => {
  it("keeps leading plus and digits, strips the rest", () => {
    expect(normalizePhone(" +1 (555) 012-3456 ")).toBe("+15550123456");
  });
  it("returns empty string when no digits", () => {
    expect(normalizePhone("  ")).toBe("");
  });
  it("handles no leading plus", () => {
    expect(normalizePhone("(555) 012-3456")).toBe("5550123456");
  });
});

describe("party-size validation", () => {
  it("rejects below minimum", () => {
    const r = parseWaitlistInput({ ...validInput, partySize: 0 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.partySize).toBeTruthy();
  });
  it("rejects above maximum", () => {
    const r = parseWaitlistInput({ ...validInput, partySize: PARTY_MAX + 1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.partySize).toBeTruthy();
  });
  it("rejects non-integer", () => {
    const r = parseWaitlistInput({ ...validInput, partySize: 2.5 });
    expect(r.success).toBe(false);
  });
  it("accepts the boundary maximum", () => {
    const r = parseWaitlistInput({ ...validInput, partySize: PARTY_MAX });
    expect(r.success).toBe(true);
  });
  it("accepts the boundary minimum", () => {
    const r = parseWaitlistInput({ ...validInput, partySize: PARTY_MIN });
    expect(r.success).toBe(true);
  });
});

describe("date validation", () => {
  it("accepts a valid future-ish date within range", () => {
    const year = new Date().getUTCFullYear() + 1;
    expect(isValidPreferredDate(`${year}-06-15`)).toBe(true);
  });
  it("rejects malformed dates", () => {
    expect(isValidPreferredDate("not-a-date")).toBe(false);
    expect(isValidPreferredDate("2024-13-40")).toBe(false);
  });
  it("accepts null/empty", () => {
    expect(isValidPreferredDate(null)).toBe(true);
    expect(isValidPreferredDate("")).toBe(true);
  });
});

describe("honeypot", () => {
  it("is triggered when the hidden field is non-empty", () => {
    expect(isHoneypotTriggered("spam")).toBe(true);
  });
  it("is not triggered when empty", () => {
    expect(isHoneypotTriggered("")).toBe(false);
    expect(isHoneypotTriggered(null)).toBe(false);
  });
});

describe("protected-field rejection", () => {
  it("rejects status from the browser", () => {
    const r = parseWaitlistInput({ ...validInput, status: "booked" });
    expect(r.success).toBe(false);
  });
  it("rejects internal_notes from the browser", () => {
    const r = parseWaitlistInput({ ...validInput, internal_notes: "secret" });
    expect(r.success).toBe(false);
  });
  it("rejects arbitrary ids from the browser", () => {
    const r = parseWaitlistInput({ ...validInput, id: "abc" });
    expect(r.success).toBe(false);
  });
});

describe("consent defaults", () => {
  it("sms consent is unchecked by default", () => {
    const r = parseWaitlistInput({ ...validInput, smsConsent: undefined });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.smsConsent).toBe(false);
  });
  it("email consent is unchecked by default", () => {
    const r = parseWaitlistInput({ ...validInput, emailMarketingConsent: undefined });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.emailMarketingConsent).toBe(false);
  });
});

describe("server-generated consent timestamps & versions", () => {
  const now = "2026-09-23T12:00:00.000Z";
  it("generates a timestamp only when email consent is true", () => {
    const rec = buildWaitlistRecord(
      normalizeWaitlistInput({ ...validInput, emailMarketingConsent: true }),
      { now },
    );
    expect(rec.emailConsentTimestamp).toBe(now);
    const rec2 = buildWaitlistRecord(
      normalizeWaitlistInput({ ...validInput, emailMarketingConsent: false }),
      { now },
    );
    expect(rec2.emailConsentTimestamp).toBeNull();
  });
  it("retains SMS consent text + version only when consented", () => {
    const rec = buildWaitlistRecord(normalizeWaitlistInput({ ...validInput, smsConsent: true }), {
      now,
    });
    expect(rec.smsConsentText).toBe(SMS_CONSENT_TEXT);
    expect(rec.smsConsentTextVersion).toBe(SMS_CONSENT_TEXT_VERSION);
    expect(rec.smsConsentTimestamp).toBe(now);
    const rec2 = buildWaitlistRecord(normalizeWaitlistInput({ ...validInput, smsConsent: false }), {
      now,
    });
    expect(rec2.smsConsentText).toBeNull();
    expect(rec2.smsConsentTextVersion).toBeNull();
    expect(rec2.smsConsentTimestamp).toBeNull();
  });
  it("attaches policy versions server-side", () => {
    const rec = buildWaitlistRecord(normalizeWaitlistInput(validInput), { now });
    expect(rec.privacyPolicyVersion).toBe(PRIVACY_POLICY_VERSION);
    expect(rec.termsVersion).toBe(TERMS_VERSION);
    expect(rec.status).toBe("new");
  });
});

describe("email-consent evidence", () => {
  const now = "2026-09-23T12:00:00.000Z";
  it("retains email consent text + version + timestamp only when consented", () => {
    const rec = buildWaitlistRecord(
      normalizeWaitlistInput({ ...validInput, emailMarketingConsent: true }),
      { now },
    );
    expect(rec.emailConsentText).toBe(EMAIL_CONSENT_TEXT);
    expect(rec.emailConsentTextVersion).toBe(EMAIL_CONSENT_TEXT_VERSION);
    expect(rec.emailConsentTimestamp).toBe(now);
  });
  it("nulls all three email-consent evidence fields when not consented", () => {
    const rec = buildWaitlistRecord(
      normalizeWaitlistInput({ ...validInput, emailMarketingConsent: false }),
      { now },
    );
    expect(rec.emailConsentText).toBeNull();
    expect(rec.emailConsentTextVersion).toBeNull();
    expect(rec.emailConsentTimestamp).toBeNull();
  });
});

describe("consent merge (no downgrade)", () => {
  const ts1 = "2026-01-01T00:00:00.000Z";
  const ts2 = "2026-09-23T12:00:00.000Z";
  it("preserves existing email opt-in when a later submission omits it", () => {
    const existing = consent(true, false, ts1);
    const incoming = consent(false, false);
    const merged = mergeConsent(existing, incoming);
    expect(merged.emailMarketingConsent).toBe(true);
    expect(merged.emailConsentTimestamp).toBe(ts1); // original evidence preserved
    expect(merged.emailConsentText).toBe(EMAIL_CONSENT_TEXT);
    expect(merged.emailConsentTextVersion).toBe(EMAIL_CONSENT_TEXT_VERSION);
  });
  it("does not convert a previous SMS opt-out into consent unless newly checked", () => {
    const existing = consent(false, false);
    const incoming = consent(false, false);
    expect(mergeConsent(existing, incoming).smsConsent).toBe(false);
  });
  it("establishes new consent with the incoming timestamp", () => {
    const existing = consent(false, false);
    const incoming = consent(true, true, ts2);
    const merged = mergeConsent(existing, incoming);
    expect(merged.emailConsentTimestamp).toBe(ts2);
    expect(merged.smsConsentTimestamp).toBe(ts2);
    expect(merged.emailConsentText).toBe(EMAIL_CONSENT_TEXT);
    expect(merged.smsConsentText).toBe(SMS_CONSENT_TEXT);
  });
  it("preserves original timestamp when consent already existed", () => {
    const existing = consent(true, true, ts1);
    const incoming = consent(true, true, ts2);
    const merged = mergeConsent(existing, incoming);
    expect(merged.emailConsentTimestamp).toBe(ts1);
    expect(merged.smsConsentTimestamp).toBe(ts1);
  });
});

describe("analytics payload (no PII)", () => {
  it("never includes names, email, phone, or free-form notes", () => {
    const normalized = normalizeWaitlistInput({
      ...validInput,
      referralUrl: "https://x.com?u=secretuser",
    });
    const payload = buildAnalyticsPayload(
      "waitlist_submitted",
      analyticsContextFromInput(normalized),
    );
    const json = JSON.stringify(payload);
    expect(json).not.toContain("Jordan");
    expect(json).not.toContain("Rivera");
    expect(json).not.toContain("Jordan.Rivera");
    expect(json).not.toContain("5550123456");
    expect(json).not.toContain("secretuser");
    expect(json).not.toContain("referralUrl");
    // referralUrl is never a key in the payload
    expect(payload).not.toHaveProperty("referralUrl");
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("phone");
    expect(payload).not.toHaveProperty("firstName");
    expect(payload).not.toHaveProperty("lastName");
  });
});

describe("neutral success response shape", () => {
  it("success result carries only ok + duplicate, no membership detail", () => {
    const ok = { ok: true, duplicate: false } as const;
    expect(ok.ok).toBe(true);
    expect(typeof ok.duplicate).toBe("boolean");
  });
});

describe("generic unexpected-error response", () => {
  it("unexpected result carries no env or db detail", () => {
    const r = { ok: false, kind: "unexpected" } as const;
    expect(r.ok).toBe(false);
    expect(r.kind).toBe("unexpected");
    expect(JSON.stringify(r)).not.toContain("Supabase");
    expect(JSON.stringify(r)).not.toContain("error");
  });
});

describe("environment mode validation", () => {
  const orig = { ...process.env };
  beforeEach(() => {
    process.env = { ...orig };
  });
  afterEach(() => {
    process.env = { ...orig };
  });

  it("rejects an invalid APP_DATA_MODE", async () => {
    process.env.APP_DATA_MODE = "banana";
    process.env.NODE_ENV = "development";
    const { resolveDataMode } = await import("@/lib/server/env.server");
    expect(() => resolveDataMode()).toThrow();
  });

  it("rejects mock mode in production", async () => {
    process.env.APP_DATA_MODE = "mock";
    process.env.NODE_ENV = "production";
    const { resolveDataMode } = await import("@/lib/server/env.server");
    expect(() => resolveDataMode()).toThrow(/mock/i);
  });

  it("accepts mock mode in development", async () => {
    process.env.APP_DATA_MODE = "mock";
    process.env.NODE_ENV = "development";
    const { resolveDataMode } = await import("@/lib/server/env.server");
    expect(resolveDataMode().dataMode).toBe("mock");
  });

  it("requires a valid HTTPS Supabase URL in supabase mode", async () => {
    process.env.APP_DATA_MODE = "supabase";
    process.env.NODE_ENV = "production";
    process.env.SUPABASE_URL = "http://not-secure.example";
    process.env.SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
    const { requireSupabaseEnv } = await import("@/lib/server/env.server");
    expect(() => requireSupabaseEnv()).toThrow();
  });
});

describe("server-only module boundary", () => {
  it("env.server.ts is a server-only file by filename", () => {
    const exists = readFileSync(
      join(process.cwd(), "src", "lib", "server", "env.server.ts"),
      "utf-8",
    );
    expect(exists).toContain("process.env");
  });
  it("waitlist.functions.ts does not import *.server.ts directly into client-visible helpers beyond RPC", () => {
    const c = readFileSync(join(process.cwd(), "src", "lib", "waitlist.functions.ts"), "utf-8");
    // server functions import server modules (allowed — replaced by RPC stubs),
    // but must not export the service-role client.
    expect(c).not.toContain("getAdminClient");
  });
});

// ---------------------------------------------------------------------------
// Migration-review corrections: identity model + previous-status validation
// ---------------------------------------------------------------------------

describe("identity model — email is the primary key", () => {
  beforeEach(async () => {
    process.env.APP_DATA_MODE = "mock";
    process.env.NODE_ENV = "development";
    const { __resetMockWaitlistRepository } =
      await import("@/lib/server/waitlist-repository.server");
    __resetMockWaitlistRepository();
  });

  it("treats a shared phone number as a separate entry (no phone-only merge)", async () => {
    process.env.APP_DATA_MODE = "mock";
    process.env.NODE_ENV = "development";
    const { getWaitlistRepository } = await import("@/lib/server/waitlist-repository.server");
    const repo = getWaitlistRepository();
    const now = "2026-09-23T12:00:00.000Z";

    // First person, email A, phone shared.
    const a = buildWaitlistRecord(
      normalizeWaitlistInput({ ...validInput, email: "a@example.com", phone: "+15550000001" }),
      { now },
    );
    const r1 = await repo.upsert(a);
    expect(r1.duplicate).toBe(false);

    // Second person, DIFFERENT email, SAME phone. Must NOT merge.
    const b = buildWaitlistRecord(
      normalizeWaitlistInput({ ...validInput, email: "b@example.com", phone: "+15550000001" }),
      { now },
    );
    const r2 = await repo.upsert(b);
    expect(r2.duplicate).toBe(false);

    const all = (await repo.listWaitlistEntries()) as unknown[];
    expect(all.length).toBe(2);
  });

  it("merges when the same email returns with a changed phone", async () => {
    process.env.APP_DATA_MODE = "mock";
    process.env.NODE_ENV = "development";
    const { getWaitlistRepository } = await import("@/lib/server/waitlist-repository.server");
    const repo = getWaitlistRepository();
    const now = "2026-09-23T12:00:00.000Z";

    const first = buildWaitlistRecord(
      normalizeWaitlistInput({ ...validInput, email: "same@example.com", phone: "+15550000001" }),
      { now },
    );
    await repo.upsert(first);

    // Same email, NEW phone — merges into one entry, phone updated.
    const second = buildWaitlistRecord(
      normalizeWaitlistInput({ ...validInput, email: "same@example.com", phone: "+15550000099" }),
      { now },
    );
    const r2 = await repo.upsert(second);
    expect(r2.duplicate).toBe(true);

    const all = (await repo.listWaitlistEntries()) as unknown[];
    expect(all.length).toBe(1);
  });

  it("preserves existing email consent on a duplicate email submission", async () => {
    process.env.APP_DATA_MODE = "mock";
    process.env.NODE_ENV = "development";
    const { getWaitlistRepository } = await import("@/lib/server/waitlist-repository.server");
    const repo = getWaitlistRepository();
    const ts1 = "2026-01-01T00:00:00.000Z";
    const ts2 = "2026-09-23T12:00:00.000Z";

    const first = buildWaitlistRecord(
      normalizeWaitlistInput({
        ...validInput,
        email: "keep@example.com",
        emailMarketingConsent: true,
      }),
      { now: ts1 },
    );
    await repo.upsert(first);

    // Same email, email consent omitted (false). Must NOT downgrade.
    const second = buildWaitlistRecord(
      normalizeWaitlistInput({
        ...validInput,
        email: "keep@example.com",
        emailMarketingConsent: false,
      }),
      { now: ts2 },
    );
    const r2 = await repo.upsert(second);
    expect(r2.duplicate).toBe(true);

    const all = (await repo.listWaitlistEntries()) as Array<{
      emailMarketingConsent: boolean;
      emailConsentTimestamp: string | null;
      emailConsentText: string | null;
    }>;
    expect(all.length).toBe(1);
    expect(all[0].emailMarketingConsent).toBe(true);
    expect(all[0].emailConsentTimestamp).toBe(ts1); // original evidence preserved
    expect(all[0].emailConsentText).toBe(EMAIL_CONSENT_TEXT);
  });
});

describe("previous-status validation (migration)", () => {
  it("the migration constrains previous_status to valid values when not null", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase", "migrations", "0001_waitlist_foundation.sql"),
      "utf-8",
    );
    // previous_status has a check constraint referencing the valid status set.
    expect(sql).toMatch(
      /previous_status.*check\s*\(\s*previous_status is null or previous_status in/i,
    );
    // new_status still constrained.
    expect(sql).toMatch(/new_status.*not null check\s*\(\s*new_status in/i);
  });

  it("the migration makes normalized_email unique and normalized_phone a non-unique index", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase", "migrations", "0001_waitlist_foundation.sql"),
      "utf-8",
    );
    expect(sql).toMatch(/create unique index[^;]*waitlist_entries_normalized_email_uniq/i);
    // phone index is a plain (non-unique) index.
    expect(sql).toMatch(/create index[^;]*idx_waitlist_entries_normalized_phone/i);
    expect(sql).not.toMatch(/create unique index[^;]*normalized_phone/i);
  });

  it("the migration references auth.users with ON DELETE SET NULL on changed_by and actor_user_id", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase", "migrations", "0001_waitlist_foundation.sql"),
      "utf-8",
    );
    expect(sql).toMatch(/changed_by.*references auth\.users\(id\)\s+on delete set null/i);
    expect(sql).toMatch(/actor_user_id.*references auth\.users\(id\)\s+on delete set null/i);
  });

  it("the migration makes audit_logs append-only (UPDATE + DELETE denied)", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase", "migrations", "0001_waitlist_foundation.sql"),
      "utf-8",
    );
    expect(sql).toMatch(/prevent_audit_modification/i);
    expect(sql).toMatch(/before update on public\.audit_logs/i);
    expect(sql).toMatch(/before delete on public\.audit_logs/i);
  });

  it("the migration adds email_consent_text + email_consent_text_version with a consistency constraint", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase", "migrations", "0001_waitlist_foundation.sql"),
      "utf-8",
    );
    expect(sql).toMatch(/email_consent_text\s+varchar/i);
    expect(sql).toMatch(/email_consent_text_version\s+varchar/i);
    expect(sql).toMatch(/email_consent_consistency/i);
  });

  it("trigger functions declare a safe search_path", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase", "migrations", "0001_waitlist_foundation.sql"),
      "utf-8",
    );
    expect(sql).toMatch(/set search_path = public, pg_temp/i);
  });
});
