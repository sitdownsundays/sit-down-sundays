/**
 * Stripe adapter tests — mock the SDK UNDER the adapter, not by mocking
 * away the adapter itself. Exercises the real stripe-checkout.server.ts
 * logic (key validation, API version, session status checks, insufficient-
 * time guard) with the Stripe SDK constructor mocked.
 */
import type {
  StripeSessionParams,
  SessionValidationContext,
} from "@/lib/server/stripe-checkout.server";
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let stripeKey = "sk_test_sandbox_key_12345";
  let createCalls = 0;
  let retrieveCalls = 0;
  let createParams: Record<string, unknown> | null = null;
  let createOptions: Record<string, unknown> | null = null;
  let createShouldThrow: { code: string; message: string } | null = null;
  let retrieveResult: Record<string, unknown> | null = null;
  return {
    getStripeKey: () => stripeKey,
    setStripeKey: (v: string) => {
      stripeKey = v;
    },
    getCreateCalls: () => createCalls,
    getRetrieveCalls: () => retrieveCalls,
    getCreateParams: () => createParams,
    getCreateOptions: () => createOptions,
    setCreateShouldThrow: (v: { code: string; message: string } | null) => {
      createShouldThrow = v;
    },
    setRetrieveResult: (v: Record<string, unknown> | null) => {
      retrieveResult = v;
    },
    createSession: async (params: Record<string, unknown>, options?: Record<string, unknown>) => {
      createCalls += 1;
      createParams = { ...params };
      createOptions = options ? { ...options } : null;
      if (createShouldThrow) {
        const Err = class extends Error {
          code: string;
          constructor(c: string, m: string) {
            super(m);
            this.name = "StripeAdapterError";
            this.code = c;
          }
        };
        throw new Err(createShouldThrow.code, createShouldThrow.message);
      }
      // The real adapter nests currency/amount inside line_items[0].price_data.
      const lineItems = params.line_items as Array<Record<string, unknown>> | undefined;
      const priceData = lineItems?.[0]?.price_data as Record<string, unknown> | undefined;
      const currency = (priceData?.currency as string) ?? "usd";
      const amount = (priceData?.unit_amount as number) ?? 5000;
      const metadata = params.metadata as Record<string, string> | undefined;
      return {
        id: "cs_test_123",
        url: "https://checkout.stripe.com/c/cs_test_123",
        expires_at: params.expires_at as number,
        status: "open",
        payment_status: "unpaid",
        livemode: false,
        amount_total: amount,
        currency: currency,
        metadata: metadata ?? {},
      };
    },
    retrieveSession: async () => {
      retrieveCalls += 1;
      return retrieveResult;
    },
    reset: () => {
      createCalls = 0;
      retrieveCalls = 0;
      createParams = null;
      createOptions = null;
      createShouldThrow = null;
      retrieveResult = null;
    },
  };
});

vi.mock("@/lib/server/env.server", () => ({
  isSupabaseMode: () => true,
  isMockMode: () => false,
  resolveDataMode: () => ({ dataMode: "supabase", isProduction: false }),
  requireSupabaseEnv: () => ({
    url: "https://example.supabase.co",
    anonKey: "anon",
    serviceRoleKey: "service-role",
    siteUrl: "https://sitdownsundays.net",
  }),
}));

vi.mock("stripe", () => {
  function StripeMock() {
    return {
      checkout: {
        sessions: {
          create: mocks.createSession,
          retrieve: mocks.retrieveSession,
        },
      },
    };
  }
  return { default: StripeMock };
});

const {
  createDepositCheckoutSession,
  retrieveCheckoutSession,
  isStripeConfigured,
  resolveCheckoutUrls,
} = await import("@/lib/server/stripe-checkout.server");

const RES_ID = "11111111-1111-4111-8111-111111111111";
const ATT_ID = "33333333-3333-4333-8333-333333333333";
const HOLD_DEADLINE = new Date(Date.now() + 90 * 60 * 1000).toISOString();
const GOOD_URLS = {
  successUrl: "https://sitdownsundays.net/reserve/confirmation?reservation=test",
  cancelUrl: "https://sitdownsundays.net/reserve/payment?reservation=test",
};

function sessionParams(overrides: Partial<StripeSessionParams> = {}): StripeSessionParams {
  return {
    depositAmountCents: 5000,
    currency: "usd",
    ...GOOD_URLS,
    expiresAt: Math.floor(new Date(HOLD_DEADLINE).getTime() / 1000),
    idempotencyKey: "key-1",
    reservationMetadataId: RES_ID,
    attemptMetadataId: ATT_ID,
    ...overrides,
  };
}

