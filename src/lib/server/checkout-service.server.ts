/**
 * SERVER-ONLY — Stripe deposit Checkout session service.
 *
 * Internal, server-only entry point that creates or recovers exactly one
 * Stripe Checkout Session for an existing eligible reservation's 50%
 * food-only deposit.
 *
 * The deposit amount and hold deadline come from saved database records via
 * the durable attempt RPC — NEVER from browser input. A timeout reuses the
 * SAME Stripe idempotency key and exact parameters, never a second session.
 *
 * Creating a Checkout Session does NOT:
 *   - mark the reservation paid or confirmed;
 *   - increase amount_paid_cents;
 *   - allocate or release capacity;
 *   - reset the two-hour hold deadline;
 *   - create another reservation.
 *
 * This is NOT an unauthenticated public endpoint. The caller must verify
 * authorization before invoking this service.
 */
import { z } from "zod";
import { getAdminClient } from "./supabase-admin.server";
import { requireSupabaseEnv, isSupabaseMode } from "./env.server";
import {
  createDepositCheckoutSession,
  retrieveCheckoutSession,
  resolveCheckoutUrls,
  StripeAdapterError,
  type SessionValidationContext,
  type StripeSessionResult,
} from "./stripe-checkout.server";
import type {
  CheckoutSessionOutcome,
  CheckoutFailureCode,
  CreateCheckoutSessionInput,
} from "@/lib/payment/checkout-types";

const MIN_STRIPE_SESSION_MINUTES = 30;
const MIN_STRIPE_SESSION_SECONDS = MIN_STRIPE_SESSION_MINUTES * 60;
const SAFE_ERROR = "Payment setup could not be completed. Please reload and try again.";
const RETRIEVAL_ERROR = "Payment setup could not be verified. Please reload and try again.";

// Runtime validation schema for the prepare RPC success response.
// Validates reservation identity, positive safe-integer amount, USD currency,
// open state, and explicit-timezone deadline.
const preparedSchema = z.object({
  ok: z.literal(true),
  attempt_id: z.string().uuid(),
  reservation_id: z.string().uuid(),
  capacity_hold_id: z.string().uuid(),
  stripe_idempotency_key: z.string().min(1).max(200),
  deposit_amount_cents: z.number().int().positive(),
  currency: z.literal("usd"),
  success_url: z.string().min(1),
  cancel_url: z.string().min(1),
  hold_deadline_at: z.string().datetime({ offset: true }),
  stripe_session_id: z.string().nullable(),
  stripe_session_url: z.string().nullable(),
  state: z.literal("open"),
  already_prepared: z.boolean(),
});

type PreparedData = z.infer<typeof preparedSchema>;

// Runtime validation schema for the record RPC success response.
// Validates the returned identity against the sent attempt ID, session ID,
// URL, and open state — not just the attempt ID.
const recordSchema = z.object({
  ok: z.literal(true),
  attempt_id: z.string().uuid(),
  state: z.literal("open"),
  stripe_session_id: z.string().min(1),
  stripe_session_url: z.string().min(1),
  already_recorded: z.boolean(),
});

type RecordData = z.infer<typeof recordSchema>;

/**
 * Create or recover one Stripe Checkout Session for a reservation deposit.
 *
 * @param input.reservationId - UUID of the reservation.
 * @param input.successUrl / input.cancelUrl - Trusted server-derived URLs.
 * @param actorUserId - Verified actor UUID (NULL = trusted server/system).
 *   Must NOT come from untrusted browser input without verification.
 */
