/**
 * Tests for the waitlist CRM wiring: form-tracking guard logic and webhook
 * payload shaping + secret-boundary behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isHoneypotTriggered } from "@/lib/waitlist/normalize";
import type { WaitlistRecord } from "@/lib/waitlist/types";

// ---------------------------------------------------------------------------
// Honeypot guard (shared by client tracking + server webhook gating)
// ---------------------------------------------------------------------------

describe("waitlist CRM honeypot guard", () => {
  it("rejects a non-empty honeypot field", () => {
    expect(isHoneypotTriggered("spam")).toBe(true);
    expect(isHoneypotTriggered("  x  ")).toBe(true);
  });

  it("passes empty/blank honeypot", () => {
    expect(isHoneypotTriggered("")).toBe(false);
    expect(isHoneypotTriggered("   ")).toBe(false);
    expect(isHoneypotTriggered(null)).toBe(false);
    expect(isHoneypotTriggered(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// trackWaitlistSubmission honeypot guard
// ---------------------------------------------------------------------------

describe("trackWaitlistSubmission", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    vi.stubGlobal("crypto", { randomUUID: () => "test-uuid" });
    vi.stubGlobal("window", { location: { href: "https://sitdownsundays.net/waitlist" } });
    vi.stubGlobal("document", { title: "Join the Waitlist — Sit Down Sundays" });
    vi.stubGlobal("navigator", { userAgent: "node-test" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not fire a tracking event for a honeypot trap", async () => {
    const { trackWaitlistSubmission } = await import("@/lib/waitlist/crm-tracking");
    trackWaitlistSubmission({
      firstName: "Spam",
      lastName: "Bot",
      email: "spam@test.com",
      phone: "5550000",
      partySize: "4",
      preferredDate: "",
      preferredSeatingTime: "",
      privateRoomInterest: false,
      emailMarketingConsent: false,
      smsConsent: false,
      website: "http://spam.example", // honeypot triggered
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fires one tracking event for a real submission", async () => {
    const { trackWaitlistSubmission } = await import("@/lib/waitlist/crm-tracking");
    trackWaitlistSubmission({
      firstName: "Amara",
      lastName: "Okafor",
      email: "amara@test.com",
      phone: "+15551234567",
      partySize: "6",
      preferredDate: "2026-10-18",
      preferredSeatingTime: "Early afternoon",
      privateRoomInterest: true,
      emailMarketingConsent: true,
      smsConsent: false,
      website: "", // honeypot empty
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://backend.leadconnectorhq.com/external-tracking/events");
    expect(init.method).toBe("POST");
    // The body is FormData; the event JSON must be parseable and carry the slug.
    const body = init.body as FormData;
    const event = JSON.parse(body.get("event") as string);
    expect(event.type).toBe("external_form_submission");
    expect(event.formId).toBe("waitlist-form");
    // Standard fields land in formData.
    expect(event.formData.first_name).toBe("Amara");
    expect(event.formData.last_name).toBe("Okafor");
    expect(event.formData.email).toBe("amara@test.com");
    expect(event.formData.phone).toBe("+15551234567");
    // Custom fields are keyed by their registered IDs.
    expect(event.formData).toHaveProperty("W62YuW3ecNm0vHpSXS2O"); // party size
    expect(event.formData.W62YuW3ecNm0vHpSXS2O).toBe(6);
    expect(event.formData).toHaveProperty("KpOqxgWGEANTE1gP1r7h"); // preferred sunday
    expect(event.formData.KpOqxgWGEANTE1gP1r7h).toBe("2026-10-18");
    expect(event.formData).toHaveProperty("ctIB3zqqXRvSihy8SUra"); // private room
    expect(event.formData.ctIB3zqqXRvSihy8SUra).toBe("Yes");
    // SMS consent false -> omitted (undefined skipped).
    expect(event.formData).not.toHaveProperty("YqqoEKTvBgFyTXup4kmq");
    // formLabels present for every formData key.
    for (const key of Object.keys(event.formData)) {
      expect(event.formLabels[key]).toBeTruthy();
    }
    // Tracking IDs carried.
    expect(event.trackingId).toBe("tk_ea09695b3a1f4059bb962d5979f60af7");
    expect(event.locationId).toBe("ap2yIMX9hKdh3baHD0K7");
  });

  it("omits optional custom fields that are empty", async () => {
    const { trackWaitlistSubmission } = await import("@/lib/waitlist/crm-tracking");
    trackWaitlistSubmission({
      firstName: "Jordan",
      lastName: "Lee",
      email: "jordan@test.com",
      phone: "5551234",
      partySize: "2",
      preferredDate: "",
      preferredSeatingTime: "",
      privateRoomInterest: false,
      emailMarketingConsent: false,
      smsConsent: false,
      website: "",
    });
    const body = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as FormData;
    const event = JSON.parse(body.get("event") as string);
    expect(event.formData).toHaveProperty("W62YuW3ecNm0vHpSXS2O");
    expect(event.formData.W62YuW3ecNm0vHpSXS2O).toBe(2);
    // No optional fields set.
    expect(event.formData).not.toHaveProperty("KpOqxgWGEANTE1gP1r7h");
    expect(event.formData).not.toHaveProperty("oDzPSs31TnZpY3IaNGyT");
    expect(event.formData).not.toHaveProperty("ctIB3zqqXRvSihy8SUra");
    expect(event.formData).not.toHaveProperty("isgL83meJTOwd7PRsIOF");
    expect(event.formData).not.toHaveProperty("YqqoEKTvBgFyTXup4kmq");
  });
});

// ---------------------------------------------------------------------------
// postWaitlistWebhook (server-only)
// ---------------------------------------------------------------------------

const sampleRecord: WaitlistRecord = {
  firstName: "Amara",
  lastName: "Okafor",
  email: "amara@test.com",
  normalizedEmail: "amara@test.com",
  phone: "+1 555 123 4567",
  normalizedPhone: "+15551234567",
  partySize: 6,
  preferredDate: "2026-10-18",
  preferredSeatingTime: "Early afternoon",
  privateRoomInterest: true,
  emailMarketingConsent: true,
  emailConsentText: null,
  emailConsentTextVersion: null,
  emailConsentTimestamp: "2026-09-30T00:00:00.000Z",
  smsConsent: false,
  smsConsentText: null,
  smsConsentTextVersion: null,
  smsConsentTimestamp: null,
  privacyPolicyVersion: "1.0.0",
  termsVersion: "1.0.0",
  source: "public_waitlist",
  referralUrl: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  utmTerm: null,
  status: "new",
};

describe("postWaitlistWebhook", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // Clear any process.env mutation.
    delete process.env.WAITLIST_WEBHOOK_URL;
  });

  it("does nothing when WAITLIST_WEBHOOK_URL is unset", async () => {
    const { postWaitlistWebhook } = await import("@/lib/server/waitlist-webhook.server");
    await postWaitlistWebhook(sampleRecord);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("POSTs the guest payload to the webhook URL and never throws", async () => {
    process.env.WAITLIST_WEBHOOK_URL = "https://example.test/webhook";
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network down"));
    const { postWaitlistWebhook } = await import("@/lib/server/waitlist-webhook.server");
    // Should not throw even when fetch fails.
    await expect(postWaitlistWebhook(sampleRecord)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://example.test/webhook");
    expect(init.method).toBe("POST");
    const payload = JSON.parse(init.body as string);
    expect(payload.event).toBe("waitlist_submitted");
    expect(payload.firstName).toBe("Amara");
    expect(payload.lastName).toBe("Okafor");
    expect(payload.email).toBe("amara@test.com");
    expect(payload.phone).toBe("+1 555 123 4567");
    expect(payload.partySize).toBe(6);
    expect(payload.preferredDate).toBe("2026-10-18");
    expect(payload.privateRoomInterest).toBe(true);
    expect(payload.emailMarketingConsent).toBe(true);
    expect(payload.emailConsentTimestamp).toBe("2026-09-30T00:00:00.000Z");
    expect(payload.smsConsent).toBe(false);
    expect(payload.smsConsentTimestamp).toBeNull();
    expect(payload.source).toBe("public_waitlist");
  });

  it("does not include internal notes or status history in the payload", async () => {
    process.env.WAITLIST_WEBHOOK_URL = "https://example.test/webhook";
    const { postWaitlistWebhook } = await import("@/lib/server/waitlist-webhook.server");
    await postWaitlistWebhook(sampleRecord);
    const payload = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(payload).not.toHaveProperty("internalNotes");
    expect(payload).not.toHaveProperty("statusHistory");
    expect(payload).not.toHaveProperty("normalizedEmail");
    expect(payload).not.toHaveProperty("normalizedPhone");
  });
});

// ---------------------------------------------------------------------------
// Secret boundary: no secret URL or process.env in client-safe modules
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSource(rel: string): string {
  return readFileSync(resolve(__dirname, rel), "utf8");
}

describe("waitlist CRM secret boundary", () => {
  it("client tracking module does not reference the webhook URL or process.env", () => {
    const src = readSource("../waitlist/crm-tracking.ts");
    expect(src).not.toContain("WAITLIST_WEBHOOK_URL");
    expect(src).not.toContain("process.env");
  });

  it("client tracking module only references the publishable external-tracking endpoint", () => {
    const src = readSource("../waitlist/crm-tracking.ts");
    // The only endpoint the client module should touch.
    expect(src).toContain("backend.leadconnectorhq.com/external-tracking/events");
    // Never the webhook-trigger path.
    expect(src).not.toContain("hooks/");
    expect(src).not.toContain("webhook-trigger");
  });

  it("client waitlist form component does not reference the webhook secret", () => {
    const src = readSource("../../components/waitlist/waitlist-form.tsx");
    expect(src).not.toContain("WAITLIST_WEBHOOK_URL");
    expect(src).not.toContain("process.env");
    expect(src).not.toContain("webhook-trigger");
  });

  it("server webhook module references the secret (expected)", () => {
    const src = readSource("../server/waitlist-webhook.server.ts");
    expect(src).toContain("WAITLIST_WEBHOOK_URL");
  });
});
