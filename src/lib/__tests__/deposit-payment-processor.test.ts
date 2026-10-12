/**
 * Mocked-boundary verification of the deposit payment processor.
 *
 * Exercises the real processDepositPayment() with mocked Stripe SDK,
 * mocked admin client, and mocked env detection. NOT live Stripe or
 * live PostgreSQL verification.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { StripeWebhookEvent } from "@/lib/server/stripe-webhook.server";

// --- Hoisted mocks --------------------------------------------------------

const mocks = vi.hoisted(() => ({
  sessionRetrieve: vi.fn(),
  piRetrieve: vi.fn(),
  getAdminClient: vi.fn(),
  isSupabaseMode: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: function MockStripe() {
    return {
      checkout: { sessions: { retrieve: mocks.sessionRetrieve } },
      paymentIntents: { retrieve: mocks.piRetrieve },
    };
  },
}));

vi.mock("@/lib/server/env.server", () => ({
  isSupabaseMode: mocks.isSupabaseMode,
}));

vi.mock("@/lib/server/supabase-admin.server", () => ({
  getAdminClient: mocks.getAdminClient,
}));

// --- Fixtures -------------------------------------------------------------

const RESERVATION_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";
const HOLD_ID = "22222222-2222-4222-8222-222222222222";
const PAYMENT_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_ID = "cs_test_001";
const PI_ID = "pi_test_001";
const EVENT_ID = "evt_test_001";
const AMOUNT = 5000;

const FUTURE_SEC = Math.floor(Date.now() / 1000) + 3600;
const FUTURE_ISO = new Date(FUTURE_SEC * 1000).toISOString();

function createEvent(overrides: Partial<StripeWebhookEvent> = {}): StripeWebhookEvent {
  return {
    eventId: EVENT_ID,
    eventType: "checkout.session.completed",
    sessionId: SESSION_ID,
    paymentStatus: "paid",
    mode: "payment",
    amountTotal: AMOUNT,
    currency: "usd",
    paymentIntentId: PI_ID,
    livemode: false,
    reservationId: RESERVATION_ID,
    attemptId: ATTEMPT_ID,
    ...overrides,
  };
}

function createSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SESSION_ID,
    livemode: false,
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    amount_total: AMOUNT,
    currency: "usd",
    payment_intent: PI_ID,
    metadata: {
      reservation_id: RESERVATION_ID,
      attempt_id: ATTEMPT_ID,
    },
    expires_at: FUTURE_SEC,
    url: null,
    ...overrides,
  };
}

function createPaymentIntent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PI_ID,
    livemode: false,
    status: "succeeded",
    currency: "usd",
    amount_received: AMOUNT,
    metadata: {
      reservation_id: RESERVATION_ID,
      attempt_id: ATTEMPT_ID,
    },
    ...overrides,
  };
}

function createAttempt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ATTEMPT_ID,
    reservation_id: RESERVATION_ID,
    capacity_hold_id: HOLD_ID,
    stripe_idempotency_key: "sds-deposit:test-key",
    deposit_amount_cents: AMOUNT,
    currency: "usd",
    hold_deadline_at: FUTURE_ISO,
    stripe_session_id: null,
    state: "open",
    ...overrides,
  };
}

function createRpcResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    reservation_id: RESERVATION_ID,
    attempt_id: ATTEMPT_ID,
    payment_id: PAYMENT_ID,
    outcome: "applied",
    review_reason: null,
    balance_applied: true,
    already_processed: false,
    ...overrides,
  };
}

function mockClient(options: {
  attempt?: Record<string, unknown> | null;
  attemptError?: unknown;
  rpcData?: unknown;
  rpcError?: unknown;
}) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() => ({
            data: options.attempt ?? null,
            error: options.attemptError ?? null,
          })),
        })),
      })),
    })),
    rpc: vi.fn(() => ({
      data: options.rpcData ?? null,
      error: options.rpcError ?? null,
    })),
  };
}

// --- Setup / teardown -----------------------------------------------------

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_mock_key");
  mocks.isSupabaseMode.mockReturnValue(true);
  mocks.sessionRetrieve.mockResolvedValue(createSession());
  mocks.piRetrieve.mockResolvedValue(createPaymentIntent());
  mocks.getAdminClient.mockReturnValue(
    mockClient({
      attempt: createAttempt(),
      rpcData: createRpcResult(),
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("processDepositPayment — normal success", () => {
  it("returns processed/applied for a matching paid Session", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "processed") {
      expect(result.outcome).toBe("applied");
      expect(result.paymentId).toBe(PAYMENT_ID);
      expect(result.reservationId).toBe(RESERVATION_ID);
      expect(result.attemptId).toBe(ATTEMPT_ID);
      expect(result.alreadyProcessed).toBe(false);
      expect(result.reviewReason).toBeNull();
    }
  });

  it("returns processed/applied with already_processed=true for a duplicate", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.getAdminClient.mockReturnValue(
      mockClient({
        attempt: createAttempt(),
        rpcData: createRpcResult({ already_processed: true }),
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "processed") {
      expect(result.outcome).toBe("applied");
      expect(result.alreadyProcessed).toBe(true);
    }
  });

  it("passes the correct RPC name and arguments", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    const client = mockClient({
      attempt: createAttempt(),
      rpcData: createRpcResult(),
    });
    mocks.getAdminClient.mockReturnValue(client);
    await processDepositPayment(createEvent());
    expect(client.rpc).toHaveBeenCalledWith("apply_verified_reservation_deposit_atomic", {
      p_event_id: EVENT_ID,
      p_event_type: "checkout.session.completed",
      p_attempt_id: ATTEMPT_ID,
      p_reservation_id: RESERVATION_ID,
      p_stripe_session_id: SESSION_ID,
      p_payment_intent_id: PI_ID,
      p_amount_cents: AMOUNT,
      p_currency: "usd",
      p_livemode: false,
      p_payment_status: "paid",
      p_payment_intent_status: "succeeded",
    });
  });

  it("handles async_payment_succeeded event type", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    const result = await processDepositPayment(
      createEvent({ eventType: "checkout.session.async_payment_succeeded" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "processed") {
      expect(result.outcome).toBe("applied");
    }
  });
});

describe("processDepositPayment — review_required", () => {
  it("returns processed/review_required with a reason", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.getAdminClient.mockReturnValue(
      mockClient({
        attempt: createAttempt(),
        rpcData: createRpcResult({
          outcome: "review_required",
          review_reason: "financial_state_requires_review",
          balance_applied: false,
        }),
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "processed") {
      expect(result.outcome).toBe("review_required");
      expect(result.reviewReason).toBe("financial_state_requires_review");
    }
  });

  it("rejects review_required with empty review_reason", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.getAdminClient.mockReturnValue(
      mockClient({
        attempt: createAttempt(),
        rpcData: createRpcResult({
          outcome: "review_required",
          review_reason: "",
          balance_applied: false,
        }),
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });
});

describe("processDepositPayment — unpaid session", () => {
  it("returns unpaid_ignored for a completed-but-unpaid Session", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.sessionRetrieve.mockResolvedValue(createSession({ payment_status: "unpaid" }));
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("unpaid_ignored");
    }
  });

  it("does not call the RPC for an unpaid Session", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    const client = mockClient({
      attempt: createAttempt(),
      rpcData: createRpcResult(),
    });
    mocks.getAdminClient.mockReturnValue(client);
    mocks.sessionRetrieve.mockResolvedValue(createSession({ payment_status: "unpaid" }));
    await processDepositPayment(createEvent());
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe("processDepositPayment — identity mismatches", () => {
  it("rejects a session with the wrong session ID", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.sessionRetrieve.mockResolvedValue(createSession({ id: "cs_test_other" }));
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });

  it("rejects a session with wrong reservation metadata", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.sessionRetrieve.mockResolvedValue(
      createSession({
        metadata: {
          reservation_id: "55555555-5555-4555-8555-555555555555",
          attempt_id: ATTEMPT_ID,
        },
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });

  it("rejects a PaymentIntent with wrong reservation metadata", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.piRetrieve.mockResolvedValue(
      createPaymentIntent({
        metadata: {
          reservation_id: "55555555-5555-4555-8555-555555555555",
          attempt_id: ATTEMPT_ID,
        },
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });

  it("rejects a stored attempt for a different reservation", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.getAdminClient.mockReturnValue(
      mockClient({
        attempt: createAttempt({ reservation_id: "55555555-5555-4555-8555-555555555555" }),
        rpcData: createRpcResult(),
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });

  it("rejects a valid attempt row with a different ID but matching reservation and financials", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    const client = mockClient({
      attempt: createAttempt({ id: "55555555-5555-4555-8555-555555555555" }),
      rpcData: createRpcResult(),
    });
    mocks.getAdminClient.mockReturnValue(client);
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects an already-bound session ID that does not match", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.getAdminClient.mockReturnValue(
      mockClient({
        attempt: createAttempt({ stripe_session_id: "cs_test_other" }),
        rpcData: createRpcResult(),
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });

  it("accepts a null stored session ID (webhook before recording)", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.getAdminClient.mockReturnValue(
      mockClient({
        attempt: createAttempt({ stripe_session_id: null }),
        rpcData: createRpcResult(),
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(true);
  });
});

describe("processDepositPayment — financial mismatches", () => {
  it("rejects a wrong amount in the session", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.sessionRetrieve.mockResolvedValue(createSession({ amount_total: 6000 }));
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });

  it("rejects a wrong amount in the stored attempt", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.getAdminClient.mockReturnValue(
      mockClient({
        attempt: createAttempt({ deposit_amount_cents: 6000 }),
        rpcData: createRpcResult(),
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });

  it("rejects a wrong currency in the session", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.sessionRetrieve.mockResolvedValue(createSession({ currency: "eur" }));
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });

  it("rejects a PaymentIntent amount_received that does not match", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.piRetrieve.mockResolvedValue(createPaymentIntent({ amount_received: 6000 }));
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });

  it("rejects a PaymentIntent that has not succeeded", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.piRetrieve.mockResolvedValue(createPaymentIntent({ status: "requires_action" }));
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });
});

describe("processDepositPayment — live mode rejection", () => {
  it("rejects a live-mode session", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.sessionRetrieve.mockResolvedValue(createSession({ livemode: true }));
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });

  it("rejects a live-mode PaymentIntent", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.piRetrieve.mockResolvedValue(createPaymentIntent({ livemode: true }));
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });
});

describe("processDepositPayment — deadline validation", () => {
  it("accepts a paid Session with a past deadline (delayed webhook)", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    const pastSec = Math.floor(Date.now() / 1000) - 3600;
    const pastIso = new Date(pastSec * 1000).toISOString();
    mocks.sessionRetrieve.mockResolvedValue(createSession({ expires_at: pastSec }));
    mocks.getAdminClient.mockReturnValue(
      mockClient({
        attempt: createAttempt({ hold_deadline_at: pastIso }),
        rpcData: createRpcResult(),
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(true);
  });

  it("rejects a session expires_at that does not match the stored deadline", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.sessionRetrieve.mockResolvedValue(createSession({ expires_at: FUTURE_SEC + 1800 }));
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });
});

describe("processDepositPayment — missing URL / webhook before recording", () => {
  it("processes a session with url=null (completed session has no checkout URL)", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.sessionRetrieve.mockResolvedValue(createSession({ url: null }));
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(true);
  });
});

describe("processDepositPayment — RPC failures", () => {
  it("returns an error when the RPC returns an error", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.getAdminClient.mockReturnValue(
      mockClient({
        attempt: createAttempt(),
        rpcData: null,
        rpcError: { message: "Database error" },
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("Database error");
    }
  });

  it("returns an error for a malformed RPC response (ok=false)", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.getAdminClient.mockReturnValue(
      mockClient({
        attempt: createAttempt(),
        rpcData: { ok: false, code: "conflict" },
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });

  it("returns an error for a malformed RPC response (missing fields)", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.getAdminClient.mockReturnValue(
      mockClient({
        attempt: createAttempt(),
        rpcData: { ok: true },
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });

  it("returns an error when the RPC reservation_id does not match", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.getAdminClient.mockReturnValue(
      mockClient({
        attempt: createAttempt(),
        rpcData: createRpcResult({
          reservation_id: "55555555-5555-4555-8555-555555555555",
        }),
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });

  it("returns an error when the RPC outcome=applied but review_reason is non-null", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.getAdminClient.mockReturnValue(
      mockClient({
        attempt: createAttempt(),
        rpcData: createRpcResult({ review_reason: "unexpected" }),
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });

  it("returns an error when the RPC outcome=applied but balance_applied is false", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.getAdminClient.mockReturnValue(
      mockClient({
        attempt: createAttempt(),
        rpcData: createRpcResult({ balance_applied: false }),
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });
});

describe("processDepositPayment — Stripe/network errors", () => {
  it("returns a safe error when session retrieval throws", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.sessionRetrieve.mockRejectedValue(new Error("Network timeout"));
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("Network timeout");
    }
  });

  it("returns a safe error when PaymentIntent retrieval throws", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.piRetrieve.mockRejectedValue(new Error("Connection refused"));
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("Connection refused");
    }
  });
});

describe("processDepositPayment — database errors", () => {
  it("returns a safe error when the attempt read fails", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.getAdminClient.mockReturnValue(
      mockClient({
        attempt: null,
        attemptError: { message: "Permission denied" },
        rpcData: createRpcResult(),
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("Permission denied");
    }
  });

  it("returns a safe error when the attempt is not found", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.getAdminClient.mockReturnValue(
      mockClient({
        attempt: null,
        rpcData: createRpcResult(),
      }),
    );
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });
});

describe("processDepositPayment — environment", () => {
  it("returns an error in non-Supabase mode", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    mocks.isSupabaseMode.mockReturnValue(false);
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });

  it("returns an error when Stripe is not configured", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
  });

  it("rejects a live Stripe key before any network call", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_real_key");
    const result = await processDepositPayment(createEvent());
    expect(result.ok).toBe(false);
    expect(mocks.sessionRetrieve).not.toHaveBeenCalled();
  });
});

describe("processDepositPayment — no payment/status/capacity writes", () => {
  it("does not update reservation status or capacity directly", async () => {
    const { processDepositPayment } = await import("@/lib/server/deposit-payment-processor.server");
    const client = mockClient({
      attempt: createAttempt(),
      rpcData: createRpcResult(),
    });
    mocks.getAdminClient.mockReturnValue(client);
    await processDepositPayment(createEvent());
    // Only one from() call (the attempt read) and one rpc() call.
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    // The from() call is only for reading the attempt, not for writes.
    const fromArg = client.from.mock.calls[0]?.[0];
    expect(fromArg).toBe("reservation_checkout_attempts");
  });
});
