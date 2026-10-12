/**
 * Stripe Checkout-session attempt types for the deposit collection flow.
 *
 * Client-safe: type definitions only. No server-only imports, no secrets.
 */

/** Lifecycle state of a checkout attempt (mirrors the DB enum). */
export type CheckoutAttemptState = "open" | "succeeded" | "expired" | "cancelled";

/** Result of preparing a checkout session (create or recover). */
export interface PreparedCheckoutAttempt {
  attemptId: string;
  stripeIdempotencyKey: string;
  depositAmountCents: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  holdDeadlineAt: string;
  stripeSessionId: string | null;
  stripeSessionUrl: string | null;
  state: CheckoutAttemptState;
  alreadyPrepared: boolean;
}

/**
 * Result of creating or recovering a Stripe Checkout Session for a deposit.
 *
 * - "session_created": a new session was created from a fresh attempt.
 * - "session_recovered": an existing open session was recovered (same key).
 * - "unavailable": the reservation/hold is not eligible or time is
 *   insufficient for a Stripe session. No session was created.
 * - "error": a safe failure — the Stripe call could not be completed or its
 *   result could not be recorded. The outcome is uncertain, not a confirmed
 *   failure or permission to retry with a new attempt.
 */
export type CheckoutSessionOutcome =
  | {
      ok: true;
      kind: "session_created";
      attemptId: string;
      stripeSessionId: string;
      stripeSessionUrl: string;
    }
  | {
      ok: true;
      kind: "session_recovered";
      attemptId: string;
      stripeSessionId: string;
      stripeSessionUrl: string;
    }
  | { ok: false; kind: "unavailable"; code: string; error: string }
  | { ok: false; kind: "error"; code: string; error: string };

/** Safe failure codes for the checkout service. */
export type CheckoutFailureCode =
  | "invalid_actor"
  | "invalid_data"
  | "not_found"
  | "conflict"
  | "invalid_status"
  | "hold_not_found"
  | "hold_released"
  | "already_satisfied"
  | "insufficient_time"
  | "invalid_amount"
  | "approval_required"
  | "checkout_requires_review"
  | "stripe_error"
  | "unexpected";

/** Input for the checkout service. */
export interface CreateCheckoutSessionInput {
  reservationId: string;
  successUrl: string;
  cancelUrl: string;
}
