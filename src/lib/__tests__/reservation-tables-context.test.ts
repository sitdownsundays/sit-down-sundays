/**
 * getReservationTableContext — behavioral tests (mocked boundaries).
 *
 * Exercises the REAL production action serverGetReservationTableContext in
 * reservation-tables-context.server.ts. Both authorization helpers
 * (resolveSundaysActorWithPermission + resolveReservationStaffActor) and the
 * admin Supabase client (getAdminClient) are mocked at their real module
 * boundaries via vi.mock, so the wiring — dual authorization, input
 * validation, the read-then-assemble flow, wrong-room exclusion, released
 * assignment exclusion, inactive assignment inclusion, empty success, missing
 * reservation, database error handling, and field exposure — are under test.
 *
 * These are MOCKED-BOUNDARY tests, not live PostgreSQL. They do not prove the
 * database views/tables/RLS behave; they verify the application wrapper.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the admin Supabase client. Each query is a thenable chain returning
// { data, error }. We build a small builder so tests can stage table data.
// ---------------------------------------------------------------------------
type QueryResult = { data: unknown; error: unknown };

/**
 * Thenable query-chain mock that actually applies .eq()/is() filters, so
 * room-exclusion and released-assignment filtering are exercised rather than
 * bypassed. .maybeSingle() resolves to the first matching row (or null);
 * a bare await resolves to the filtered array.
 */
function selectChain(result: QueryResult) {
  const filters: Record<string, unknown> = {};
  const nullFilters: string[] = [];

  const applyFilters = (): QueryResult => {
    let data = result.data;
    if (Array.isArray(data)) {
      data = data.filter((row: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(filters)) {
          if (row[k] !== v) return false;
        }
        for (const k of nullFilters) {
          if (row[k] !== null) return false;
        }
        return true;
      });
    }
    return { data, error: result.error };
  };

  const chain = {
    select: () => chain,
    eq: (k: string, v: unknown) => {
      filters[k] = v;
      return chain;
    },
    is: (k: string, v: null) => {
      if (v === null) nullFilters.push(k);
      return chain;
    },
    order: () => chain,
    maybeSingle: () => {
      const r = applyFilters();
      const arr = Array.isArray(r.data) ? r.data : null;
      const single = arr && arr.length > 0 ? arr[0] : Array.isArray(r.data) ? null : r.data;
      return Promise.resolve({ data: single, error: r.error });
    },
    then: <T>(
      onFulfilled: (value: QueryResult) => T | PromiseLike<T>,
      onRejected?: (reason: unknown) => T | PromiseLike<T>,
    ) => Promise.resolve(applyFilters()).then(onFulfilled, onRejected),
  };
  return chain;
}

const mockFrom = vi.fn();
vi.mock("@/lib/server/supabase-admin.server", () => ({
  getAdminClient: () => ({ from: mockFrom }),
}));

// ---------------------------------------------------------------------------
// Mock the dual authorization helpers. Sundays helper requires seating.read;
// reservation staff helper requires reservations.read_all.
// ---------------------------------------------------------------------------
const mockSundaysAuth = vi.fn();
vi.mock("@/lib/server/sundays-auth.server", () => ({
  resolveSundaysActorWithPermission: (permission: string) => mockSundaysAuth(permission),
  SundaysAuthorizationError: class SundaysAuthorizationError extends Error {
    constructor(message = "Not authorized.") {
      super(message);
      this.name = "SundaysAuthorizationError";
    }
  },
}));

const mockReservationAuth = vi.fn();
vi.mock("@/lib/server/reservation-auth.server", () => ({
  resolveReservationStaffActor: () => mockReservationAuth(),
  ReservationAuthorizationError: class ReservationAuthorizationError extends Error {
    constructor(message = "Not authorized.") {
      super(message);
      this.name = "ReservationAuthorizationError";
    }
  },
}));

const { serverGetReservationTableContext } =
  await import("@/lib/server/reservation-tables-context.server");

const RES_ID = "11111111-1111-1111-1111-111111111111";
const SERVICE_ID = "22222222-2222-2222-2222-222222222222";
const SEATING_ID = "33333333-3333-3333-3333-333333333333";
const ROOM_ID = "44444444-4444-4444-4444-444444444444";
const OTHER_ROOM_ID = "55555555-5555-5555-5555-555555555555";
const TABLE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TABLE_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OTHER_ROOM_TABLE = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const OTHER_RES_ID = "66666666-6666-6666-6666-666666666666";

function authOk() {
  mockSundaysAuth.mockResolvedValue({ role: "ops_manager", userId: "u1" });
  mockReservationAuth.mockResolvedValue({ role: "ops_manager", userId: "u1" });
}
function sundaysReject(): void {
  mockSundaysAuth.mockImplementation(() => {
    throw new Error("No seating.read");
  });
}
function reservationReject(): void {
  mockReservationAuth.mockImplementation(() => {
    throw new Error("No reservations.read_all");
  });
}

