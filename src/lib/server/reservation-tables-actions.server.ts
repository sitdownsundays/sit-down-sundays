/**
 * SERVER-ONLY — reservation table-assignment action.
 *
 * Thin handler: resolve the authorized actor (seating.manage), validate the
 * browser input with the strict schema, then call the existing
 * assign_reservation_tables_atomic RPC through the server-only administrative
 * Supabase client. The RPC is authoritative for capacity, overlap, timezone,
 * and status validation — this module does NOT duplicate that logic.
 *
 * The verified session user ID is passed as p_actor_user_id. Browser-supplied
 * actor identity, room, capacity, status, and seating timestamps are never
 * accepted (the strict schema strips unknown keys).
 *
 * Raw Supabase errors are never exposed. Safe failure codes are mapped to
 * useful messages. The reservation is never marked confirmed or paid here.
 */
import { assignTablesSchema } from "@/lib/sundays/schema";
import type { AssignTablesCode, AssignTablesResult } from "@/lib/sundays/types";
import { resolveSundaysActorWithPermission } from "./sundays-auth.server";
import { getAdminClient } from "./supabase-admin.server";

/** Neutral, secret-free error returned when the caller is not authorized. */
const UNAUTHORIZED: AssignTablesResult = {
  ok: false,
  code: "unexpected",
  error: "You are not authorized to assign tables.",
};

/** Maps a safe RPC failure code to a user-facing message. */
function messageForCode(code: AssignTablesCode): string {
  switch (code) {
    case "conflict":
      return "This reservation was changed. Reload it and try again.";
    case "table_conflict":
      return "A selected table is already reserved for that time. Choose different tables.";
    case "insufficient_seats":
      return "The selected tables cannot accommodate this party size.";
    case "invalid_table":
      return "One or more selected tables are unavailable. Refresh the table list and try again.";
    case "invalid_configuration":
      return "The service, seating, room, or timezone configuration is incomplete. Review the setup and try again.";
    case "invalid_status":
      return "This reservation cannot be seated in its current status.";
    case "not_found":
      return "This reservation could not be found. It may have been removed.";
    case "invalid_data":
      return "Some reservation details are missing or invalid. Reload and try again.";
    case "invalid_actor":
      return "Your session could not be verified. Sign in again and try again.";
    case "unexpected":
    default:
      return "Could not assign tables. Please try again.";
  }
}

/**
 * Assign (or release) a reservation's physical tables.
 *
 * Requires seating.manage. Calls assign_reservation_tables_atomic with the
 * verified actor user ID. An empty tableIds array explicitly releases all
 * current assignments.
 */
export async function serverAssignReservationTables(
  rawInput: unknown,
): Promise<AssignTablesResult> {
  let actor;
  try {
    actor = await resolveSundaysActorWithPermission("seating.manage");
  } catch {
    return UNAUTHORIZED;
  }

  let parsed;
  try {
    parsed = assignTablesSchema.parse(rawInput);
  } catch {
    return {
      ok: false,
      code: "invalid_data",
      error: "Check the reservation, tables, and timestamp and try again.",
    };
  }

  try {
    const admin = getAdminClient();
    const { data, error } = await admin.rpc("assign_reservation_tables_atomic", {
      p_reservation_id: parsed.reservationId,
      p_table_ids: parsed.tableIds,
      p_expected_updated_at: parsed.expectedUpdatedAt,
      p_actor_user_id: actor.userId,
    });

    if (error) {
      // Transport/database failure — never expose raw error text, never retry.
      return {
        ok: false,
        code: "unexpected",
        error: "Could not assign tables. Please try again.",
      };
    }

    const result = data as {
      ok: boolean;
      reservation_id?: string;
      assigned_table_ids?: string[];
      reservation_updated_at?: string;
      code?: string;
    };

    if (!result.ok) {
      const code = (result.code ?? "unexpected") as AssignTablesCode;
      return { ok: false, code, error: messageForCode(code) };
    }

    return {
      ok: true,
      reservationId: result.reservation_id ?? parsed.reservationId,
      assignedTableIds: result.assigned_table_ids ?? [],
      reservationUpdatedAt: result.reservation_updated_at ?? "",
    };
  } catch {
    return {
      ok: false,
      code: "unexpected",
      error: "Could not assign tables. Please try again.",
    };
  }
}
