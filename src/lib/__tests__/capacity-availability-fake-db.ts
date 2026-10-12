/**
 * Fake PostgREST HTTP boundary for capacity-availability tests.
 *
 * Exports fixtures, builders, and a fake fetch that implements the
 * PostgREST subset our data readers use: table routing, eq/is/lt/gt
 * filters, Content-Range pagination, maybeSingle, GET-only, Prefer count.
 * Used by capacity-availability.test.ts only.
 */
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

// --- Fixed clock + future service date -------------------------------------
export const NOW_MS = Date.UTC(2099, 9, 1, 0, 0, 0); // 2099-10-01T00:00:00Z (future)
export const SERVICE_DATE = "2099-11-07"; // future Sunday
export const TZ = "America/Chicago";

// Service window 12:00–19:00 Chicago on 2099-11-07 (CST, UTC-6):
//   start = 2099-11-07T18:00:00Z, end = 2099-11-08T01:00:00Z
export const SEATING_START_MS = Date.UTC(2099, 10, 7, 18, 0, 0);
export const SEATING_END_MS = Date.UTC(2099, 10, 8, 1, 0, 0);

// --- Stable UUID fixtures ---------------------------------------------------
export const BALLROOM_SPACE = "00000000-0000-4000-8000-000000000001";
export const MAYORAL_1_SPACE = "00000000-0000-4000-8000-000000000002";
export const MAYORAL_2_SPACE = "00000000-0000-4000-8000-000000000003";
export const SERVICE_ID = "00000000-0000-4000-8000-000000000010";
export const SEATING_ID = "00000000-0000-4000-8000-000000000020";

export const BALLROOM = "00000000-0000-4000-8000-000000000b01";
export const MAYORAL_WHOLE = "00000000-0000-4000-8000-000000000b02";
export const MAYORAL_S1 = "00000000-0000-4000-8000-000000000b03";
export const MAYORAL_S2 = "00000000-0000-4000-8000-000000000b04";

// --- Row types --------------------------------------------------------------
export interface ControlRow {
  ready: boolean;
  revision: number;
}
export interface ResourceRow {
  id: string;
  space_id: string | null;
  total_capacity: number;
  parent_id: string | null;
  resource_type: "standalone" | "whole" | "section";
  is_active: boolean;
}
export interface HoldRow {
  id: string;
  reservation_id: string;
  capacity_resource_id: string;
  party_size: number;
  seating_start: string;
  seating_end: string;
  state: "held" | "allocated";
  released_at: string | null;
}
export interface ServiceRow {
  id: string;
  date: string;
  label: string;
  space_id: string;
  status: string;
  is_active: boolean;
  online_booking_limit: number | null;
  capacity_resource_id: string | null;
  display_order: number;
}
export interface SeatingRow {
  id: string;
  sunday_service_id: string;
  label: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
  online_booking_limit: number | null;
  display_order: number;
}
export interface SpaceRow {
  id: string;
  name: string;
  space_type: string;
  is_active: boolean;
  online_booking_limit: number | null;
}
export interface PolicyRow {
  restaurant_timezone: string;
}

export interface FakeDB {
  control?: ControlRow[];
  resources: ResourceRow[];
  holds: HoldRow[];
  services: ServiceRow[];
  seatings: SeatingRow[];
  spaces: SpaceRow[];
  policy?: PolicyRow[];
  errors?: Partial<Record<string, true>>;
  /** If set, this table advertises a larger count than rows for pagination. */
  incompleteTable?: string;
  incompleteCount?: number;
}

