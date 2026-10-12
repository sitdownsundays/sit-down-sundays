/**
 * SERVER-ONLY — Stripe deposit payment processor.
 *
 * Connects the verified Stripe webhook receiver to the atomic deposit
 * recording RPC. Retrieves the Checkout Session and PaymentIntent from
 * Stripe, validates all identities and financial terms, then calls
 * apply_verified_reservation_deposit_atomic.
 *
 * The RPC alone changes balances, reservation status, and capacity.
 * No direct payment/status/capacity updates from TypeScript.
 *
 * Blocked from the client bundle by filename (*.server.ts).
 * Never logs secrets, customer details, or Stripe URLs.
 */
import Stripe from "stripe";
import { z } from "zod";
import { getAdminClient } from "./supabase-admin.server";
import { isSupabaseMode } from "./env.server";
import type { StripeWebhookEvent } from "./stripe-webhook.server";

const SAFE_ERROR = "Payment processing could not be completed.";

// RPC response validation schema.
const rpcResultSchema = z.object({
  ok: z.literal(true),
  reservation_id: z.string().uuid(),
  attempt_id: z.string().uuid(),
  payment_id: z.string().uuid(),
  outcome: z.enum(["applied", "review_required"]),
  review_reason: z.string().nullable(),
  balance_applied: z.boolean(),
  already_processed: z.boolean(),
});

// Stored attempt validation schema.
const attemptSchema = z.object({
  id: z.string().uuid(),
  reservation_id: z.string().uuid(),
  capacity_hold_id: z.string().uuid(),
  stripe_idempotency_key: z.string().min(1),
  deposit_amount_cents: z.number().int().positive(),
  currency: z.literal("usd"),
  hold_deadline_at: z.string().datetime({ offset: true }),
  stripe_session_id: z.string().nullable(),
  state: z.string(),
});

export type DepositProcessingResult =
  | {
      ok: true;
      kind: "processed";
      paymentId: string;
      eventId: string;
      reservationId: string;
      attemptId: string;
      outcome: "applied" | "review_required";
      reviewReason: string | null;
      alreadyProcessed: boolean;
    }
  | { ok: true; kind: "unpaid_ignored" }
  | { ok: false; code: string; error: string };

/** Read the Stripe secret key — sandbox test keys only. */
function readStripeKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.trim() === "") return null;
  if (/^sk_live_/.test(key) || /^rk_live_/.test(key)) return null;
  if (!/^sk_test_/.test(key) && !/^rk_test_/.test(key)) return null;
  return key;
}

function fail(code: string): DepositProcessingResult {
  return { ok: false, code, error: SAFE_ERROR };
}

/**
 * Process a verified Stripe webhook event for a deposit payment.
 *
 * Retrieves the Checkout Session and PaymentIntent from Stripe, reads the
 * stored reservation_checkout_attempts record, validates all identities and
 * financial terms, then calls apply_verified_reservation_deposit_atomic.
 *
 * A paid Session is NOT rejected merely because its deadline is in the past —
 * the database RPC decides whether capacity can still be allocated.
 *
 * A completed Session does not need a usable checkout URL. The webhook can
 * arrive before the application records the Session ID.
 */
