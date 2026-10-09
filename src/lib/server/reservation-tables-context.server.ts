/**
 * SERVER-ONLY — reservation table-assignment context read.
 *
 * Supplies the minimal data the party-to-table assignment dialog needs:
 * the reservation's identity/party/status/updatedAt, its authoritative room
 * and service date/seating interval, its CURRENT assignments only
 * (released_at IS NULL), and the physical tables in the reservation's room.
 *
 * Authorization: requires BOTH seating.read AND reservations.read_all, resolved
 * server-side from the live session. Browser-supplied role/actor is never
 * trusted. Unauthorized callers never reach the database.
 *
 * This is a READ endpoint. It does NOT guarantee a table is free (the
 * assignment RPC checks conflicts authoritatively on save), does NOT expose
 * other parties' contact/dietary/payment/order data, and does NOT form a
 * transactionally consistent snapshot — the expectedUpdatedAt check and RPC
 * validation remain authoritative.
 */
import { z } from "zod";
import type {
  ReservationTableContextResult,
  ReservationTableContextDTO,
} from "@/lib/sundays/types";
import { resolveSundaysActorWithPermission } from "./sundays-auth.server";
import { resolveReservationStaffActor } from "./reservation-auth.server";
import { getAdminClient } from "./supabase-admin.server";

const contextInputSchema = z.object({ reservationId: z.string().uuid() }).strict();

/** Safe, secret-free error for unexpected failures. */
const SAFE_ERROR = "We couldn't load the table assignment context. Please try again.";

interface ReservationContextRow {
  id: string;
  reservation_number: string;
  status: string;
  party_size: number;
  updated_at: string;
  sunday_service_id: string;
  seating_time_id: string;
}

interface ServiceRow {
  id: string;
  date: string;
  space_id: string;
}

interface SeatingRow {
  id: string;
  start_time: string;
  end_time: string;
}

interface SpaceRow {
  id: string;
  name: string;
}

interface AssignmentRow {
  id: string;
  dining_table_id: string;
  seating_start: string;
  seating_end: string;
  released_at: string | null;
}

interface TableRow {
  id: string;
  label: string;
  seats: number;
  zone: string;
  is_active: boolean;
}

/**
 * Load the table-assignment context for one reservation.
 *
 * Requires seating.read (via the Sundays auth helper) AND reservations.read_all
 * (via the reservation staff auth helper). Both are resolved before any
 * database access.
 */
export async function serverGetReservationTableContext(
  rawInput: unknown,
): Promise<ReservationTableContextResult> {
  // --- Authorization: seating.read ---
  try {
    await resolveSundaysActorWithPermission("seating.read");
  } catch {
    return { ok: false, error: "You are not authorized to manage seating." };
  }

  // --- Authorization: reservations.read_all ---
  try {
    await resolveReservationStaffActor();
  } catch {
    return { ok: false, error: "You are not authorized to view reservations." };
  }

  // --- Input validation ---
  let parsed;
  try {
    parsed = contextInputSchema.parse(rawInput);
  } catch {
    return { ok: false, error: "Select a valid reservation." };
  }

  try {
    const admin = getAdminClient();

    // --- Reservation core ---
    const { data: resData, error: resError } = await admin
      .from("reservations")
      .select(
        "id,reservation_number,status,party_size,updated_at,sunday_service_id,seating_time_id",
      )
      .eq("id", parsed.reservationId)
      .maybeSingle();

    if (resError) return { ok: false, error: SAFE_ERROR };
    if (!resData) return { ok: false, error: "Reservation not found." };
    const res = resData as unknown as ReservationContextRow;

    // --- Service + seating + space (authoritative room/date/interval) ---
    const [serviceRes, seatingRes] = await Promise.all([
      admin
        .from("sunday_services")
        .select("id,date,space_id")
        .eq("id", res.sunday_service_id)
        .maybeSingle(),
      admin
        .from("seating_times")
        .select("id,start_time,end_time")
        .eq("id", res.seating_time_id)
        .maybeSingle(),
    ]);

    if (serviceRes.error || seatingRes.error) return { ok: false, error: SAFE_ERROR };
    if (!serviceRes.data || !seatingRes.data) {
      return { ok: false, error: "Reservation service or seating is not configured." };
    }
    const service = serviceRes.data as unknown as ServiceRow;
    const seating = seatingRes.data as unknown as SeatingRow;

    const { data: spaceData, error: spaceError } = await admin
      .from("venue_spaces")
      .select("id,name")
      .eq("id", service.space_id)
      .maybeSingle();
    if (spaceError) return { ok: false, error: SAFE_ERROR };
    if (!spaceData) return { ok: false, error: "Reservation room is not configured." };
    const space = spaceData as unknown as SpaceRow;

    // --- Current assignments (released_at IS NULL), with joined table info ---
    const { data: assignData, error: assignError } = await admin
      .from("reservation_table_assignments")
      .select("id,dining_table_id,seating_start,seating_end,released_at")
      .eq("reservation_id", parsed.reservationId)
      .is("released_at", null)
      .order("seating_start", { ascending: true });

    if (assignError) return { ok: false, error: SAFE_ERROR };
    const assignRows = (assignData ?? []) as unknown as AssignmentRow[];

    // --- Room tables (all tables in the reservation's room, incl. inactive) ---
    const { data: tableData, error: tableError } = await admin
      .from("dining_tables")
      .select("id,label,seats,zone,is_active")
      .eq("space_id", service.space_id)
      .order("is_active", { ascending: false })
      .order("label", { ascending: true });

    if (tableError) return { ok: false, error: SAFE_ERROR };
    const tableRows = (tableData ?? []) as unknown as TableRow[];

    // Build a label/seats/active lookup for assigned tables (they may be
    // inactive, so they are not necessarily in roomTables — but they are, since
    // roomTables includes inactive; still, join defensively by id).
    const tableById = new Map<string, TableRow>(tableRows.map((t) => [t.id, t]));

    const currentAssignments = assignRows.map((a) => {
      const t = tableById.get(a.dining_table_id);
      return {
        id: a.id,
        diningTableId: a.dining_table_id,
        seatingStart: a.seating_start,
        seatingEnd: a.seating_end,
        tableLabel: t?.label ?? "",
        tableSeats: t?.seats ?? 0,
        tableIsActive: t?.is_active ?? false,
      };
    });

    const roomTables = tableRows.map((t) => ({
      id: t.id,
      label: t.label,
      seats: t.seats,
      zone: t.zone,
      isActive: t.is_active,
    }));

    const context: ReservationTableContextDTO = {
      reservationId: res.id,
      reservationNumber: res.reservation_number,
      partySize: res.party_size,
      status: res.status,
      updatedAt: res.updated_at,
      roomId: space.id,
      roomName: space.name,
      serviceDate: service.date,
      seatingStart: seating.start_time,
      seatingEnd: seating.end_time,
      currentAssignments,
      roomTables,
    };

    return { ok: true, context };
  } catch {
    return { ok: false, error: SAFE_ERROR };
  }
}
