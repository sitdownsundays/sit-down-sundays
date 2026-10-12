/**
 * Mocked-boundary verification of the Stripe webhook receiver.
 *
 * Uses Stripe's official test-signature utility to generate real Stripe-Signature
 * headers, then exercises the actual verifyStripeWebhook() and the actual
 * /api/stripe/webhook route handler (via its exported handleStripeWebhookPost)
 * with Request objects.
 *
 * NOT live Stripe or production payment verification.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Stripe from "stripe";

const processorMock = vi.hoisted(() => ({
  processDepositPayment: vi.fn(),
}));

vi.mock("@/lib/server/deposit-payment-processor.server", () => ({
  processDepositPayment: processorMock.processDepositPayment,
}));

const SIGNING_SECRET = "whsec_test_secret_for_verification";

function checkoutSessionCompletedPayload(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    id: "evt_test_001",
    object: "event",
    api_version: "2024-06-20",
    created: 1700000000,
    livemode: false,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_001",
        object: "checkout.session",
        payment_status: "paid",
        mode: "payment",
        amount_total: 5000,
        currency: "usd",
        payment_intent: "pi_test_001",
        livemode: false,
        metadata: {
          reservation_id: "11111111-1111-4111-8111-111111111111",
          attempt_id: "33333333-3333-4333-8333-333333333333",
        },
        ...overrides,
      },
    },
    ...overrides,
  });
}

function checkoutSessionAsyncSucceededPayload(
  overrides: Partial<Record<string, unknown>> = {},
): string {
  return JSON.stringify({
    id: "evt_test_002",
    object: "event",
    api_version: "2024-06-20",
    created: 1700000001,
    livemode: false,
    type: "checkout.session.async_payment_succeeded",
    data: {
      object: {
        id: "cs_test_002",
        object: "checkout.session",
        payment_status: "paid",
        mode: "payment",
        amount_total: 5000,
        currency: "usd",
        payment_intent: "pi_test_002",
        livemode: false,
        metadata: {
          reservation_id: "11111111-1111-4111-8111-111111111111",
          attempt_id: "33333333-3333-4333-8333-333333333333",
        },
        ...overrides,
      },
    },
    ...overrides,
  });
}

function unsupportedEventPayload(
  type = "invoice.paid",
  overrides: Partial<Record<string, unknown>> = {},
): string {
  return JSON.stringify({
    id: "evt_test_003",
    object: "event",
    api_version: "2024-06-20",
    created: 1700000002,
    livemode: false,
    type,
    data: {
      object: { id: "in_test_001", object: "invoice", ...overrides },
    },
    ...overrides,
  });
}

function liveModePayload(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    id: "evt_test_live_001",
    object: "event",
    api_version: "2024-06-20",
    created: 1700000003,
    livemode: true,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_live_001",
        object: "checkout.session",
        payment_status: "paid",
        mode: "payment",
        amount_total: 5000,
        currency: "usd",
        livemode: true,
        metadata: {
          reservation_id: "11111111-1111-4111-8111-111111111111",
          attempt_id: "33333333-3333-4333-8333-333333333333",
        },
        ...overrides,
      },
    },
    ...overrides,
  });
}

function signedHeaders(payload: string, secret: string = SIGNING_SECRET): Record<string, string> {
  return {
    "Stripe-Signature": Stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    }),
  };
}

const WEBHOOK_URL = "https://sitdownsundays.net/api/stripe/webhook";

beforeEach(() => {
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SIGNING_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  processorMock.processDepositPayment.mockReset();
  vi.restoreAllMocks();
});

describe("verifyStripeWebhook", () => {
  it("returns recognized for a valid sandbox checkout.session.completed signature", async () => {
    const { verifyStripeWebhook } = await import("@/lib/server/stripe-webhook.server");
    const payload = checkoutSessionCompletedPayload();
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: SIGNING_SECRET,
    });
    const result = await verifyStripeWebhook(payload, signature);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("recognized");
      if (result.kind === "recognized") {
        expect(result.event.eventType).toBe("checkout.session.completed");
        expect(result.event.sessionId).toBe("cs_test_001");
        expect(result.event.paymentStatus).toBe("paid");
        expect(result.event.livemode).toBe(false);
        expect(result.event.reservationId).toBe("11111111-1111-4111-8111-111111111111");
        expect(result.event.attemptId).toBe("33333333-3333-4333-8333-333333333333");
      }
    }
  });

  it("returns recognized for a valid sandbox checkout.session.async_payment_succeeded signature", async () => {
    const { verifyStripeWebhook } = await import("@/lib/server/stripe-webhook.server");
    const payload = checkoutSessionAsyncSucceededPayload();
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: SIGNING_SECRET,
    });
    const result = await verifyStripeWebhook(payload, signature);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("recognized");
    }
  });

  it("rejects a missing signature", async () => {
    const { verifyStripeWebhook } = await import("@/lib/server/stripe-webhook.server");
    const result = await verifyStripeWebhook(checkoutSessionCompletedPayload(), null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_signature");
      expect(result.status).toBe(400);
    }
  });

  it("rejects a wrong signature", async () => {
    const { verifyStripeWebhook } = await import("@/lib/server/stripe-webhook.server");
    const payload = checkoutSessionCompletedPayload();
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: "wrong_secret",
    });
    const result = await verifyStripeWebhook(payload, signature);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_signature");
    }
  });

  it("rejects an altered payload", async () => {
    const { verifyStripeWebhook } = await import("@/lib/server/stripe-webhook.server");
    const payload = checkoutSessionCompletedPayload();
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: SIGNING_SECRET,
    });
    const altered = payload.replace("cs_test_001", "cs_tampered");
    const result = await verifyStripeWebhook(altered, signature);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_signature");
    }
  });

  it("returns unconfigured when the signing secret is missing", async () => {
    const { verifyStripeWebhook } = await import("@/lib/server/stripe-webhook.server");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const result = await verifyStripeWebhook("{}", "t=1,v1=fake");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unconfigured");
      expect(result.status).toBe(503);
    }
  });

  it("rejects a live-mode event", async () => {
    const { verifyStripeWebhook } = await import("@/lib/server/stripe-webhook.server");
    const payload = liveModePayload();
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: SIGNING_SECRET,
    });
    const result = await verifyStripeWebhook(payload, signature);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("live_mode");
      expect(result.status).toBe(400);
    }
  });

  it("returns ignored for an unsupported but correctly signed event", async () => {
    const { verifyStripeWebhook } = await import("@/lib/server/stripe-webhook.server");
    const payload = unsupportedEventPayload();
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: SIGNING_SECRET,
    });
    const result = await verifyStripeWebhook(payload, signature);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("ignored");
    }
  });

  it("rejects a malformed recognized payload (not a checkout session)", async () => {
    const { verifyStripeWebhook } = await import("@/lib/server/stripe-webhook.server");
    const payload = JSON.stringify({
      id: "evt_test_malformed",
      object: "event",
      api_version: "2024-06-20",
      created: 1700000004,
      livemode: false,
      type: "checkout.session.completed",
      data: { object: { id: "not_cs_001", object: "not.checkout.session" } },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: SIGNING_SECRET,
    });
    const result = await verifyStripeWebhook(payload, signature);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("malformed");
      expect(result.status).toBe(400);
    }
  });
});

describe("POST /api/stripe/webhook route handler", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns 200/processed for an applied result", async () => {
    const { handleStripeWebhookPost } = await import("@/routes/api/stripe/webhook");
    processorMock.processDepositPayment.mockResolvedValue({
      ok: true,
      kind: "processed",
      paymentId: "pay_001",
      eventId: "evt_test_001",
      reservationId: "11111111-1111-4111-8111-111111111111",
      attemptId: "33333333-3333-4333-8333-333333333333",
      outcome: "applied",
      reviewReason: null,
      alreadyProcessed: false,
    });
    const payload = checkoutSessionCompletedPayload();
    const headers = signedHeaders(payload);
    const request = new Request(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: payload,
    });
    const response = await handleStripeWebhookPost(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.received).toBe(true);
    expect(body.processed).toBe(true);
    expect(processorMock.processDepositPayment).toHaveBeenCalledTimes(1);
  });

  it("returns 200/processed for a duplicate applied result", async () => {
    const { handleStripeWebhookPost } = await import("@/routes/api/stripe/webhook");
    processorMock.processDepositPayment.mockResolvedValue({
      ok: true,
      kind: "processed",
      paymentId: "pay_001",
      eventId: "evt_test_001",
      reservationId: "11111111-1111-4111-8111-111111111111",
      attemptId: "33333333-3333-4333-8333-333333333333",
      outcome: "applied",
      reviewReason: null,
      alreadyProcessed: true,
    });
    const payload = checkoutSessionCompletedPayload();
    const headers = signedHeaders(payload);
    const request = new Request(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: payload,
    });
    const response = await handleStripeWebhookPost(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.received).toBe(true);
    expect(body.processed).toBe(true);
  });

  it("returns 200/review_required without processed for a review_required result", async () => {
    const { handleStripeWebhookPost } = await import("@/routes/api/stripe/webhook");
    processorMock.processDepositPayment.mockResolvedValue({
      ok: true,
      kind: "processed",
      paymentId: "pay_001",
      eventId: "evt_test_001",
      reservationId: "11111111-1111-4111-8111-111111111111",
      attemptId: "33333333-3333-4333-8333-333333333333",
      outcome: "review_required",
      reviewReason: "financial_state_requires_review",
      alreadyProcessed: false,
    });
    const payload = checkoutSessionCompletedPayload();
    const headers = signedHeaders(payload);
    const request = new Request(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: payload,
    });
    const response = await handleStripeWebhookPost(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.received).toBe(true);
    expect(body.review_required).toBe(true);
    expect(body.processed).toBeUndefined();
    expect(body.receipt_id).toBe("pay_001");
    expect(body.event_id).toBe("evt_test_001");
    expect(body.reason).toBe("financial_state_requires_review");
  });

  it("returns 200/unpaid without processed for an unpaid result", async () => {
    const { handleStripeWebhookPost } = await import("@/routes/api/stripe/webhook");
    processorMock.processDepositPayment.mockResolvedValue({
      ok: true,
      kind: "unpaid_ignored",
    });
    const payload = checkoutSessionCompletedPayload();
    const headers = signedHeaders(payload);
    const request = new Request(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: payload,
    });
    const response = await handleStripeWebhookPost(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.received).toBe(true);
    expect(body.unpaid).toBe(true);
    expect(body.processed).toBeUndefined();
  });

  it("returns 503 for a processor failure", async () => {
    const { handleStripeWebhookPost } = await import("@/routes/api/stripe/webhook");
    processorMock.processDepositPayment.mockResolvedValue({
      ok: false,
      code: "unexpected",
      error: "Payment processing could not be completed.",
    });
    const payload = checkoutSessionCompletedPayload();
    const headers = signedHeaders(payload);
    const request = new Request(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: payload,
    });
    const response = await handleStripeWebhookPost(request);
    expect(response.status).toBe(503);
  });

  it("emits a structured server warning for review_required without customer data", async () => {
    const { handleStripeWebhookPost } = await import("@/routes/api/stripe/webhook");
    processorMock.processDepositPayment.mockResolvedValue({
      ok: true,
      kind: "processed",
      paymentId: "pay_001",
      eventId: "evt_test_001",
      reservationId: "11111111-1111-4111-8111-111111111111",
      attemptId: "33333333-3333-4333-8333-333333333333",
      outcome: "review_required",
      reviewReason: "capacity_hold_requires_review",
      alreadyProcessed: false,
    });
    const payload = checkoutSessionCompletedPayload();
    const headers = signedHeaders(payload);
    const request = new Request(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: payload,
    });
    await handleStripeWebhookPost(request);
    expect(console.warn).toHaveBeenCalledTimes(1);
    const [category, data] = (console.warn as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, Record<string, unknown>];
    expect(typeof category).toBe("string");
    expect(category).toContain("review_required");
    expect(data).toEqual({
      eventId: "evt_test_001",
      receiptId: "pay_001",
      reason: "capacity_hold_requires_review",
    });
    // No customer data, secrets, or Checkout URLs in the warning.
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("stripe_secret");
    expect(serialized).not.toContain("checkout.stripe.com");
  });

  it("does not call the processor for an invalid signature", async () => {
    const { handleStripeWebhookPost } = await import("@/routes/api/stripe/webhook");
    const payload = checkoutSessionCompletedPayload();
    const request = new Request(WEBHOOK_URL, {
      method: "POST",
      body: payload,
    });
    const response = await handleStripeWebhookPost(request);
    expect(response.status).toBe(400);
    expect(processorMock.processDepositPayment).not.toHaveBeenCalled();
  });

  it("returns 200/ignored for a valid unsupported event without calling the processor", async () => {
    const { handleStripeWebhookPost } = await import("@/routes/api/stripe/webhook");
    const payload = unsupportedEventPayload();
    const headers = signedHeaders(payload);
    const request = new Request(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: payload,
    });
    const response = await handleStripeWebhookPost(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.received).toBe(true);
    expect(body.ignored).toBe(true);
    expect(processorMock.processDepositPayment).not.toHaveBeenCalled();
  });

  it("returns 400 for a wrong signature", async () => {
    const { handleStripeWebhookPost } = await import("@/routes/api/stripe/webhook");
    const payload = checkoutSessionCompletedPayload();
    const headers = signedHeaders(payload, "wrong_secret");
    const request = new Request(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: payload,
    });
    const response = await handleStripeWebhookPost(request);
    expect(response.status).toBe(400);
  });

  it("returns 503 when the signing secret is unconfigured", async () => {
    const { handleStripeWebhookPost } = await import("@/routes/api/stripe/webhook");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const request = new Request(WEBHOOK_URL, {
      method: "POST",
      headers: { "Stripe-Signature": "t=1,v1=fake" },
      body: "{}",
    });
    const response = await handleStripeWebhookPost(request);
    expect(response.status).toBe(503);
  });

  it("returns 400 for a live-mode event", async () => {
    const { handleStripeWebhookPost } = await import("@/routes/api/stripe/webhook");
    const payload = liveModePayload();
    const headers = signedHeaders(payload);
    const request = new Request(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: payload,
    });
    const response = await handleStripeWebhookPost(request);
    expect(response.status).toBe(400);
  });

  it("returns 400 for a malformed recognized payload", async () => {
    const { handleStripeWebhookPost } = await import("@/routes/api/stripe/webhook");
    const payload = JSON.stringify({
      id: "evt_test_malformed",
      object: "event",
      api_version: "2024-06-20",
      created: 1700000004,
      livemode: false,
      type: "checkout.session.completed",
      data: { object: { id: "not_cs_001", object: "not.checkout.session" } },
    });
    const headers = signedHeaders(payload);
    const request = new Request(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: payload,
    });
    const response = await handleStripeWebhookPost(request);
    expect(response.status).toBe(400);
  });
});
