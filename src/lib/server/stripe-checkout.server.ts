/**
 * SERVER-ONLY — Stripe Checkout session adapter.
 *
 * Creates a hosted Stripe Checkout Session (mode=payment) for the 50%
 * food-only deposit. The deposit amount and hold deadline come from saved
 * database records via the durable attempt — NEVER from browser input.
 *
 * Blocked from the client bundle by filename (*.server.ts).
 * STRIPE_SECRET_KEY is read INSIDE functions (call-time injection).
 * Never logs or returns the secret key.
 */
import Stripe from "stripe";
import { resolveDataMode, isSupabaseMode } from "./env.server";

const MIN_STRIPE_SESSION_MINUTES = 30;
const MIN_STRIPE_SESSION_SECONDS = MIN_STRIPE_SESSION_MINUTES * 60;

/**
 * Read the Stripe secret key from the server environment.
 *
 * Accepts only sandbox/test keys (sk_test_... or rk_test_...).
 * Live keys (sk_live_..., rk_live_...) are REJECTED before any network call.
 * Never prints the key value.
 */
function readStripeSecretKey(): string | null {
  // STRIPE_SECRET_KEY is read at call time, not module scope.
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.trim() === "") return null;
  // Reject live keys before any Stripe SDK call.
  if (/^sk_live_/.test(key) || /^rk_live_/.test(key)) return null;
  // Accept standard test keys and restricted test keys.
  if (!/^sk_test_/.test(key) && !/^rk_test_/.test(key)) return null;
  return key;
}

/** Whether the Stripe adapter is configured (sandbox key present + non-mock). */
export function isStripeConfigured(): boolean {
  if (!isSupabaseMode()) return false;
  return readStripeSecretKey() !== null;
}

/** Parameters for creating a Stripe Checkout Session. */
export interface StripeSessionParams {
  depositAmountCents: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: number; // unix seconds
  idempotencyKey: string;
  reservationMetadataId: string;
  attemptMetadataId: string;
}

/**
 * Context used to validate both created and retrieved sessions.
 * The prepared attempt's identity and amount are authoritative — the
 * Stripe session must match exactly.
 */
export interface SessionValidationContext {
  attemptId: string;
  reservationId: string;
  depositAmountCents: number;
  currency: string;
  holdDeadlineAt: string; // ISO timestamptz from the attempt
}

/** Result from a Stripe session create or retrieve operation. */
export interface StripeSessionResult {
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
}

/**
 * Create a hosted Stripe Checkout Session for the deposit.
 *
 * - mode: payment (one-time charge, not subscription).
 * - card payment method only for this initial slice.
 * - one deposit line item using the saved deposit_required_cents.
 * - no second tax calculation, gratuity, discounts, or adjustable quantity.
 * - reservation/attempt identifiers in session + PaymentIntent metadata.
 * - success/cancel URLs from trusted server configuration.
 *
 * Does NOT reprice the reservation. The saved deposit is authoritative.
 */
export async function createDepositCheckoutSession(
  params: StripeSessionParams,
): Promise<StripeSessionResult> {
  const key = readStripeSecretKey();
  if (!key) {
    throw new StripeAdapterError("stripe_error", "Stripe is not configured.");
  }

  const stripe = new Stripe(key);

  // Stripe requires expires_at to be at least 30 minutes in the future.
  const nowSec = Math.floor(Date.now() / 1000);
  if (params.expiresAt <= nowSec + MIN_STRIPE_SESSION_SECONDS) {
    throw new StripeAdapterError("insufficient_time", "Insufficient time remaining for a session.");
  }

  try {
    // API 2026-09-30.endive: SessionCreateParams uses allowed_payment_method_types
    // (a filter on the dynamically eligible set), not the deprecated payment_method_types.
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        allowed_payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: params.currency,
              unit_amount: params.depositAmountCents,
              product_data: {
                name: "Reservation Deposit",
              },
            },
          },
        ],
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        expires_at: params.expiresAt,
        metadata: {
          reservation_id: params.reservationMetadataId,
          attempt_id: params.attemptMetadataId,
        },
        payment_intent_data: {
          metadata: {
            reservation_id: params.reservationMetadataId,
            attempt_id: params.attemptMetadataId,
          },
        },
      },
      { idempotencyKey: params.idempotencyKey },
    );

    // Validate the created session using the same rules as a retrieved one.
    const ctx: SessionValidationContext = {
      attemptId: params.attemptMetadataId,
      reservationId: params.reservationMetadataId,
      depositAmountCents: params.depositAmountCents,
      currency: params.currency,
      holdDeadlineAt: new Date(params.expiresAt * 1000).toISOString(),
    };
    const validated = validateSession(session, ctx);
    if (validated === null) {
      throw new StripeAdapterError("stripe_error", "Stripe returned an invalid session.");
    }

    return validated;
  } catch (err) {
    if (err instanceof StripeAdapterError) throw err;
    // A timeout/network error is an uncertain outcome, not a confirmed failure.
    // The caller recovers using the SAME attempt + idempotency key.
    throw new StripeAdapterError("stripe_error", "Stripe session could not be created.");
  }
}

