/**
 * SERVER-ONLY — reservation cancellation action.
 *
 * Thin handler: resolve the authorized actor (reservations.manage), validate
 * the browser input with the strict schema, then call the existing
 * cancel_reservation_atomic RPC through the server-only administrative
 * Supabase client. The RPC is authoritative for status eligibility, table
 * releases, history insertion, and optimistic-concurrency validation — this
 * module does NOT duplicate that logic.
 *
 * The verified session user ID is passed as p_actor_user_id. Browser-supplied
 * actor identity, status, and payment fields are never accepted (the strict
 * schema rejects unknown keys).
 *
 * RPC responses are validated at runtime — missing fields, wrong types,
 * mismatched reservation IDs, or inconsistent values never fabricate success.
 * Raw Supabase errors are never exposed. A failed validation NEVER claims the
 * operation succeeded: the database may have committed before an invalid
 * response was received.
 *
 * Cancellation does NOT refund money or change payment status — the wrapper
 * must not claim otherwise.
 */
import { cancelReservationSchema } from "@/lib/sundays/schema";
import type { CancelReservationCode, CancelReservationResult } from "@/lib/sundays/types";
import { resolveSundaysActorWithPermission } from "./sundays-auth.server";
import { getAdminClient } from "./supabase-admin.server";
import {
  CANNOT_VERIFY,
  CANCEL_FAILURE_CODES,
  parseCancelRpcSuccess,
  parseRpcFailureCode,
} from "./reservation-rpc-validation.server";

/** Neutral, secret-free error returned when the caller is not authorized. */
const UNAUTHORIZED: CancelReservationResult = {
  ok: false,
  code: "unexpected",
  error: "You are not authorized to cancel reservations.",
};

/** Maps a safe RPC failure code to a user-facing message. */
function messageForCode(code: CancelReservationCode): string {
  switch (code) {
    case "conflict":
      return "This reservation was changed. Reload it and try again.";
    case "invalid_status":
      return "This reservation cannot be cancelled in its current status.";
    case "not_found":
      return "This reservation could not be found. It may have been removed.";
    case "invalid_data":
      return "Some reservation details are missing or invalid. Reload and try again.";
    case "invalid_actor":
      return "Your session could not be verified. Sign in again and try again.";
    case "unexpected":
    default:
      return CANNOT_VERIFY;
  }
}

/**
 * Cancel a reservation (pre-arrival).
 *
 * Requires reservations.manage. Calls cancel_reservation_atomic with the
 * verified actor user ID. Both a fresh cancellation and an already-cancelled
 * idempotent recovery are successful outcomes.
 */
export async function serverCancelReservation(rawInput: unknown): Promise<CancelReservationResult> {
  let actor;
  try {
    actor = await resolveSundaysActorWithPermission("reservations.manage");
  } catch {
    return UNAUTHORIZED;
  }

  let parsed;
  try {
    parsed = cancelReservationSchema.parse(rawInput);
  } catch {
    return {
      ok: false,
      code: "invalid_data",
      error: "Check the reservation, timestamp, and reason and try again.",
    };
  }

  try {
    const admin = getAdminClient();
    const { data, error } = await admin.rpc("cancel_reservation_atomic", {
      p_reservation_id: parsed.reservationId,
      p_expected_updated_at: parsed.expectedUpdatedAt,
      p_actor_user_id: actor.userId,
      p_reason: parsed.reason,
    });

    if (error) {
      // Transport/database failure — never expose raw error text, never retry.
      return { ok: false, code: "unexpected", error: CANNOT_VERIFY };
    }

    const success = parseCancelRpcSuccess(data, parsed.reservationId);
    if (success) {
      return { ok: true, ...success };
    }

    const code = parseRpcFailureCode(data, CANCEL_FAILURE_CODES) as CancelReservationCode;
    return { ok: false, code, error: messageForCode(code) };
  } catch {
    return { ok: false, code: "unexpected", error: CANNOT_VERIFY };
  }
}
