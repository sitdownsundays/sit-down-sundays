/**
 * SERVER-ONLY — Stripe webhook signature verification and event extraction.
 *
 * Reads STRIPE_WEBHOOK_SECRET at call time from the server environment.
 * Uses the official Stripe SDK to verify the Stripe-Signature header against
 * the exact raw request body — never re-serializes parsed JSON before
 * verification.
 *
 * Blocked from the client bundle by filename (*.server.ts).
 * Never logs secrets, signatures, full payloads, customer details, or
 * Checkout URLs.
 */
import Stripe from "stripe";

/** Secret read at call time, never at module scope. */
function readWebhookSecret(): string | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || secret.trim() === "") return null;
  return secret;
}

/** Event types we recognize as deposit-payment confirmations. */
const RECOGNIZED_EVENT_TYPES = new Set<string>([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

/** Typed candidate extracted from a recognized Checkout Session event. */
export interface StripeWebhookEvent {
  eventId: string;
  eventType: string;
  sessionId: string;
  paymentStatus: string;
  mode: string;
  amountTotal: number | null;
  currency: string | null;
  paymentIntentId: string | null;
  livemode: boolean;
  reservationId: string | null;
  attemptId: string | null;
}

export type VerifyResult =
  | { ok: true; kind: "recognized"; event: StripeWebhookEvent }
  | { ok: true; kind: "ignored" }
  | { ok: false; reason: "invalid_signature"; status: 400 }
  | { ok: false; reason: "unconfigured"; status: 503 }
  | { ok: false; reason: "live_mode"; status: 400 }
  | { ok: false; reason: "malformed"; status: 400 };

/**
 * Verify the Stripe-Signature header against the raw request body and extract
 * a typed candidate from a recognized event.
 *
 * Extraction is NOT proof that the payment belongs to a valid reservation.
 * Database matching and atomic payment recording remain the next step.
 */
export async function verifyStripeWebhook(
  rawPayload: string,
  signature: string | null,
): Promise<VerifyResult> {
  const secret = readWebhookSecret();
  if (!secret) {
    return { ok: false, reason: "unconfigured", status: 503 };
  }

  if (!signature || signature.trim() === "") {
    return { ok: false, reason: "invalid_signature", status: 400 };
  }

  let event: Stripe.Event;

  try {
    // constructEvent verifies the signature against the exact raw payload
    // string and applies Stripe's default timestamp tolerance (300s).
    // It throws on any verification failure — wrong secret, altered body,
    // or expired timestamp.
    const stripe = new Stripe(secret);
    event = await stripe.webhooks.constructEventAsync(rawPayload, signature, secret);
  } catch {
    return { ok: false, reason: "invalid_signature", status: 400 };
  }

  // Sandbox only — reject live-mode events.
  if (event.livemode) {
    return { ok: false, reason: "live_mode", status: 400 };
  }

  // Unsupported event types that are correctly signed may be acknowledged.
  if (!RECOGNIZED_EVENT_TYPES.has(event.type)) {
    return { ok: true, kind: "ignored" };
  }

  // Recognized event: validate data.object is a Checkout Session and extract
  // a typed candidate. Extraction is NOT payment confirmation.
  const session = event.data.object as Stripe.Checkout.Session;

  if (!session || typeof session !== "object" || session.object !== "checkout.session") {
    return { ok: false, reason: "malformed", status: 400 };
  }

  const metadata = session.metadata ?? {};

  const extracted: StripeWebhookEvent = {
    eventId: event.id,
    eventType: event.type,
    sessionId: session.id,
    paymentStatus: session.payment_status,
    mode: session.mode,
    amountTotal: typeof session.amount_total === "number" ? session.amount_total : null,
    currency: session.currency ?? null,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
    livemode: session.livemode,
    reservationId: metadata["reservation_id"] ?? null,
    attemptId: metadata["attempt_id"] ?? null,
  };

  return { ok: true, kind: "recognized", event: extracted };
}
