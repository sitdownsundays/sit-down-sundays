/**
 * Mocked-boundary verification of the Stripe deposit checkout SERVICE.
 *
 * NOT live PostgreSQL, Stripe, or concurrency verification. The Supabase
 * admin client, environment resolver, and Stripe SDK adapter are mocked at
 * the module boundary. The real createDepositCheckout() orchestration logic
 * is exercised end-to-end through those mocked seams.
 *
 * Adapter-specific tests (live-key rejection, session recovery) live in
 * checkout-adapter.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rpcHandlers: Record<string, (args: Record<string, unknown>) => unknown> = {};
  let stripeCreateCalls = 0;
  let stripeRetrieveCalls = 0;
  let stripeCreateParams: Record<string, unknown> | null = null;
  let stripeCreateShouldThrow: { code: string; message: string } | null = null;
  let stripeRetrieveResult: {
    stripeSessionId: string;
    stripeSessionUrl: string;
    expiresAt: number;
    status: string;
    paymentStatus: string;
    livemode: boolean;
    amountTotal: number | null;
    currency: string | null;
    reservationId: string | null;
    attemptId: string | null;
  } | null = null;
  let supabaseMode = true;
  const resetStripeCounters = () => {
    stripeCreateCalls = 0;
    stripeRetrieveCalls = 0;
    stripeCreateParams = null;
  };
  return {
    rpcHandlers,
    resetStripeCounters,
    getStripeCreateCalls: () => stripeCreateCalls,
    getStripeRetrieveCalls: () => stripeRetrieveCalls,
    getStripeCreateParams: () => stripeCreateParams,
    setStripeCreateShouldThrow: (v: { code: string; message: string } | null) => {
      stripeCreateShouldThrow = v;
    },
    setStripeRetrieveResult: (v: typeof stripeRetrieveResult) => {
      stripeRetrieveResult = v;
    },
    isSupabaseMode: () => supabaseMode,
    setSupabaseMode: (v: boolean) => {
      supabaseMode = v;
    },
    createDepositCheckoutSession: async (params: Record<string, unknown>) => {
      stripeCreateCalls += 1;
      stripeCreateParams = { ...params };
      if (stripeCreateShouldThrow) {
        throw new (class extends Error {
          code: string;
          constructor(code: string, message: string) {
            super(message);
            this.name = "StripeAdapterError";
            this.code = code;
          }
        })(stripeCreateShouldThrow.code, stripeCreateShouldThrow.message);
      }
      return {
        stripeSessionId: "cs_test_123",
        stripeSessionUrl: "https://checkout.stripe.com/c/cs_test_123",
        expiresAt: params.expiresAt as number,
        status: "open",
        paymentStatus: "unpaid",
        livemode: false,
        amountTotal: params.depositAmountCents as number,
        currency: params.currency as string,
        reservationId: params.reservationMetadataId as string,
        attemptId: params.attemptMetadataId as string,
      };
    },
    retrieveCheckoutSession: async (_id: string, ctx: Record<string, unknown>) => {
      stripeRetrieveCalls += 1;
      if (!stripeRetrieveResult) return null;
      // Validate against ctx like the real adapter does
      if (stripeRetrieveResult.reservationId !== ctx.reservationId) return null;
      if (stripeRetrieveResult.attemptId !== ctx.attemptId) return null;
      if (stripeRetrieveResult.amountTotal !== ctx.depositAmountCents) return null;
      if (stripeRetrieveResult.currency !== ctx.currency) return null;
      return stripeRetrieveResult;
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
      const result = handler(args);
      return { data: result, error: null };
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
    if (!siteUrl || !/^https:\/\//.test(siteUrl)) return null;
    const base = siteUrl.replace(/\/$/, "");
    return {
      successUrl: `${base}/reserve/confirmation?reservation=${encodeURIComponent(reservationId)}`,
      cancelUrl: `${base}/reserve/payment?reservation=${encodeURIComponent(reservationId)}`,
    };
  },
  createDepositCheckoutSession: mocks.createDepositCheckoutSession,
  retrieveCheckoutSession: mocks.retrieveCheckoutSession,
}));

const { createDepositCheckout } = await import("@/lib/server/checkout-service.server");

const RESERVATION_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const HOLD_ID = "55555555-5555-4555-8555-555555555555";
const HOLD_DEADLINE = new Date(Date.now() + 90 * 60 * 1000).toISOString();
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";

function prepareResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true,
    attempt_id: ATTEMPT_ID,
    reservation_id: RESERVATION_ID,
    capacity_hold_id: HOLD_ID,
    stripe_idempotency_key: "sds-deposit:key-1",
    deposit_amount_cents: 5000,
    currency: "usd",
    success_url: `https://sitdownsundays.net/reserve/confirmation?reservation=${RESERVATION_ID}`,
    cancel_url: `https://sitdownsundays.net/reserve/payment?reservation=${RESERVATION_ID}`,
    hold_deadline_at: HOLD_DEADLINE,
    stripe_session_id: null,
    stripe_session_url: null,
    state: "open",
    already_prepared: false,
    ...overrides,
  };
}

function recordResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true,
    attempt_id: ATTEMPT_ID,
    state: "open",
    stripe_session_id: "cs_test_123",
    stripe_session_url: "https://checkout.stripe.com/c/cs_test_123",
    already_recorded: false,
    ...overrides,
  };
}

function validRetrieveResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    stripeSessionId: "cs_existing_1",
    stripeSessionUrl: "https://checkout.stripe.com/c/cs_existing_1",
    expiresAt: Math.floor(new Date(HOLD_DEADLINE).getTime() / 1000),
    status: "open",
    paymentStatus: "unpaid",
    livemode: false,
    amountTotal: 5000,
    currency: "usd",
    reservationId: RESERVATION_ID,
    attemptId: ATTEMPT_ID,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.resetStripeCounters();
  mocks.setStripeCreateShouldThrow(null);
  mocks.setStripeRetrieveResult(null);
  mocks.setSupabaseMode(true);
  mocks.rpcHandlers.prepare_checkout_session_atomic = () => prepareResult();
  mocks.rpcHandlers.record_checkout_session = () => recordResult();
});

describe("createDepositCheckout (mocked boundaries)", () => {
  it("uses the prepared server-stored deposit amount, not browser input", async () => {
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(true);
    expect(mocks.getStripeCreateParams()!["depositAmountCents"]).toBe(5000);
    expect(mocks.getStripeCreateParams()!["currency"]).toBe("usd");
  });

  it("reservation and attempt metadata contain their distinct correct UUIDs", async () => {
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(true);
    const p = mocks.getStripeCreateParams()!;
    expect(p["reservationMetadataId"]).toBe(RESERVATION_ID);
    expect(p["attemptMetadataId"]).toBe(ATTEMPT_ID);
    expect(p["reservationMetadataId"]).not.toBe(p["attemptMetadataId"]);
  });

  it("retries preserve the same Stripe idempotency key and parameters", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () =>
      prepareResult({ already_prepared: true, stripe_idempotency_key: "sds-deposit:original-key" });
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(true);
    expect(mocks.getStripeCreateParams()!["idempotencyKey"]).toBe("sds-deposit:original-key");
  });

  it("recovery returns the correct attempt ID", async () => {
    const customAttempt = "44444444-4444-4444-8444-444444444444";
    mocks.rpcHandlers.prepare_checkout_session_atomic = () =>
      prepareResult({
        attempt_id: customAttempt,
        stripe_session_id: "cs_existing_1",
        stripe_session_url: "https://checkout.stripe.com/c/cs_existing_1",
        already_prepared: true,
      });
    mocks.rpcHandlers.record_checkout_session = (args) =>
      recordResult({
        attempt_id: args["p_attempt_id"] as string,
        stripe_session_id: args["p_stripe_session_id"] as string,
        stripe_session_url: args["p_stripe_session_url"] as string,
      });
    mocks.setStripeRetrieveResult(validRetrieveResult({ attemptId: customAttempt }));
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("session_recovered");
      expect(result.attemptId).toBe(customAttempt);
      expect(result.stripeSessionId).toBe("cs_existing_1");
    }
    expect(mocks.getStripeCreateCalls()).toBe(0);
    expect(mocks.getStripeRetrieveCalls()).toBe(1);
  });

  it("retrieval failure returns a safe uncertain result without creating another session", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () =>
      prepareResult({
        stripe_session_id: "cs_gone_1",
        stripe_session_url: "https://checkout.stripe.com/c/cs_gone_1",
        already_prepared: true,
      });
    mocks.setStripeRetrieveResult(null);
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("error");
      expect(result.error).not.toContain("stripe");
    }
    expect(mocks.getStripeCreateCalls()).toBe(0);
    expect(mocks.getStripeRetrieveCalls()).toBe(1);
  });

  it("an open session with ten minutes remaining is recoverable", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () =>
      prepareResult({
        stripe_session_id: "cs_ten_min_1",
        stripe_session_url: "https://checkout.stripe.com/c/cs_ten_min_1",
        already_prepared: true,
      });
    mocks.rpcHandlers.record_checkout_session = (args) =>
      recordResult({
        attempt_id: args["p_attempt_id"] as string,
        stripe_session_id: args["p_stripe_session_id"] as string,
        stripe_session_url: args["p_stripe_session_url"] as string,
      });
    mocks.setStripeRetrieveResult(
      validRetrieveResult({
        stripeSessionId: "cs_ten_min_1",
        stripeSessionUrl: "https://checkout.stripe.com/c/cs_ten_min_1",
      }),
    );
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("session_recovered");
      expect(result.stripeSessionId).toBe("cs_ten_min_1");
    }
    expect(mocks.getStripeCreateCalls()).toBe(0);
  });

  it("expired/completed sessions are not offered for payment", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () =>
      prepareResult({
        stripe_session_id: "cs_completed_1",
        stripe_session_url: "https://checkout.stripe.com/c/cs_completed_1",
        already_prepared: true,
      });
    mocks.setStripeRetrieveResult(null);
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    expect(mocks.getStripeCreateCalls()).toBe(0);
  });

  it("a session for a different reservation is not recovered", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () =>
      prepareResult({
        stripe_session_id: "cs_wrong_1",
        stripe_session_url: "https://checkout.stripe.com/c/cs_wrong_1",
        already_prepared: true,
      });
    mocks.setStripeRetrieveResult(
      validRetrieveResult({
        reservationId: "99999999-9999-4999-8999-999999999999",
      }),
    );
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("error");
    }
    expect(mocks.getStripeCreateCalls()).toBe(0);
  });

  it("ineligible preparation prevents any Stripe call", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () => ({
      ok: false,
      code: "invalid_status",
    });
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    expect(mocks.getStripeCreateCalls()).toBe(0);
    expect(mocks.getStripeRetrieveCalls()).toBe(0);
  });

  it("a released hold blocks checkout before any Stripe call", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () => ({
      ok: false,
      code: "hold_released",
    });
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    expect(mocks.getStripeCreateCalls()).toBe(0);
  });

  it("already-succeeded attempts return already_satisfied, not a payable session", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () => ({
      ok: false,
      code: "already_satisfied",
    });
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unavailable");
      expect(result.code).toBe("already_satisfied");
    }
    expect(mocks.getStripeCreateCalls()).toBe(0);
  });

  it("Stripe timeout produces an uncertain error outcome, not a new attempt", async () => {
    mocks.setStripeCreateShouldThrow({ code: "stripe_error", message: "timeout" });
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("error");
      expect(result.error).not.toContain("timeout");
      expect(result.error).not.toContain("stripe");
    }
    expect(mocks.getStripeCreateCalls()).toBe(1);
  });

  it("recording failure after Stripe success does not claim payment or reservation failure", async () => {
    mocks.rpcHandlers.record_checkout_session = () => ({ ok: false, code: "conflict" });
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(mocks.getStripeCreateCalls()).toBe(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("error");
      expect(result.error).toContain("reload");
    }
  });

  it("insufficient remaining time blocks rather than extending the deadline", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () =>
      prepareResult({ hold_deadline_at: new Date(Date.now() + 600000).toISOString() });
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unavailable");
      expect(result.code).toBe("insufficient_time");
    }
    expect(mocks.getStripeCreateCalls()).toBe(0);
  });

  it("does not invoke capacity/reservation/cancellation RPCs", async () => {
    const invoked: string[] = [];
    const orig = { ...mocks.rpcHandlers };
    for (const k of Object.keys(orig)) {
      mocks.rpcHandlers[k] = (a) => {
        invoked.push(k);
        return orig[k](a);
      };
    }
    await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(invoked).toContain("prepare_checkout_session_atomic");
    expect(invoked).toContain("record_checkout_session");
    expect(invoked).not.toContain("cancel_reservation_atomic");
    expect(invoked).not.toContain("confirm_reservation_atomic");
    expect(invoked).not.toContain("submit_reservation_request_atomic");
    expect(invoked).not.toContain("acquire_reservation_capacity_atomic");
    expect(invoked).not.toContain("release_reservation_capacity_atomic");
  });

  it("invalid reservation ID is rejected before any database or Stripe call", async () => {
    const result = await createDepositCheckout(
      { reservationId: "not-a-uuid", successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    expect(mocks.getStripeCreateCalls()).toBe(0);
  });

  it("non-supabase mode is unavailable", async () => {
    mocks.setSupabaseMode(false);
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unavailable");
    }
    expect(mocks.getStripeCreateCalls()).toBe(0);
  });

  it("malformed RPC results are rejected safely", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () => ({
      ok: true,
      attempt_id: "not-a-uuid",
    });
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
  });

  it("malformed record RPC results are rejected safely", async () => {
    mocks.rpcHandlers.record_checkout_session = () => ({ ok: true, attempt_id: "not-a-uuid" });
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("error");
    }
  });

  it("transport exceptions are caught at the boundary", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () => {
      throw new Error("connection refused");
    };
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("error");
      expect(result.error).not.toContain("connection refused");
    }
  });

  it("does not mark paid, confirm, or release capacity", async () => {
    const invoked: string[] = [];
    const orig = { ...mocks.rpcHandlers };
    for (const k of Object.keys(orig)) {
      mocks.rpcHandlers[k] = (a) => {
        invoked.push(k);
        return orig[k](a);
      };
    }
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(true);
    expect(invoked).not.toContain("release_reservation_capacity_atomic");
    expect(invoked).not.toContain("confirm_reservation_atomic");
    expect(invoked).not.toContain("confirm_reservation_capacity_atomic");
  });

  it("a prepare response for a different reservation is rejected", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () =>
      prepareResult({
        reservation_id: "99999999-9999-4999-8999-999999999999",
      });
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    expect(mocks.getStripeCreateCalls()).toBe(0);
  });

  it("a prepare response with EUR currency is rejected", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () => prepareResult({ currency: "eur" });
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    expect(mocks.getStripeCreateCalls()).toBe(0);
  });

  it("a cancelled prepared attempt blocks Checkout creation", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () =>
      prepareResult({ state: "cancelled" as string });
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    expect(mocks.getStripeCreateCalls()).toBe(0);
  });

  it("recovery rejects the wrong amount", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () =>
      prepareResult({
        stripe_session_id: "cs_existing_1",
        stripe_session_url: "https://checkout.stripe.com/c/cs_existing_1",
        already_prepared: true,
      });
    mocks.setStripeRetrieveResult(validRetrieveResult({ amountTotal: 9999 }));
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    expect(mocks.getStripeCreateCalls()).toBe(0);
  });

  it("recovery rejects the wrong attempt ID", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () =>
      prepareResult({
        stripe_session_id: "cs_existing_1",
        stripe_session_url: "https://checkout.stripe.com/c/cs_existing_1",
        already_prepared: true,
      });
    mocks.setStripeRetrieveResult(
      validRetrieveResult({
        attemptId: "99999999-9999-4999-8999-999999999999",
      }),
    );
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    expect(mocks.getStripeCreateCalls()).toBe(0);
  });

  it("recovery rejects an expiry already in the past", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () =>
      prepareResult({
        stripe_session_id: "cs_existing_1",
        stripe_session_url: "https://checkout.stripe.com/c/cs_existing_1",
        already_prepared: true,
      });
    mocks.setStripeRetrieveResult(
      validRetrieveResult({
        expiresAt: Math.floor(Date.now() / 1000) - 100,
      }),
    );
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    expect(mocks.getStripeCreateCalls()).toBe(0);
  });

  it("recovery rejects livemode:true", async () => {
    mocks.rpcHandlers.prepare_checkout_session_atomic = () =>
      prepareResult({
        stripe_session_id: "cs_existing_1",
        stripe_session_url: "https://checkout.stripe.com/c/cs_existing_1",
        already_prepared: true,
      });
    mocks.setStripeRetrieveResult(validRetrieveResult({ livemode: true }));
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    expect(mocks.getStripeCreateCalls()).toBe(0);
  });

  it("record RPC must return the sent session ID and URL", async () => {
    mocks.rpcHandlers.record_checkout_session = () =>
      recordResult({
        stripe_session_id: "cs_different",
        stripe_session_url: "https://checkout.stripe.com/c/cs_different",
      });
    const result = await createDepositCheckout(
      { reservationId: RESERVATION_ID, successUrl: "", cancelUrl: "" },
      ACTOR_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("error");
    }
  });
});
