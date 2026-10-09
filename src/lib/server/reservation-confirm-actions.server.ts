/**
 * SERVER-ONLY — reservation confirmation action.
 *
 * Thin handler: resolve the authorized actor (reservations.manage), validate
 * the browser input with the strict schema, then call the existing
 * confirm_reservation_atomic RPC through the server-only administrative
 * Supabase client. The RPC is authoritative for status eligibility, the
 * atomic status transition, history insertion, and optimistic-concurrency
 * validation — this module does NOT duplicate that logic.
 *
 * The verified session user ID is passed as p_actor_user_id. Browser-supplied
 * actor identity, status, and payment fields are never accepted (the strict
 * schema strips unknown keys).
 *
 * Raw Supabase errors are never exposed. Safe failure codes are mapped to
 * useful messages. Confirmation accepts the reservation request; it does NOT
 * collect money, satisfy the deposit, or change payment status — the wrapper
 * must not claim otherwise.
 */
import { confirmReservationSchema } from "@/lib/sundays/schema";
import type { ConfirmReservationCode, ConfirmReservationResult } from "@/lib/sundays/types";
import { resolveSundaysActorWithPermission } from "./sundays-auth.server";
import { getAdminClient } from "./supabase-admin.server";

/** Neutral, secret-free error returned when the caller is not authorized. */
const UNAUTHORIZED: ConfirmReservationResult = {
  ok: false,
  code: "unexpected",
  error: "You are not authorized to confirm reservations.",
};

/** Maps a safe RPC failure code to a user-facing message. */
function messageForCode(code: ConfirmReservationCode): string {
  switch (code) {
    case "conflict":
      return "This reservation was changed. Reload it and try again.";
    case "invalid_status":
      return "This reservation cannot be confirmed in its current status.";
    case "not_found":
      return "This reservation could not be found. It may have been removed.";
    case "invalid_data":
      return "Some reservation details are missing or invalid. Reload and try again.";
    case "invalid_actor":
      return "Your session could not be verified. Sign in again and try again.";
    case "unexpected":
    default:
      return "Could not confirm the reservation. Please try again.";
  }
}

/**
 * Confirm a reservation (pending_review → confirmed).
 *
 * Requires reservations.manage. Calls confirm_reservation_atomic with the
 * verified actor user ID. Both a fresh confirmation and an already-confirmed
 * idempotent recovery are successful outcomes. Confirmation does not collect
 * money, satisfy the deposit, or change payment status.
 */
export async function serverConfirmReservation(
  rawInput: unknown,
): Promise<ConfirmReservationResult> {
  let actor;
  try {
    actor = await resolveSundaysActorWithPermission("reservations.manage");
  } catch {
    return UNAUTHORIZED;
  }

  let parsed;
  try {
    parsed = confirmReservationSchema.parse(rawInput);
  } catch {
    return {
      ok: false,
      code: "invalid_data",
      error: "Check the reservation and timestamp and try again.",
    };
  }

  try {
    const admin = getAdminClient();
    const { data, error } = await admin.rpc("confirm_reservation_atomic", {
      p_reservation_id: parsed.reservationId,
      p_expected_updated_at: parsed.expectedUpdatedAt,
      p_actor_user_id: actor.userId,
    });

    if (error) {
      // Transport/database failure — never expose raw error text, never retry.
      return {
        ok: false,
        code: "unexpected",
        error: "Could not confirm the reservation. Please try again.",
      };
    }

    const result = data as {
      ok: boolean;
      reservation_id?: string;
      reservation_updated_at?: string;
      already_confirmed?: boolean;
      code?: string;
    };

    if (!result.ok) {
      const code = (result.code ?? "unexpected") as ConfirmReservationCode;
      return { ok: false, code, error: messageForCode(code) };
    }

    return {
      ok: true,
      reservationId: result.reservation_id ?? parsed.reservationId,
      reservationUpdatedAt: result.reservation_updated_at ?? "",
      alreadyConfirmed: result.already_confirmed ?? false,
    };
  } catch {
    return {
      ok: false,
      code: "unexpected",
      error: "Could not confirm the reservation. Please try again.",
    };
  }
}