export async function createDepositCheckout(
  input: CreateCheckoutSessionInput,
  actorUserId: string | null,
): Promise<CheckoutSessionOutcome> {
  if (!isSupabaseMode()) {
    return unavailable("invalid_data", "Payment is not available in this environment.");
  }

  if (!input.reservationId || !isValidUuid(input.reservationId)) {
    return unavailable("invalid_data", "Invalid reservation identifier.");
  }

  // Normalize blank URL strings to null before choosing trusted configured URLs.
  // Empty strings previously triggered derivation but ?? then preserved the
  // empty strings. Trim first so whitespace-only counts as blank too.
  const rawSuccess = input.successUrl?.trim() || null;
  const rawCancel = input.cancelUrl?.trim() || null;

  let successUrl = rawSuccess;
  let cancelUrl = rawCancel;
  if (!successUrl || !cancelUrl) {
    try {
      const env = requireSupabaseEnv();
      const derived = resolveCheckoutUrls(env.siteUrl, input.reservationId);
      if (!derived) {
        return unavailable("invalid_data", "Payment URLs are not configured.");
      }
      successUrl = successUrl ?? derived.successUrl;
      cancelUrl = cancelUrl ?? derived.cancelUrl;
    } catch {
      return unavailable("invalid_data", "Payment configuration could not be loaded.");
    }
  }

  try {
    const client = getAdminClient();

    // 1. Prepare or recover the durable attempt via the atomic RPC.
    const rawPrepared = await callPrepareRpc(
      client,
      input.reservationId,
      actorUserId,
      successUrl,
      cancelUrl,
    );

    if (!rawPrepared.ok) {
      const code = narrowFailureCode(rawPrepared.code);
      return unavailable(code, mapRpcCodeToError(code));
    }

    // Check for a succeeded state before schema validation — the RPC should
    // return ok:false for this, but defend against a malformed response.
    if (
      rawPrepared.data &&
      (rawPrepared.data as Record<string, unknown>)["state"] === "succeeded"
    ) {
      return unavailable("already_satisfied", "This deposit has already been collected.");
    }

    // Validate the RPC success response at runtime — not a cast.
    const parsed = preparedSchema.safeParse(rawPrepared.data);
    if (!parsed.success) {
      return unavailable("unexpected", SAFE_ERROR);
    }
    const prepared = parsed.data;

    // Prepared reservation_id must equal the requested UUID.
    if (prepared.reservation_id !== input.reservationId) {
      return unavailable("unexpected", SAFE_ERROR);
    }

    // 2. If the open attempt already has a Stripe session, try to recover it.
    if (prepared.stripe_session_id && prepared.stripe_session_url) {
      const recovered = await recoverSession(
        client,
        prepared,
        prepared.stripe_session_id,
        input.reservationId,
        actorUserId,
      );
      if (recovered === null) {
        // Session not found / expired / failed validation on Stripe's side.
        // The attempt already has a session id, so its Stripe state is
        // uncertain. Do NOT fall through to create a new session — return a
        // safe uncertain result so the caller reloads and retries through
        // the same durable attempt.
        return { ok: false, kind: "error", code: "unexpected", error: RETRIEVAL_ERROR };
      } else if (recovered.ok) {
        return recovered.recovered;
      } else {
        // Retrieval returned a safe uncertain error.
        return recovered.uncertain;
      }
    }

    // 3. Create a new Stripe Checkout Session using the durable key + params.
    return await createNewSession(client, prepared, actorUserId);
  } catch {
    // Catch any uncaught transport/configuration exception at the boundary.
    return { ok: false, kind: "error", code: "unexpected", error: SAFE_ERROR };
  }
}

interface RawRpcResult {
  ok: boolean;
  code?: string;
  data?: Record<string, unknown> | null;
}

async function callPrepareRpc(
  client: ReturnType<typeof getAdminClient>,
  reservationId: string,
  actorUserId: string | null,
  successUrl: string,
  cancelUrl: string,
): Promise<RawRpcResult> {
  const { data, error } = await client.rpc("prepare_checkout_session_atomic", {
    p_reservation_id: reservationId,
    p_actor_user_id: actorUserId,
    p_success_url: successUrl,
    p_cancel_url: cancelUrl,
  });

  if (error) {
    return { ok: false, code: "unexpected" };
  }

  const row = data as Record<string, unknown> | null;
  if (!row || typeof row !== "object") {
    return { ok: false, code: "unexpected" };
  }

  if (row["ok"] !== true) {
    return {
      ok: false,
      code: typeof row["code"] === "string" ? (row["code"] as string) : "unexpected",
    };
  }

  return { ok: true, data: row };
}

type RecoveryResult =
  | { ok: true; recovered: CheckoutSessionOutcome }
  | { ok: false; uncertain: CheckoutSessionOutcome }
  | null;