function validationCtx(
  overrides: Partial<SessionValidationContext> = {},
): SessionValidationContext {
  return {
    attemptId: ATT_ID,
    reservationId: RES_ID,
    depositAmountCents: 5000,
    currency: "usd",
    holdDeadlineAt: HOLD_DEADLINE,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.setStripeKey("sk_test_sandbox_key_12345");
  mocks.reset();
  // Re-set process.env for each test
  process.env.STRIPE_SECRET_KEY = mocks.getStripeKey();
});

describe("stripe-checkout adapter (SDK mocked underneath)", () => {
  it("live keys (sk_live_) are blocked before any SDK call", async () => {
    mocks.setStripeKey("sk_live_production_key_67890");
    process.env.STRIPE_SECRET_KEY = mocks.getStripeKey();
    expect(isStripeConfigured()).toBe(false);
    await expect(createDepositCheckoutSession(sessionParams())).rejects.toThrow();
    expect(mocks.getCreateCalls()).toBe(0);
  });

  it("live keys (rk_live_) are blocked before any SDK call", async () => {
    mocks.setStripeKey("rk_live_restricted_key_67890");
    process.env.STRIPE_SECRET_KEY = mocks.getStripeKey();
    expect(isStripeConfigured()).toBe(false);
    expect(mocks.getCreateCalls()).toBe(0);
  });

  it("sandbox keys (sk_test_) are accepted and create a session", async () => {
    expect(isStripeConfigured()).toBe(true);
    const result = await createDepositCheckoutSession(sessionParams());
    expect(result.stripeSessionId).toBe("cs_test_123");
    expect(result.status).toBe("open");
    expect(result.paymentStatus).toBe("unpaid");
    expect(result.livemode).toBe(false);
    expect(mocks.getCreateCalls()).toBe(1);
  });

  it("restricted sandbox keys (rk_test_) are accepted", async () => {
    mocks.setStripeKey("rk_test_restricted_key_67890");
    process.env.STRIPE_SECRET_KEY = mocks.getStripeKey();
    expect(isStripeConfigured()).toBe(true);
  });

  it("insufficient time rejects before any SDK call", async () => {
    await expect(
      createDepositCheckoutSession(
        sessionParams({ expiresAt: Math.floor(Date.now() / 1000) + 600 }),
      ),
    ).rejects.toThrow();
    expect(mocks.getCreateCalls()).toBe(0);
  });

  it("retrieves an existing open, unpaid session successfully", async () => {
    mocks.setRetrieveResult({
      id: "cs_existing_1",
      url: "https://checkout.stripe.com/c/cs_existing_1",
      expires_at: Math.floor(new Date(HOLD_DEADLINE).getTime() / 1000),
      status: "open",
      payment_status: "unpaid",
      livemode: false,
      amount_total: 5000,
      currency: "usd",
      metadata: { reservation_id: RES_ID, attempt_id: ATT_ID },
    });
    const result = await retrieveCheckoutSession("cs_existing_1", validationCtx());
    expect(result).not.toBeNull();
    expect(result!.stripeSessionId).toBe("cs_existing_1");
    expect(result!.status).toBe("open");
    expect(result!.paymentStatus).toBe("unpaid");
    expect(result!.reservationId).toBe(RES_ID);
    expect(result!.attemptId).toBe(ATT_ID);
  });

  it("returns null for a completed/paid session (not payable)", async () => {
    mocks.setRetrieveResult({
      id: "cs_completed_1",
      url: "https://checkout.stripe.com/c/cs_completed_1",
      expires_at: Math.floor(new Date(HOLD_DEADLINE).getTime() / 1000),
      status: "complete",
      payment_status: "paid",
      livemode: false,
      amount_total: 5000,
      currency: "usd",
      metadata: { reservation_id: RES_ID, attempt_id: ATT_ID },
    });
    const result = await retrieveCheckoutSession("cs_completed_1", validationCtx());
    expect(result).toBeNull();
  });

  it("returns null for an expired session (status expired)", async () => {
    mocks.setRetrieveResult({
      id: "cs_expired_1",
      url: "https://checkout.stripe.com/c/cs_expired_1",
      expires_at: Math.floor(Date.now() / 1000) - 100,
      status: "expired",
      payment_status: "unpaid",
      livemode: false,
      amount_total: 5000,
      currency: "usd",
      metadata: { reservation_id: RES_ID, attempt_id: ATT_ID },
    });
    const result = await retrieveCheckoutSession("cs_expired_1", validationCtx());
    expect(result).toBeNull();
  });

  it("returns null for a livemode session", async () => {
    mocks.setRetrieveResult({
      id: "cs_live_1",
      url: "https://checkout.stripe.com/c/cs_live_1",
      expires_at: Math.floor(new Date(HOLD_DEADLINE).getTime() / 1000),
      status: "open",
      payment_status: "unpaid",
      livemode: true,
      amount_total: 5000,
      currency: "usd",
      metadata: { reservation_id: RES_ID, attempt_id: ATT_ID },
    });
    const result = await retrieveCheckoutSession("cs_live_1", validationCtx());
    expect(result).toBeNull();
  });

  it("returns null for a session with mismatched amount", async () => {
    mocks.setRetrieveResult({
      id: "cs_wrong_amt",
      url: "https://checkout.stripe.com/c/cs_wrong_amt",
      expires_at: Math.floor(new Date(HOLD_DEADLINE).getTime() / 1000),
      status: "open",
      payment_status: "unpaid",
      livemode: false,
      amount_total: 9999,
      currency: "usd",
      metadata: { reservation_id: RES_ID, attempt_id: ATT_ID },
    });
    const result = await retrieveCheckoutSession("cs_wrong_amt", validationCtx());
    expect(result).toBeNull();
  });

  it("returns null for a session with mismatched currency", async () => {
    mocks.setRetrieveResult({
      id: "cs_eur",
      url: "https://checkout.stripe.com/c/cs_eur",
      expires_at: Math.floor(new Date(HOLD_DEADLINE).getTime() / 1000),
      status: "open",
      payment_status: "unpaid",
      livemode: false,
      amount_total: 5000,
      currency: "eur",
      metadata: { reservation_id: RES_ID, attempt_id: ATT_ID },
    });
    const result = await retrieveCheckoutSession("cs_eur", validationCtx());
    expect(result).toBeNull();
  });

  it("returns null for a session with mismatched reservation metadata", async () => {
    mocks.setRetrieveResult({
      id: "cs_wrong_res",
      url: "https://checkout.stripe.com/c/cs_wrong_res",
      expires_at: Math.floor(new Date(HOLD_DEADLINE).getTime() / 1000),
      status: "open",
      payment_status: "unpaid",
      livemode: false,
      amount_total: 5000,
      currency: "usd",
      metadata: { reservation_id: "99999999-9999-4999-8999-999999999999", attempt_id: ATT_ID },
    });
    const result = await retrieveCheckoutSession("cs_wrong_res", validationCtx());
    expect(result).toBeNull();
  });

  it("returns null for a session with mismatched attempt metadata", async () => {
    mocks.setRetrieveResult({
      id: "cs_wrong_att",
      url: "https://checkout.stripe.com/c/cs_wrong_att",
      expires_at: Math.floor(new Date(HOLD_DEADLINE).getTime() / 1000),
      status: "open",
      payment_status: "unpaid",
      livemode: false,
      amount_total: 5000,
      currency: "usd",
      metadata: { reservation_id: RES_ID, attempt_id: "99999999-9999-4999-8999-999999999999" },
    });
    const result = await retrieveCheckoutSession("cs_wrong_att", validationCtx());
    expect(result).toBeNull();
  });

  it("returns null for a session with past expiry", async () => {
    mocks.setRetrieveResult({
      id: "cs_past_exp",
      url: "https://checkout.stripe.com/c/cs_past_exp",
      expires_at: Math.floor(Date.now() / 1000) - 100,
      status: "open",
      payment_status: "unpaid",
      livemode: false,
      amount_total: 5000,
      currency: "usd",
      metadata: { reservation_id: RES_ID, attempt_id: ATT_ID },
    });
    const result = await retrieveCheckoutSession("cs_past_exp", validationCtx());
    expect(result).toBeNull();
  });

  it("returns null for a session with mismatched deadline", async () => {
    mocks.setRetrieveResult({
      id: "cs_wrong_deadline",
      url: "https://checkout.stripe.com/c/cs_wrong_deadline",
      expires_at: Math.floor(new Date(HOLD_DEADLINE).getTime() / 1000) + 3600,
      status: "open",
      payment_status: "unpaid",
      livemode: false,
      amount_total: 5000,
      currency: "usd",
      metadata: { reservation_id: RES_ID, attempt_id: ATT_ID },
    });
    const result = await retrieveCheckoutSession("cs_wrong_deadline", validationCtx());
    expect(result).toBeNull();
  });

  it("validates a ten-minute-remaining session with matching deadline", async () => {
    const tenMinDeadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    mocks.setRetrieveResult({
      id: "cs_ten_min",
      url: "https://checkout.stripe.com/c/cs_ten_min",
      expires_at: Math.floor(new Date(tenMinDeadline).getTime() / 1000),
      status: "open",
      payment_status: "unpaid",
      livemode: false,
      amount_total: 5000,
      currency: "usd",
      metadata: { reservation_id: RES_ID, attempt_id: ATT_ID },
    });
    const result = await retrieveCheckoutSession(
      "cs_ten_min",
      validationCtx({ holdDeadlineAt: tenMinDeadline }),
    );
    expect(result).not.toBeNull();
    expect(result!.stripeSessionId).toBe("cs_ten_min");
  });

  it("resolveCheckoutUrls rejects non-https site URLs", () => {
    expect(resolveCheckoutUrls("http://insecure.com", RES_ID)).toBeNull();
    expect(resolveCheckoutUrls(undefined, RES_ID)).toBeNull();
    expect(resolveCheckoutUrls("https://sitdownsundays.net/", RES_ID)).not.toBeNull();
  });

  it("returns session metadata including status, payment_status, livemode, amount, currency", async () => {
    const result = await createDepositCheckoutSession(sessionParams());
    expect(result.status).toBe("open");
    expect(result.paymentStatus).toBe("unpaid");
    expect(result.livemode).toBe(false);
    expect(result.currency).toBe("usd");
    expect(result.reservationId).toBe(RES_ID);
    expect(result.attemptId).toBe(ATT_ID);
  });

  it("creation sends allowed_payment_method_types: ['card']", async () => {
    await createDepositCheckoutSession(sessionParams());
    const params = mocks.getCreateParams()!;
    expect(params["allowed_payment_method_types"]).toEqual(["card"]);
  });

  it("creation does NOT send payment_method_types", async () => {
    await createDepositCheckoutSession(sessionParams());
    const params = mocks.getCreateParams()!;
    expect(params).not.toHaveProperty("payment_method_types");
  });

  it("creation preserves amount, currency, metadata, expiration, URLs, and idempotency key", async () => {
    const key = "sds-deposit:retry-key-2";
    await createDepositCheckoutSession(sessionParams({ idempotencyKey: key }));
    const params = mocks.getCreateParams()!;
    const lineItems = params["line_items"] as Array<Record<string, unknown>>;
    const priceData = lineItems[0]["price_data"] as Record<string, unknown>;
    expect(priceData["currency"]).toBe("usd");
    expect(priceData["unit_amount"]).toBe(5000);
    expect(params["mode"]).toBe("payment");
    expect(params["success_url"]).toBe(GOOD_URLS.successUrl);
    expect(params["cancel_url"]).toBe(GOOD_URLS.cancelUrl);
    expect(params["expires_at"]).toBe(Math.floor(new Date(HOLD_DEADLINE).getTime() / 1000));
    expect(params["metadata"]).toEqual({ reservation_id: RES_ID, attempt_id: ATT_ID });
    const piData = params["payment_intent_data"] as Record<string, unknown>;
    expect(piData["metadata"]).toEqual({ reservation_id: RES_ID, attempt_id: ATT_ID });
  });

  it("initial creation passes the exact idempotencyKey in the request options", async () => {
    const key = "sds-deposit:exact-key-1";
    await createDepositCheckoutSession(sessionParams({ idempotencyKey: key }));
    const options = mocks.getCreateOptions()!;
    expect(options["idempotencyKey"]).toBe(key);
  });

  it("retries use identical parameters and the same idempotency key in options", async () => {
    const key = "sds-deposit:same-key";
    await createDepositCheckoutSession(sessionParams({ idempotencyKey: key }));
    const firstParams = mocks.getCreateParams()!;
    const firstOptions = mocks.getCreateOptions()!;
    await createDepositCheckoutSession(sessionParams({ idempotencyKey: key }));
    const secondParams = mocks.getCreateParams()!;
    const secondOptions = mocks.getCreateOptions()!;
    expect(mocks.getCreateCalls()).toBe(2);
    expect(secondParams).toEqual(firstParams);
    expect(secondOptions).toEqual(firstOptions);
    expect(firstOptions["idempotencyKey"]).toBe(key);
    expect(secondOptions["idempotencyKey"]).toBe(key);
  });
});
