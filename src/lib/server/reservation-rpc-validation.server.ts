/**
 * SERVER-ONLY — runtime validation of reservation mutation RPC responses.
 *
 * The confirm/cancel/assign-tables RPCs return jsonb. These validators reject
 * malformed, missing-field, wrong-type, mismatched, or inconsistent responses
 * instead of fabricating success values. A failed validation NEVER claims the
 * operation succeeded: the database may have committed before an invalid
 * response was received.
 *
 * A TypeScript cast is not runtime validation. Every field is checked at
 * runtime here.
 */
import { isValidOffsetOrZTimestamp } from "@/lib/sundays/schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Safe message returned for any response that could not be verified. Never
 * claims nothing changed — the database may have committed before an invalid
 * response was received.
 */
export const CANNOT_VERIFY =
  "The operation could not be verified. Reload the reservation before continuing.";

/** Documented failure codes for confirm_reservation_atomic. */
export const CONFIRM_FAILURE_CODES = [
  "conflict",
  "invalid_status",
  "not_found",
  "invalid_data",
  "invalid_actor",
  "unexpected",
] as const;

/** Documented failure codes for cancel_reservation_atomic. */
export const CANCEL_FAILURE_CODES = [
  "conflict",
  "invalid_status",
  "not_found",
  "invalid_data",
  "invalid_actor",
  "unexpected",
] as const;

/** Documented failure codes for assign_reservation_tables_atomic. */
export const ASSIGN_TABLES_FAILURE_CODES = [
  "conflict",
  "table_conflict",
  "insufficient_seats",
  "invalid_table",
  "invalid_configuration",
  "invalid_status",
  "not_found",
  "invalid_data",
  "invalid_actor",
  "unexpected",
] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isUuidString(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** A valid, timezone-bearing timestamp string (preserved verbatim, never re-serialized). */
function isResponseTimestamp(v: unknown): v is string {
  return typeof v === "string" && isValidOffsetOrZTimestamp(v);
}

/* --------------------------- Success-response validators --------------------------- */

export interface ConfirmRpcSuccess {
  reservationId: string;
  reservationUpdatedAt: string;
  alreadyConfirmed: boolean;
}

/** Validate a confirm_reservation_atomic success payload. Returns null if malformed. */
export function parseConfirmRpcSuccess(
  data: unknown,
  expectedReservationId: string,
): ConfirmRpcSuccess | null {
  if (!isPlainObject(data)) return null;
  if (data["ok"] !== true) return null;
  if (!isUuidString(data["reservation_id"]) || data["reservation_id"] !== expectedReservationId)
    return null;
  if (!isResponseTimestamp(data["reservation_updated_at"])) return null;
  if (typeof data["already_confirmed"] !== "boolean") return null;
  return {
    reservationId: data["reservation_id"],
    reservationUpdatedAt: data["reservation_updated_at"],
    alreadyConfirmed: data["already_confirmed"],
  };
}

export interface CancelRpcSuccess {
  reservationId: string;
  reservationUpdatedAt: string;
  alreadyCancelled: boolean;
}

/** Validate a cancel_reservation_atomic success payload. Returns null if malformed. */
export function parseCancelRpcSuccess(
  data: unknown,
  expectedReservationId: string,
): CancelRpcSuccess | null {
  if (!isPlainObject(data)) return null;
  if (data["ok"] !== true) return null;
  if (!isUuidString(data["reservation_id"]) || data["reservation_id"] !== expectedReservationId)
    return null;
  if (!isResponseTimestamp(data["reservation_updated_at"])) return null;
  if (typeof data["already_cancelled"] !== "boolean") return null;
  return {
    reservationId: data["reservation_id"],
    reservationUpdatedAt: data["reservation_updated_at"],
    alreadyCancelled: data["already_cancelled"],
  };
}

export interface AssignTablesRpcSuccess {
  reservationId: string;
  reservationUpdatedAt: string;
  assignedTableIds: string[];
}

/**
 * Validate an assign_reservation_tables_atomic success payload. Returns null
 * if malformed. The returned assigned_table_ids set must match the requested
 * set regardless of ordering. An empty array is valid for an explicit
 * release-all.
 */
export function parseAssignTablesRpcSuccess(
  data: unknown,
  expectedReservationId: string,
  requestedTableIds: readonly string[],
): AssignTablesRpcSuccess | null {
  if (!isPlainObject(data)) return null;
  if (data["ok"] !== true) return null;
  if (!isUuidString(data["reservation_id"]) || data["reservation_id"] !== expectedReservationId)
    return null;
  if (!isResponseTimestamp(data["reservation_updated_at"])) return null;
  const ids = data["assigned_table_ids"];
  if (!Array.isArray(ids)) return null;
  if (!ids.every((id) => isUuidString(id))) return null;
  if (new Set(ids).size !== ids.length) return null;
  // The returned set must match the requested set regardless of ordering.
  const requested = new Set(requestedTableIds);
  const returned = new Set(ids);
  if (requested.size !== returned.size) return null;
  for (const id of requested) {
    if (!returned.has(id)) return null;
  }
  return {
    reservationId: data["reservation_id"],
    reservationUpdatedAt: data["reservation_updated_at"],
    assignedTableIds: ids,
  };
}

/* ------------------------------- Failure-code validation ------------------------------- */

/**
 * Parse an ok:false failure code. Returns the code if it is a documented
 * failure code for the action, or "unexpected" if the response is malformed or
 * carries an unknown code. Never returns null.
 */
export function parseRpcFailureCode(data: unknown, allowedCodes: readonly string[]): string {
  if (!isPlainObject(data)) return "unexpected";
  if (data["ok"] !== false) return "unexpected";
  const code = data["code"];
  if (typeof code !== "string" || !allowedCodes.includes(code)) return "unexpected";
  return code;
}