async function recoverSession(
  client: ReturnType<typeof getAdminClient>,
  prepared: PreparedData,
  stripeSessionId: string,
  expectedReservationId: string,
  actorUserId: string | null,
): Promise<RecoveryResult> {
  // Build the validation context for the retrieved session.
  const ctx: SessionValidationContext = {
    attemptId: prepared.attempt_id,
    reservationId: expectedReservationId,
    depositAmountCents: prepared.deposit_amount_cents,
    currency: prepared.currency,
    holdDeadlineAt: prepared.hold_deadline_at,
  };

  const session = await retrieveCheckoutSession(stripeSessionId, ctx);
  if (session === null) {
    return null; // session not found/expired/failed validation
  }

  // Service-level validation independent of the adapter — the adapter mock
  // may not call validateSession. Do not trust the retrieved session without
  // checking livemode, amount, attempt, reservation, currency, status, and
  // deadline match.
  if (!validateStripeSession(session, ctx)) {
    return null;
  }

  // Before returning the recovered session, call record_checkout_session again
  // to recheck current reservation/hold eligibility. The replacement SQL makes
  // repeated identical recording idempotent. If it returns failure, do not
  // offer the link.
  const recheck = await callRecordRpc(
    client,
    prepared.attempt_id,
    actorUserId,
    session.stripeSessionId,
    session.stripeSessionUrl,
  );

  if (!recheck.ok) {
    return {
      ok: false,
      uncertain: { ok: false, kind: "error", code: "unexpected", error: RETRIEVAL_ERROR },
    };
  }

  return {
    ok: true,
    recovered: {
      ok: true,
      kind: "session_recovered",
      attemptId: prepared.attempt_id,
      stripeSessionId: session.stripeSessionId,
      stripeSessionUrl: session.stripeSessionUrl,
    },
  };
}

async function createNewSession(
  client: ReturnType<typeof getAdminClient>,
  prepared: PreparedData,
  actorUserId: string | null,
): Promise<CheckoutSessionOutcome> {
  const holdDeadlineSec = Math.floor(new Date(prepared.hold_deadline_at).getTime() / 1000);

  const nowSec = Math.floor(Date.now() / 1000);
  if (holdDeadlineSec <= nowSec + MIN_STRIPE_SESSION_SECONDS) {
    return unavailable("insufficient_time", "Not enough time remains for a payment session.");
  }

  try {
    const session = await createDepositCheckoutSession({
      depositAmountCents: prepared.deposit_amount_cents,
      currency: prepared.currency,
      successUrl: prepared.success_url,
      cancelUrl: prepared.cancel_url,
      expiresAt: holdDeadlineSec,
      idempotencyKey: prepared.stripe_idempotency_key,
      // Pass the RESERVATION UUID as reservation metadata, not the attempt ID.
      reservationMetadataId: prepared.reservation_id,
      attemptMetadataId: prepared.attempt_id,
    });

    // Service-level validation of the created session — the adapter mock
    // may not call validateSession. Verify livemode, amount, attempt,
    // reservation, currency, status, and deadline match.
    const createCtx: SessionValidationContext = {
      attemptId: prepared.attempt_id,
      reservationId: prepared.reservation_id,
      depositAmountCents: prepared.deposit_amount_cents,
      currency: prepared.currency,
      holdDeadlineAt: prepared.hold_deadline_at,
    };
    if (!validateStripeSession(session, createCtx)) {
      return { ok: false, kind: "error", code: "stripe_error", error: SAFE_ERROR };
    }

    // Record the session id/url back onto the durable attempt.
    const recorded = await callRecordRpc(
      client,
      prepared.attempt_id,
      actorUserId,
      session.stripeSessionId,
      session.stripeSessionUrl,
    );

    if (!recorded.ok) {
      return {
        ok: false,
        kind: "error",
        code: recorded.code ?? "stripe_error",
        error: SAFE_ERROR,
      };
    }

    return {
      ok: true,
      kind: "session_created",
      attemptId: prepared.attempt_id,
      stripeSessionId: session.stripeSessionId,
      stripeSessionUrl: session.stripeSessionUrl,
    };
  } catch (err) {
    if (err instanceof StripeAdapterError) {
      if (err.code === "insufficient_time") {
        return unavailable("insufficient_time", "Not enough time remains for a payment session.");
      }
      return {
        ok: false,
        kind: "error",
        code: "stripe_error",
        error: SAFE_ERROR,
      };
    }
    return { ok: false, kind: "error", code: "unexpected", error: SAFE_ERROR };
  }
}

interface RecordResult {
  ok: boolean;
  code?: string;
  data?: RecordData | null;
}