export async function processDepositPayment(
  event: StripeWebhookEvent,
): Promise<DepositProcessingResult> {
  if (!isSupabaseMode()) {
    return fail("unexpected");
  }

  // Validate required event fields from the verified webhook.
  if (!event.sessionId || !event.attemptId || !event.reservationId) {
    return fail("invalid_data");
  }

  const key = readStripeKey();
  if (!key) {
    return fail("stripe_error");
  }

  const stripe = new Stripe(key);

  // 1. Retrieve the Checkout Session from Stripe.
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(event.sessionId);
  } catch {
    return fail("stripe_error");
  }

  // 2. Validate the retrieved session — do NOT reuse the open/unpaid
  //    recovery validator; a completed paid Session requires different checks.
  if (session.id !== event.sessionId) return fail("identity_mismatch");
  if (session.livemode !== false) return fail("identity_mismatch");
  if (session.mode !== "payment") return fail("identity_mismatch");
  if (session.status !== "complete") return fail("identity_mismatch");

  // A completed-but-unpaid Session: acknowledge and await a paid event.
  if (session.payment_status === "unpaid") {
    return { ok: true, kind: "unpaid_ignored" };
  }
  if (session.payment_status !== "paid") {
    return fail("payment_mismatch");
  }

  // Session metadata must match the event's reservation/attempt.
  const sessionMetadata = session.metadata ?? {};
  if (sessionMetadata["reservation_id"] !== event.reservationId) {
    return fail("identity_mismatch");
  }
  if (sessionMetadata["attempt_id"] !== event.attemptId) {
    return fail("identity_mismatch");
  }

  // Session amount and currency must be valid and USD.
  if (
    session.amount_total === null ||
    !Number.isSafeInteger(session.amount_total) ||
    session.amount_total <= 0
  ) {
    return fail("payment_mismatch");
  }
  if (event.amountTotal !== null && session.amount_total !== event.amountTotal) {
    return fail("payment_mismatch");
  }
  if (session.currency !== "usd") {
    return fail("payment_mismatch");
  }

  // Get the PaymentIntent ID from the session.
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : ((session.payment_intent as Stripe.PaymentIntent | null)?.id ?? null);

  if (!paymentIntentId) {
    return fail("identity_mismatch");
  }

  // The event's paymentIntentId (if present) must match the session's.
  if (event.paymentIntentId !== null && event.paymentIntentId !== paymentIntentId) {
    return fail("identity_mismatch");
  }

  // 3. Retrieve the PaymentIntent from Stripe.
  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch {
    return fail("stripe_error");
  }

  // 4. Validate the PaymentIntent.
  if (paymentIntent.id !== paymentIntentId) return fail("identity_mismatch");
  if (paymentIntent.livemode !== false) return fail("identity_mismatch");
  if (paymentIntent.status !== "succeeded") return fail("payment_mismatch");
  if (paymentIntent.currency !== "usd") return fail("payment_mismatch");

  // Amount received must match the session amount and stored deposit.
  const amountReceived = paymentIntent.amount_received;
  if (
    typeof amountReceived !== "number" ||
    !Number.isSafeInteger(amountReceived) ||
    amountReceived !== session.amount_total
  ) {
    return fail("payment_mismatch");
  }

  // PaymentIntent metadata must match.
  const piMetadata = paymentIntent.metadata ?? {};
  if (piMetadata["reservation_id"] !== event.reservationId) return fail("identity_mismatch");
  if (piMetadata["attempt_id"] !== event.attemptId) return fail("identity_mismatch");

  // 5. Read the stored reservation_checkout_attempts record.
  let attemptRow: Record<string, unknown> | null;
  try {
    const client = getAdminClient();
    const { data, error } = await client
      .from("reservation_checkout_attempts")
      .select(
        "id,reservation_id,capacity_hold_id,stripe_idempotency_key,deposit_amount_cents,currency,hold_deadline_at,stripe_session_id,state",
      )
      .eq("id", event.attemptId)
      .maybeSingle();

    if (error) return fail("unexpected");
    attemptRow = data as Record<string, unknown> | null;
  } catch {
    return fail("unexpected");
  }

  if (!attemptRow) {
    return fail("not_found");
  }

  const attemptParsed = attemptSchema.safeParse(attemptRow);
  if (!attemptParsed.success) {
    return fail("unexpected");
  }
  const attempt = attemptParsed.data;

  // The attempt ID from the database query must match the event's attempt ID.
  // The query filter does not replace this boundary validation.
  if (attempt.id !== event.attemptId) return fail("identity_mismatch");

  // Validate attempt against session and event.
  if (attempt.reservation_id !== event.reservationId) return fail("identity_mismatch");
  if (attempt.deposit_amount_cents !== session.amount_total) return fail("payment_mismatch");
  if (attempt.currency !== "usd") return fail("payment_mismatch");

  // Already-bound stored session ID must match (webhook may arrive before
  // the application records the session ID — null is acceptable).
  if (attempt.stripe_session_id !== null && attempt.stripe_session_id !== session.id) {
    return fail("identity_mismatch");
  }

  // Session expires_at matches the stored hold deadline (seconds conversion).
  if (typeof session.expires_at !== "number" || !Number.isInteger(session.expires_at)) {
    return fail("identity_mismatch");
  }
  const deadlineSec = Math.floor(new Date(attempt.hold_deadline_at).getTime() / 1000);
  if (session.expires_at !== deadlineSec) {
    return fail("identity_mismatch");
  }

  // 6. Call apply_verified_reservation_deposit_atomic RPC.
  // All arguments come from verified Stripe objects and the matching stored
  // attempt — never browser amounts.
  let rpcData: unknown;
  try {
    const client = getAdminClient();
    const { data, error } = await client.rpc("apply_verified_reservation_deposit_atomic", {
      p_event_id: event.eventId,
      p_event_type: event.eventType,
      p_attempt_id: attempt.id,
      p_reservation_id: attempt.reservation_id,
      p_stripe_session_id: session.id,
      p_payment_intent_id: paymentIntent.id,
      p_amount_cents: attempt.deposit_amount_cents,
      p_currency: "usd",
      p_livemode: false,
      p_payment_status: "paid",
      p_payment_intent_status: "succeeded",
    });

    if (error) return fail("rpc_failure");
    rpcData = data;
  } catch {
    return fail("unexpected");
  }

  // 7. Validate the RPC response at runtime.
  const rpcParsed = rpcResultSchema.safeParse(rpcData);
  if (!rpcParsed.success) {
    return fail("unexpected");
  }
  const rpc = rpcParsed.data;

  // Validate RPC response identity.
  if (rpc.reservation_id !== attempt.reservation_id) return fail("unexpected");
  if (rpc.attempt_id !== attempt.id) return fail("unexpected");

  // Validate outcome-specific requirements.
  if (rpc.outcome === "applied" && rpc.review_reason !== null) return fail("unexpected");
  if (
    rpc.outcome === "review_required" &&
    (!rpc.review_reason || rpc.review_reason.trim() === "")
  ) {
    return fail("unexpected");
  }
  if (rpc.outcome === "applied" && !rpc.balance_applied) return fail("unexpected");

  // 8. Return the mapped result.
  return {
    ok: true,
    kind: "processed",
    paymentId: rpc.payment_id,
    eventId: event.eventId,
    reservationId: rpc.reservation_id,
    attemptId: rpc.attempt_id,
    outcome: rpc.outcome,
    reviewReason: rpc.review_reason,
    alreadyProcessed: rpc.already_processed,
  };
}