// --- Fixture builders -------------------------------------------------------
export function defaultBallroomResource(): ResourceRow {
  return {
    id: BALLROOM,
    space_id: BALLROOM_SPACE,
    total_capacity: 950,
    parent_id: null,
    resource_type: "standalone",
    is_active: true,
  };
}
export function defaultMayoralResources(): ResourceRow[] {
  return [
    {
      id: MAYORAL_WHOLE,
      space_id: null,
      total_capacity: 120,
      parent_id: null,
      resource_type: "whole",
      is_active: true,
    },
    {
      id: MAYORAL_S1,
      space_id: MAYORAL_1_SPACE,
      total_capacity: 60,
      parent_id: MAYORAL_WHOLE,
      resource_type: "section",
      is_active: true,
    },
    {
      id: MAYORAL_S2,
      space_id: MAYORAL_2_SPACE,
      total_capacity: 60,
      parent_id: MAYORAL_WHOLE,
      resource_type: "section",
      is_active: true,
    },
  ];
}
export function defaultService(over: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: SERVICE_ID,
    date: SERVICE_DATE,
    label: "First Sunday",
    space_id: BALLROOM_SPACE,
    status: "open",
    is_active: true,
    online_booking_limit: 100,
    capacity_resource_id: null,
    display_order: 1,
    ...over,
  };
}
export function defaultSeating(over: Partial<SeatingRow> = {}): SeatingRow {
  return {
    id: SEATING_ID,
    sunday_service_id: SERVICE_ID,
    label: "12:00 PM",
    start_time: "12:00",
    end_time: "19:00",
    is_active: true,
    online_booking_limit: 100,
    display_order: 1,
    ...over,
  };
}
export function defaultBallroomSpace(over: Partial<SpaceRow> = {}): SpaceRow {
  return {
    id: BALLROOM_SPACE,
    name: "Grand Ballroom",
    space_type: "general_dining",
    is_active: true,
    online_booking_limit: 100,
    ...over,
  };
}
export function mayoralSpaces(): SpaceRow[] {
  return [
    {
      id: MAYORAL_1_SPACE,
      name: "Mayoral Room 1",
      space_type: "general_dining",
      is_active: true,
      online_booking_limit: 60,
    },
    {
      id: MAYORAL_2_SPACE,
      name: "Mayoral Room 2",
      space_type: "general_dining",
      is_active: true,
      online_booking_limit: 60,
    },
  ];
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function makeDb(over: Partial<FakeDB> = {}): FakeDB {
  return {
    control: [{ ready: true, revision: 1 }],
    resources: [defaultBallroomResource(), ...defaultMayoralResources()],
    holds: [],
    services: [defaultService()],
    seatings: [defaultSeating()],
    spaces: [defaultBallroomSpace(), ...mayoralSpaces()],
    policy: [{ restaurant_timezone: TZ }],
    ...over,
  };
}

// --- Fake fetch -------------------------------------------------------------
type RowMap = Record<string, unknown>;

function tableRows(db: FakeDB, table: string): RowMap[] {
  if (table === "capacity_control") {
    return (db.control ?? []).map((r) => ({ id: 1, ready: r.ready, revision: r.revision }));
  }
  if (table === "capacity_resources") return db.resources.map((r) => ({ ...r }));
  if (table === "reservation_capacity_holds") return db.holds.map((r) => ({ ...r }));
  if (table === "sunday_services") return db.services.map((r) => ({ ...r }));
  if (table === "seating_times") return db.seatings.map((r) => ({ ...r }));
  if (table === "venue_spaces") return db.spaces.map((r) => ({ ...r }));
  if (table === "payment_policy")
    return (db.policy ?? [{ restaurant_timezone: TZ }]).map((r) => ({
      id: 1,
      restaurant_timezone: r.restaurant_timezone,
    }));
  return [];
}

function applyFilters(row: RowMap, params: URLSearchParams): boolean {
  for (const [key, value] of params) {
    if (["select", "order", "offset", "limit"].includes(key)) continue;
    const colVal = row[key];
    if (value.startsWith("eq.")) {
      if (String(colVal) !== value.slice(3)) return false;
    } else if (value === "is.null") {
      if (colVal !== null) return false;
    } else if (value.startsWith("lt.")) {
      if (typeof colVal === "string") {
        if (Date.parse(colVal) >= Date.parse(value.slice(3))) return false;
      } else if (typeof colVal === "number") {
        if (colVal >= Number(value.slice(3))) return false;
      } else return false;
    } else if (value.startsWith("gt.")) {
      if (typeof colVal === "string") {
        if (Date.parse(colVal) <= Date.parse(value.slice(3))) return false;
      } else if (typeof colVal === "number") {
        if (colVal <= Number(value.slice(3))) return false;
      } else return false;
    }
  }
  return true;
}

export function makeFetch(
  db: FakeDB,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      return new Response(JSON.stringify({ message: "method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const pathParts = url.pathname.split("/").filter(Boolean);
    const table = pathParts[pathParts.length - 1] ?? "";

    if (db.errors?.[table]) {
      return new Response(JSON.stringify({ message: "database error", code: "P0001" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const params = url.searchParams;
    const hasOffset = params.has("offset");
    const offset = Number(params.get("offset") ?? 0);
    const limit = Number(params.get("limit") ?? 0);
    const isPaginated = hasOffset || limit > 0;

    // Get rows for table and apply filters
    let rows = tableRows(db, table).filter((r) => applyFilters(r, params));

    if (table === "reservation_capacity_holds") {
      // The data reader applies .is("released_at", null) already in the query.
      // Double-check to ensure released holds never leak into capacity calc.
      rows = rows.filter((r) => r.released_at === null);
    }

    if (params.get("order")?.startsWith("id")) {
      rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    }

    if (!isPaginated) {
      // maybeSingle path: return a single object or null
      const single = rows[0] ?? null;
      return new Response(JSON.stringify(single), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Paginated path with Content-Range
    let totalCount = rows.length;

    // Simulate incomplete response: advertise more than available
    if (db.incompleteTable === table && db.incompleteCount !== undefined) {
      totalCount = db.incompleteCount;
    }

    const page = rows.slice(offset, offset + limit);
    const endIdx = offset + page.length - 1;
    const contentRange = `${offset}-${Math.max(endIdx, offset)}/${totalCount}`;
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Range": contentRange,
      },
    });
  };
}

export function fakeClient(db: FakeDB): SupabaseClient {
  return createClient("https://fake.supabase.co", "fake-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: makeFetch(db) as unknown as typeof fetch },
  });
}