async function callRecordRpc(
  client: ReturnType<typeof getAdminClient>,
  attemptId: string,
  actorUserId: string | null,
  stripeSessionId: string,
  stripeSessionUrl: string,
): Promise<RecordResult> {
  const { data, error } = await client.rpc("record_checkout_session", {
    p_attempt_id: attemptId,
    p_actor_user_id: actorUserId,
    p_stripe_session_id: stripeSessionId,
    p_stripe_session_url: stripeSessionUrl,
  });

  if (error) return { ok: false, code: "unexpected" };

  const row = data as Record<string, unknown> | null;
  if (!row || typeof row !== "object") return { ok: false, code: "unexpected" };
  if (row["ok"] !== true) {
    return {
      ok: false,
      code: typeof row["code"] === "string" ? (row["code"] as string) : "unexpected",
    };
  }

  // Validate the returned identity at runtime — not merely ok:true.
  const parsed = recordSchema.safeParse(row);
  if (!parsed.success) return { ok: false, code: "unexpected" };

  // The returned attempt_id must match the one we sent.
  if (parsed.data.attempt_id !== attemptId) return { ok: false, code: "unexpected" };

  // The returned session id and url must match the ones we sent.
  if (parsed.data.stripe_session_id !== stripeSessionId) return { ok: false, code: "unexpected" };
  if (parsed.data.stripe_session_url !== stripeSessionUrl) return { ok: false, code: "unexpected" };

  // The returned state must be "open".
  // (recordSchema already enforces state: z.literal("open").)

  return { ok: true, data: parsed.data };
}

function validateStripeSession(
  session: StripeSessionResult,
  ctx: SessionValidationContext,
): boolean {
  if (session.livemode !== false) return false;
  if (session.status !== "open") return false;
  if (session.paymentStatus !== "unpaid") return false;
  if (typeof session.expiresAt !== "number" || !Number.isInteger(session.expiresAt)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (session.expiresAt <= nowSec) return false;
  const deadlineSec = Math.floor(new Date(ctx.holdDeadlineAt).getTime() / 1000);
  if (session.expiresAt !== deadlineSec) return false;
  if (session.amountTotal !== ctx.depositAmountCents) return false;
  if (session.currency !== ctx.currency) return false;
  if (session.reservationId !== ctx.reservationId) return false;
  if (session.attemptId !== ctx.attemptId) return false;
  if (
    !session.stripeSessionUrl ||
    !/^https:\/\/checkout[.]stripe[.]com\/\S+$/.test(session.stripeSessionUrl)
  )
    return false;
  return true;
}

function unavailable(code: CheckoutFailureCode, error: string): CheckoutSessionOutcome {
  return { ok: false, kind: "unavailable", code, error };
}

function mapRpcCodeToError(code: CheckoutFailureCode): string {
  const messages: Record<CheckoutFailureCode, string> = {
    invalid_actor: "Authorization could not be verified.",
    invalid_data: "Invalid reservation or payment data.",
    not_found: "Reservation not found.",
    conflict: "This reservation is being processed. Please try again.",
    invalid_status: "This reservation is not eligible for deposit collection.",
    hold_not_found: "No capacity hold found for this reservation.",
    hold_released: "The capacity hold for this reservation has been released.",
    already_satisfied: "This deposit has already been satisfied.",
    insufficient_time: "Not enough time remains to collect this deposit.",
    invalid_amount: "The deposit amount is invalid.",
    approval_required: "Management approval is required before deposit collection.",
    checkout_requires_review: "Payment setup needs reconciliation. Please reload and try again.",
    stripe_error: SAFE_ERROR,
    unexpected: SAFE_ERROR,
  };
  return messages[code];
}

/**
 * Recognized RPC failure codes. These are the only codes the preparation
 * and recording RPCs may return; any other string is treated as "unexpected".
 */
const RPC_FAILURE_CODES = [
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
  "stripe_error",
  "unexpected",
] as const;

const RPC_FAILURE_CODE_SET: ReadonlySet<string> = new Set(RPC_FAILURE_CODES);

/** Type guard: narrows a string to CheckoutFailureCode without an unsafe cast. */
function isCheckoutFailureCode(raw: string): raw is CheckoutFailureCode {
  return RPC_FAILURE_CODE_SET.has(raw);
}

/**
 * Narrow an arbitrary string from an RPC response to a recognized
 * CheckoutFailureCode. Missing, malformed, or unknown codes map to
 * "unexpected" — never exposing raw database text or arbitrary strings.
 */
function narrowFailureCode(raw: string | undefined): CheckoutFailureCode {
  if (typeof raw !== "string" || raw.length === 0) return "unexpected";
  return isCheckoutFailureCode(raw) ? raw : "unexpected";
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
