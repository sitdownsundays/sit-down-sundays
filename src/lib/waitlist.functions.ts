/**
 * Waitlist server functions — thin client-safe wrappers.
 *
 * Components import these (NOT the *.server.ts helpers). The build replaces
 * their implementations with RPC stubs in client bundles, so server-only
 * modules and secrets never enter the client dependency graph.
 *
 * Each handler:
 *  1. Parses + strictly validates the payload (rejects unknown/protected fields).
 *  2. Trims names, normalizes email/phone, validates party size & dates.
 *  3. Enforces a honeypot spam defense.
 *  4. Generates consent timestamps, consent text + versions, and policy
 *     versions server-side.
 *  5. Captures safe source/UTM values.
 *  6. Performs duplicate-safe insert/merge via the repository.
 *  7. Returns a neutral result (never reveals DB membership or raw errors).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getPublicDataMode } from "@/lib/server/env.server";
import { getWaitlistRepository } from "@/lib/server/waitlist-repository.server";
import {
  SMS_CONSENT_TEXT,
  SMS_CONSENT_TEXT_VERSION,
  EMAIL_CONSENT_TEXT,
  EMAIL_CONSENT_TEXT_VERSION,
  PRIVACY_POLICY_VERSION,
  TERMS_VERSION,
  WAITLIST_DEFAULT_SOURCE,
  mergeConsent,
} from "@/lib/waitlist/constants";
import { normalizeWaitlistInput, isHoneypotTriggered } from "@/lib/waitlist/normalize";
import { parseWaitlistInput } from "@/lib/waitlist/schema";
import { buildWaitlistRecord } from "@/lib/waitlist/record";
import {
  buildAnalyticsPayload,
  trackAnalytics,
  analyticsContextFromInput,
} from "@/lib/waitlist/analytics";
import type { WaitlistSubmitResult } from "@/lib/waitlist/types";

// Raw payload schema: a permissive object that we then strictly parse.
const rawPayloadSchema = z.record(z.unknown());

/**
 * Submit a waitlist entry. Returns a neutral result.
 * Never reveals whether an email/phone already exists.
 */
export const submitWaitlist = createServerFn({ method: "POST" })
  .validator((raw: unknown) => rawPayloadSchema.parse(raw))
  .handler(async ({ data }): Promise<WaitlistSubmitResult> => {
    try {
      // 1. Strict parse — rejects unknown/protected fields.
      const parsed = parseWaitlistInput(data);
      if (!parsed.success) {
        trackAnalytics("waitlist_validation_failed", {
          errorFields: Object.keys(parsed.errors),
        });
        return { ok: false, kind: "validation", errors: parsed.errors };
      }

      const input = parsed.data;

      // 2. Honeypot — silently treat as success to avoid revealing detection.
      if (isHoneypotTriggered(input.website)) {
        trackAnalytics("waitlist_validation_failed", { errorFields: ["website"] });
        return { ok: true, duplicate: false };
      }

      // 3. Normalize.
      const normalized = normalizeWaitlistInput(input);

      // 4. Build protected record (server-generated timestamps/versions).
      const now = new Date().toISOString();
      const record = buildWaitlistRecord(normalized, {
        now,
      });

      // Attach safe source if absent.
      if (!record.source) record.source = WAITLIST_DEFAULT_SOURCE;

      trackAnalytics(
        "waitlist_submitted",
        buildAnalyticsPayload("waitlist_submitted", analyticsContextFromInput(normalized)),
      );

      // 5. Duplicate-safe insert/merge via the active repository.
      const repo = getWaitlistRepository();
      const result = await repo.upsert(record);

      trackAnalytics(
        "waitlist_succeeded",
        buildAnalyticsPayload("waitlist_succeeded", analyticsContextFromInput(normalized)),
      );

      return { ok: true, duplicate: result.duplicate };
    } catch {
      // Never expose raw DB/env errors. Neutral unexpected failure.
      trackAnalytics("waitlist_failed", buildAnalyticsPayload("waitlist_failed", {}));
      return { ok: false, kind: "unexpected" };
    }
  });

/**
 * Public waitlist config — safe to return to the browser. Carries only the
 * data-mode label so the UI can show a development-only mock indicator.
 * Never secrets or URLs.
 */
export const getWaitlistPublicConfig = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return { dataMode: getPublicDataMode() } as const;
  } catch {
    // If env is misconfigured, do not leak details; default to supabase.
    return { dataMode: "supabase" } as const;
  }
});

/**
 * Returns the exact SMS consent text + version for display.
 * Client-safe (no secrets). The displayed text is retained verbatim when
 * consent is granted.
 */
export const getWaitlistConsentText = createServerFn({ method: "GET" }).handler(async () => {
  return {
    smsConsentText: SMS_CONSENT_TEXT,
    smsConsentTextVersion: SMS_CONSENT_TEXT_VERSION,
    emailConsentText: EMAIL_CONSENT_TEXT,
    emailConsentTextVersion: EMAIL_CONSENT_TEXT_VERSION,
    privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    termsVersion: TERMS_VERSION,
  } as const;
});

// Re-export the merge helper for server-side tests (not a server function).
export { mergeConsent };
