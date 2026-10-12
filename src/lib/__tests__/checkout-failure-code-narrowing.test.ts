/**
 * Focused tests for the Checkout preparation failure-code narrowing.
 *
 * Exercises the real createDepositCheckout service with mocked boundaries.
 * NOT live PostgreSQL, Stripe, or concurrency verification.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rpcHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {};
  let stripeCreateCalls = 0;
  let stripeRetrieveCalls = 0;
  let supabaseMode = true;
  return {
    rpcHandlers,
    getStripeCreateCalls: () => stripeCreateCalls,
    getStripeRetrieveCalls: () => stripeRetrieveCalls,
    incrementStripeCreateCalls: () => {
      stripeCreateCalls += 1;
    },
    incrementStripeRetrieveCalls: () => {
      stripeRetrieveCalls += 1;
    },
    isSupabaseMode: () => supabaseMode,
    setSupabaseMode: (v: boolean) => {
      supabaseMode = v;
    },
    reset: () => {
      stripeCreateCalls = 0;
      stripeRetrieveCalls = 0;
    },
  };
});

vi.mock("@/lib/server/env.server", () => ({
  isSupabaseMode: () => mocks.isSupabaseMode(),
  isMockMode: () => !mocks.isSupabaseMode(),
  requireSupabaseEnv: () => ({
    url: "https://example.supabase.co",
    anonKey: "anon",
    serviceRoleKey: "service-role",
    siteUrl: "https://sitdownsundays.net",
  }),
  resolveDataMode: () => ({ dataMode: "supabase", isProduction: false }),
}));

vi.mock("@/lib/server/supabase-admin.server", () => ({
  getAdminClient: () => ({
    rpc: async (fnName: string, args: Record<string, unknown>) => {
      const handler = mocks.rpcHandlers[fnName];
      if (!handler) throw new Error(`Unexpected RPC: ${fnName}`);
      return { data: handler(args), error: null };
    },
  }),
}));

vi.mock("@/lib/server/stripe-checkout.server", () => ({
  StripeAdapterError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = "StripeAdapterError";
      this.code = code;
    }
  },
  resolveCheckoutUrls: (siteUrl: string | undefined, reservationId: string) => {
    if (!siteUrl || !siteUrl.startsWith("https://")) return null;
    const base = siteUrl.replace(/\/$/, "");
    return {
      successUrl: `${base}/reserve/confirmation?reservation=${encodeURIComponent(reservationId)}`,
      cancelUrl: `${base}/reserve/payment?reservation=${encodeURIComponent(reservationId)}`,
    };
  },
  createDepositCheckoutSession: async () => {
    mocks.incrementStripeCreateCalls();
    throw new Error("Stripe create should not be called on rejected preparation");
  },
  retrieveCheckoutSession: async () => {
    mocks.incrementStripeRetrieveCalls();
    throw new Error("Stripe retrieve should not be called on rejected preparation");
  },
}));

const { createDepositCheckout } = await import("@/lib/server/checkout-service.server");

const RESERVATION_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";

const PREP_FAILURE_CODES = [
  "invalid_actor",
  "invalid_data",
  "not_found",
  "conflict",
  "invalid_status",
  "hold_not_found",
  "hold_released",
  "already_satisfied",
  "insufficient_time",
  "invalid_amount",
  "approval_required",
  "checkout_requires_review",
] as const;

const EXPECTED_MESSAGES: Record<string, RegExp> = {
  invalid_actor: /Authorization/i,
  invalid_data: /Invalid/i,
  not_found: /not found/i,
  conflict: /processed|conflict|processing/i,
  invalid_status: /eligible/i,
  hold_not_found: /capacity hold/i,
  hold_released: /released/i,
  already_satisfied: /already/i,
  insufficient_time: /time/i,
  invalid_amount: /amount/i,
  approval_required: /approval/i,
  checkout_requires_review: /reconciliation|reload/i,
};

beforeEach(() => {
  mocks.reset();
  mocks.setSupabaseMode(true);
  mocks.rpcHandlers.prepare_checkout_session_atomic = () => ({ ok: true });
  mocks.rpcHandlers.record_checkout_session = () => ({ ok: true });
});

describe("checkout preparation failure-code narrowing", () => {
  it.each(PREP_FAILURE_CODES)("recognized code %s returns the expected safe code", async (code) => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () => ({ ok: false, code });
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unavailable");
      expect(result.code).toBe(code);
      expect(result.error).toMatch(EXPECTED_MESSAGES[code]);
    }
    expect(mocks.getStripeCreateCalls()).toBe(0);
    expect(mocks.getStripeRetrieveCalls()).toBe(0);
  });

  it("unknown string code maps to unexpected without exposing raw text", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () => ({
      ok: false,
      code: "totally_made_up_code",
    });
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unavailable");
      expect(result.code).toBe("unexpected");
      expect(result.error).not.toContain("totally_made_up_code");
    }
    expect(mocks.getStripeCreateCalls()).toBe(0);
    expect(mocks.getStripeRetrieveCalls()).toBe(0);
  });

  it("missing code maps to unexpected", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () => ({ ok: false });
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unavailable");
      expect(result.code).toBe("unexpected");
    }
    expect(mocks.getStripeCreateCalls()).toBe(0);
    expect(mocks.getStripeRetrieveCalls()).toBe(0);
  });

  it("malformed non-string code maps to unexpected", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () => ({ ok: false, code: 42 });
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unavailable");
      expect(result.code).toBe("unexpected");
    }
    expect(mocks.getStripeCreateCalls()).toBe(0);
    expect(mocks.getStripeRetrieveCalls()).toBe(0);
  });

  it("rejected preparation makes zero Stripe create and retrieve calls", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () => ({
      ok: false,
      code: "hold_released",
    });
    await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(mocks.getStripeCreateCalls()).toBe(0);
    expect(mocks.getStripeRetrieveCalls()).toBe(0);
  });
});
