/**
 * SERVER-ONLY — reservation management approval action.
 *
 * Thin handler: resolve the authorized actor (reservations.manage), validate
 * the browser input with the strict schema, then call the existing
 * approve_reservation_for_payment_atomic RPC through the server-only
 * administrative Supabase client. The RPC is authoritative for approval
 * eligibility, capacity validity, deadline computation, optimistic-concurrency
 * validation, and the atomic approval decision — this module does NOT
 * duplicate that logic.
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
 * Approval authorizes the reservation for deposit payment; it does NOT collect
 * money, satisfy the deposit, confirm the reservation, or change payment
 * status — the wrapper must not claim otherwise.
 */
import { approvalSchema, isValidOffsetOrZTimestamp } from "@/lib/sundays/schema";
import type {
  ApprovalCode,
  ApprovalResult,
  ApprovalBalanceDeadlineType,
} from "@/lib/sundays/types";
import { resolveSundaysActorWithPermission } from "./sundays-auth.server";
import { getAdminClient } from "./supabase-admin.server";
import { CANNOT_VERIFY, parseRpcFailureCode } from "./reservation-rpc-validation.server";

/** Neutral, secret-free error returned when the caller is not authorized. */
const UNAUTHORIZED: ApprovalResult = {
  ok: false,
  code: "unexpected",
  error: "You are not authorized to approve reservations.",
};

/** Documented failure codes for approve_reservation_for_payment_atomic. */
export const APPROVAL_FAILURE_CODES = [
  "invalid_actor",
  "invalid_data",
  "not_found",
  "invalid_status",
  "conflict",
  "invalid_capacity",
  "invalid_configuration",
  "default_deadline_passed",
  "invalid_deadline",
  "checkout_requires_review",
  "unexpected",
] as const;

/** Maps a safe RPC failure code to a user-facing message. */
function messageForCode(code: ApprovalCode): string {
  switch (code) {
    case "conflict":
      return "This reservation was changed. Reload it and try again.";
    case "invalid_status":
      return "This reservation cannot be approved in its current status.";
    case "invalid_capacity":
      return "The reservation's capacity could not be verified. Reload and try again.";
    case "invalid_configuration":
      return "Service configuration could not be verified. Reload and try again.";
    case "default_deadline_passed":
      return "The default balance deadline has already passed. Choose a specific deadline before approving.";
    case "invalid_deadline":
      return "The selected balance deadline is not valid for this seating.";
    case "checkout_requires_review":
      return "An existing checkout attempt needs reconciliation before approval. Contact an administrator.";
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

function isValidApprovalTimestamp(v: unknown): v is string {
  return typeof v === "string" && isValidOffsetOrZTimestamp(v);
}

const APPROVAL_DEADLINE_TYPES: readonly ApprovalBalanceDeadlineType[] = [
  "default",
  "hours_before",
  "custom",
  "at_check_in",
];

/**
 * Runtime-validate the approve_reservation_for_payment_atomic success payload.
 * Returns null if malformed.
 */
function parseApprovalRpcSuccess(
  data: unknown,
  expectedReservationId: string,
): {
  reservationId: string;
  reservationUpdatedAt: string;
  approvedAt: string;
  depositDeadline: string;
  balanceDeadline: string;
  balanceDeadlineType: ApprovalBalanceDeadlineType;
  alreadyApproved: boolean;
} | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (row["ok"] !== true) return null;
  const reservationId = row["reservation_id"];
  const reservationUpdatedAt = row["reservation_updated_at"];
  const approvedAt = row["approved_at"];
  const depositDeadline = row["deposit_deadline"];
  const balanceDeadline = row["balance_deadline"];
  const balanceDeadlineType = row["balance_deadline_type"];
  const alreadyApproved = row["already_approved"];
  if (typeof reservationId !== "string" || reservationId !== expectedReservationId) return null;
  if (!isValidApprovalTimestamp(reservationUpdatedAt)) return null;
  if (!isValidApprovalTimestamp(approvedAt)) return null;
  if (!isValidApprovalTimestamp(depositDeadline)) return null;
  if (!isValidApprovalTimestamp(balanceDeadline)) return null;
  if (
    typeof balanceDeadlineType !== "string" ||
    !APPROVAL_DEADLINE_TYPES.includes(balanceDeadlineType as ApprovalBalanceDeadlineType)
  )
    return null;
  if (typeof alreadyApproved !== "boolean") return null;
  return {
    reservationId,
    reservationUpdatedAt,
    approvedAt,
    depositDeadline,
    balanceDeadline,
    balanceDeadlineType: balanceDeadlineType as ApprovalBalanceDeadlineType,
    alreadyApproved,
  };
}

/**
 * Approve a reservation for deposit payment (management approval).
 *
 * Requires reservations.manage. Calls approve_reservation_for_payment_atomic
 * with the verified actor user ID and exactly seven named arguments. Both a
 * fresh approval and an already-approved idempotent recovery are successful
 * outcomes. Approval authorizes deposit payment; it does NOT collect money,
 * satisfy the deposit, confirm the reservation, or change payment status.
 */
export async function serverApproveReservation(rawInput: unknown): Promise<ApprovalResult> {
  let actor;
  try {
    actor = await resolveSundaysActorWithPermission("reservations.manage");
  } catch {
    return UNAUTHORIZED;
  }

  let parsed;
  try {
    parsed = approvalSchema.parse(rawInput);
  } catch {
    return {
      ok: false,
      code: "invalid_data",
      error: "Check the reservation, timestamp, and deadline choice before approving.",
    };
  }

  try {
    const admin = getAdminClient();
    const { data, error } = await admin.rpc("approve_reservation_for_payment_atomic", {
      p_reservation_id: parsed.reservationId,
      p_actor_user_id: actor.userId,
      p_expected_updated_at: parsed.expectedUpdatedAt,
      p_balance_deadline_type: parsed.balanceDeadlineType,
      p_custom_hours: parsed.customHours ?? null,
      p_reason: parsed.reason ?? null,
      p_custom_deadline: parsed.customDeadline ?? null,
    });

    if (error) {
      // Transport/database failure — never expose raw error text, never retry.
      return { ok: false, code: "unexpected", error: CANNOT_VERIFY };
    }

    const success = parseApprovalRpcSuccess(data, parsed.reservationId);
    if (success) {
      return { ok: true, ...success };
    }

    const code = parseRpcFailureCode(data, APPROVAL_FAILURE_CODES) as ApprovalCode;
    return { ok: false, code, error: messageForCode(code) };
  } catch {
    return { ok: false, code: "unexpected", error: CANNOT_VERIFY };
  }
}