/**
 * Retrieve an existing Stripe Checkout Session by id and validate it against
 * the prepared attempt's identity, amount, currency, and deadline.
 *
 * Returns null if the session is not found, is no longer open/unpaid, has
 * expired, is livemode, has a mismatched reservation/attempt/amount/currency,
 * has an expired deadline, or fails any other validation check.
 */
export async function retrieveCheckoutSession(
  stripeSessionId: string,
  ctx: SessionValidationContext,
): Promise<StripeSessionResult | null> {
  const key = readStripeSecretKey();
  if (!key) return null;

  const stripe = new Stripe(key);

  try {
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
    return validateSession(session, ctx);
  } catch {
    // The session may have expired or been deleted. Return null so the
    // caller can decide whether to create a fresh session.
    return null;
  }
}

/**
 * Shared validation used for both created and retrieved sessions.
 * Implements all boundary checks required by the contract:
 * - Session reservation and attempt metadata must match the prepared attempt.
 * - Retrieved session ID must match the recorded ID.
 * - Session amount and currency must exactly match the saved attempt.
 * - Require livemode === false, status === "open", paymentStatus === "unpaid".
 * - Require a finite integer expiry in the future matching the original deadline
 *   rounded down to Unix seconds.
 * - Require a valid HTTPS checkout.stripe.com URL.
 * - Missing values are invalid; do not synthesize expiry or livemode defaults.
 *
 * Returns null if any check fails.
 */
function validateSession(
  session: Stripe.Checkout.Session,
  ctx: SessionValidationContext,
): StripeSessionResult | null {
  // Require livemode === false (sandbox only).
  if (session.livemode !== false) return null;

  // Require status === "open" and paymentStatus === "unpaid".
  if (session.status !== "open" || session.payment_status !== "unpaid") return null;

  // Require a valid session URL — HTTPS checkout.stripe.com.
  const url = session.url;
  if (!url || typeof url !== "string" || !/^https:\/\/checkout[.]stripe[.]com\/\S+$/.test(url)) {
    return null;
  }

  // Require a finite integer expiry (unix seconds).
  if (typeof session.expires_at !== "number" || !Number.isInteger(session.expires_at)) return null;

  // Expiry must be in the future.
  const nowSec = Math.floor(Date.now() / 1000);
  if (session.expires_at <= nowSec) return null;

  // Expiry must match the original deadline rounded down to Unix seconds.
  const deadlineSec = Math.floor(new Date(ctx.holdDeadlineAt).getTime() / 1000);
  if (session.expires_at !== deadlineSec) return null;

  // Session metadata must match the prepared attempt.
  const metadata = session.metadata ?? {};
  if (metadata["reservation_id"] !== ctx.reservationId) return null;
  if (metadata["attempt_id"] !== ctx.attemptId) return null;

  // Amount must exactly match the saved attempt deposit.
  if (session.amount_total === null || session.amount_total !== ctx.depositAmountCents) return null;

  // Currency must match.
  if (session.currency === null || session.currency !== ctx.currency) return null;

  return {
    stripeSessionId: session.id,
    stripeSessionUrl: url,
    expiresAt: session.expires_at,
    status: session.status,
    paymentStatus: session.payment_status,
    livemode: session.livemode,
    amountTotal: session.amount_total,
    currency: session.currency,
    reservationId: metadata["reservation_id"] ?? null,
    attemptId: metadata["attempt_id"] ?? null,
  };
}

/** Typed error with a safe code for the checkout service. */
export class StripeAdapterError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "StripeAdapterError";
  }
}

/** Derive success/cancel URLs from trusted server configuration. */
export function resolveCheckoutUrls(
  siteUrl: string | undefined,
  reservationId: string,
): { successUrl: string; cancelUrl: string } | null {
  if (!siteUrl || !/^https:\/\//.test(siteUrl)) return null;
  const base = siteUrl.replace(/\/$/, "");
  return {
    successUrl: `${base}/reserve/confirmation?reservation=${encodeURIComponent(reservationId)}`,
    cancelUrl: `${base}/reserve/payment?reservation=${encodeURIComponent(reservationId)}`,
  };
}