function stageTables(
  tables: Array<{
    id: string;
    label: string;
    seats: number;
    zone: string;
    is_active: boolean;
    space_id: string;
  }>,
) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "dining_tables") {
      return selectChain({ data: tables, error: null });
    }
    return selectChain({ data: [], error: null });
  });
}

function stageSuccess({
  resRoom = ROOM_ID,
  assignments = [],
  tables = [],
}: {
  resRoom?: string;
  assignments?: Array<{
    id: string;
    reservation_id: string;
    dining_table_id: string;
    seating_start: string;
    seating_end: string;
    released_at: string | null;
  }>;
  tables?: Array<{
    id: string;
    label: string;
    seats: number;
    zone: string;
    is_active: boolean;
    space_id: string;
  }>;
}) {
  mockFrom.mockImplementation((table: string) => {
    switch (table) {
      case "reservations":
        return selectChain({
          data: {
            id: RES_ID,
            reservation_number: "SDS-20261011-ABCD",
            status: "pending_review",
            party_size: 6,
            updated_at: "2026-01-01T00:00:00.000Z",
            sunday_service_id: SERVICE_ID,
            seating_time_id: SEATING_ID,
          },
          error: null,
        });
      case "sunday_services":
        return selectChain({
          data: { id: SERVICE_ID, date: "2026-10-11", space_id: resRoom },
          error: null,
        });
      case "seating_times":
        return selectChain({
          data: { id: SEATING_ID, start_time: "13:00", end_time: "15:30" },
          error: null,
        });
      case "venue_spaces":
        return selectChain({
          data: { id: resRoom, name: resRoom === ROOM_ID ? "Grand Ballroom" : "Other" },
          error: null,
        });
      case "reservation_table_assignments":
        return selectChain({ data: assignments, error: null });
      case "dining_tables":
        return selectChain({ data: tables, error: null });
      default:
        return selectChain({ data: null, error: null });
    }
  });
}

describe("serverGetReservationTableContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSundaysAuth.mockReset();
    mockReservationAuth.mockReset();
    mockFrom.mockReset();
  });

  it("denies callers lacking seating.read before any database access", async () => {
    sundaysReject();
    const result = await serverGetReservationTableContext({ reservationId: RES_ID });
    expect(result.ok).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockSundaysAuth).toHaveBeenCalledWith("seating.read");
  });

  it("denies callers lacking reservations.read_all after seating.read", async () => {
    mockSundaysAuth.mockResolvedValue({ role: "ops_manager", userId: "u1" });
    reservationReject();
    const result = await serverGetReservationTableContext({ reservationId: RES_ID });
    expect(result.ok).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockReservationAuth).toHaveBeenCalled();
  });

  it("rejects a malformed reservationId without database access", async () => {
    authOk();
    const result = await serverGetReservationTableContext({ reservationId: "not-a-uuid" });
    expect(result.ok).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("excludes tables in a different room from roomTables", async () => {
    authOk();
    stageSuccess({
      tables: [
        { id: TABLE_A, label: "A1", seats: 6, zone: "", is_active: true, space_id: ROOM_ID },
        {
          id: OTHER_ROOM_TABLE,
          label: "Z9",
          seats: 8,
          zone: "",
          is_active: true,
          space_id: OTHER_ROOM_ID,
        },
      ],
    });
    const result = await serverGetReservationTableContext({ reservationId: RES_ID });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.roomId).toBe(ROOM_ID);
      const ids = result.context.roomTables.map((t) => t.id);
      expect(ids).not.toContain(OTHER_ROOM_TABLE);
    }
  });

  it("excludes assignments belonging to a different reservation", async () => {
    authOk();
    stageSuccess({
      assignments: [
        {
          id: "asg-ours",
          reservation_id: RES_ID,
          dining_table_id: TABLE_A,
          seating_start: "2026-10-11T13:00:00-05:00",
          seating_end: "2026-10-11T15:30:00-05:00",
          released_at: null,
        },
        {
          id: "asg-other",
          reservation_id: OTHER_RES_ID,
          dining_table_id: TABLE_B,
          seating_start: "2026-10-11T13:00:00-05:00",
          seating_end: "2026-10-11T15:30:00-05:00",
          released_at: null,
        },
      ],
      tables: [
        { id: TABLE_A, label: "A1", seats: 6, zone: "", is_active: true, space_id: ROOM_ID },
        { id: TABLE_B, label: "B1", seats: 8, zone: "", is_active: true, space_id: ROOM_ID },
      ],
    });
    const result = await serverGetReservationTableContext({ reservationId: RES_ID });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.currentAssignments).toHaveLength(1);
      expect(result.context.currentAssignments[0].id).toBe("asg-ours");
    }
  });

  it("excludes released assignments, keeping only current (released_at IS NULL)", async () => {
    authOk();
    stageSuccess({
      assignments: [
        {
          id: "asg-1",
          reservation_id: RES_ID,
          dining_table_id: TABLE_A,
          seating_start: "2026-10-11T13:00:00-05:00",
          seating_end: "2026-10-11T15:30:00-05:00",
          released_at: null,
        },
        {
          id: "asg-2",
          reservation_id: RES_ID,
          dining_table_id: TABLE_B,
          seating_start: "2026-10-04T13:00:00-05:00",
          seating_end: "2026-10-04T15:30:00-05:00",
          released_at: "2026-10-05T10:00:00-05:00",
        },
      ],
      tables: [
        { id: TABLE_A, label: "A1", seats: 6, zone: "", is_active: true, space_id: ROOM_ID },
        { id: TABLE_B, label: "B1", seats: 8, zone: "", is_active: true, space_id: ROOM_ID },
      ],
    });
    const result = await serverGetReservationTableContext({ reservationId: RES_ID });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.currentAssignments).toHaveLength(1);
      expect(result.context.currentAssignments[0].id).toBe("asg-1");
    }
  });

  it("keeps inactive currently-assigned tables visible so they can be released", async () => {
    authOk();
    stageSuccess({
      assignments: [
        {
          id: "asg-1",
          reservation_id: RES_ID,
          dining_table_id: TABLE_A,
          seating_start: "2026-10-11T13:00:00-05:00",
          seating_end: "2026-10-11T15:30:00-05:00",
          released_at: null,
        },
      ],
      tables: [
        { id: TABLE_A, label: "A1", seats: 6, zone: "", is_active: false, space_id: ROOM_ID },
      ],
    });
    const result = await serverGetReservationTableContext({ reservationId: RES_ID });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.currentAssignments).toHaveLength(1);
      expect(result.context.currentAssignments[0].tableIsActive).toBe(false);
    }
  });

  it("treats zero current assignments as a valid success, not an error", async () => {
    authOk();
    stageSuccess({ assignments: [], tables: [] });
    const result = await serverGetReservationTableContext({ reservationId: RES_ID });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.currentAssignments).toEqual([]);
      expect(result.context.roomTables).toEqual([]);
    }
  });

  it("returns a safe error when the reservation is missing (not an empty success)", async () => {
    authOk();
    mockFrom.mockImplementation((table: string) => {
      if (table === "reservations") return selectChain({ data: null, error: null });
      return selectChain({ data: null, error: null });
    });
    const result = await serverGetReservationTableContext({ reservationId: RES_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("found");
  });

  it("returns a safe error on database failure, not an empty success", async () => {
    authOk();
    mockFrom.mockImplementation((table: string) => {
      if (table === "reservations")
        return selectChain({ data: null, error: { message: "connection reset" } });
      return selectChain({ data: null, error: null });
    });
    const result = await serverGetReservationTableContext({ reservationId: RES_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("connection reset");
      expect(result.error).toBeTruthy();
    }
  });

  it("exposes only the intended fields on success", async () => {
    authOk();
    stageSuccess({
      assignments: [
        {
          id: "asg-1",
          reservation_id: RES_ID,
          dining_table_id: TABLE_A,
          seating_start: "2026-10-11T13:00:00-05:00",
          seating_end: "2026-10-11T15:30:00-05:00",
          released_at: null,
        },
      ],
      tables: [
        { id: TABLE_A, label: "A1", seats: 6, zone: "Window", is_active: true, space_id: ROOM_ID },
      ],
    });
    const result = await serverGetReservationTableContext({ reservationId: RES_ID });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const c = result.context;
      expect(c).not.toHaveProperty("contactEmail");
      expect(c).not.toHaveProperty("guests");
      expect(c).not.toHaveProperty("paymentStatus");
      expect(c).not.toHaveProperty("grandTotalCents");
      expect(c.currentAssignments[0]).not.toHaveProperty("released_at");
      expect(c.currentAssignments[0]).toEqual({
        id: "asg-1",
        diningTableId: TABLE_A,
        seatingStart: "2026-10-11T13:00:00-05:00",
        seatingEnd: "2026-10-11T15:30:00-05:00",
        tableLabel: "A1",
        tableSeats: 6,
        tableIsActive: true,
      });
      expect(c.roomTables[0]).toEqual({
        id: TABLE_A,
        label: "A1",
        seats: 6,
        zone: "Window",
        isActive: true,
      });
    }
  });
});
