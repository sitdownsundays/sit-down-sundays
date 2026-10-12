/**
 * assignReservationTables action — behavioral tests.
 *
 * Exercises the REAL production action handler serverAssignReservationTables
 * in reservation-tables-actions.server.ts. The authorization helper
 * (resolveSundaysActorWithPermission) and the admin Supabase client
 * (getAdminClient) are mocked at their real module boundaries via vi.mock, so
 * the action wiring — permission requested, actor passed to the RPC, input
 * validation, runtime response validation, code/message mapping, and error
 * handling — is what is under test.
 *
 * These are MOCKED-BOUNDARY tests, not live PostgreSQL. They do not prove the
 * RPC's atomic/locking behavior; they verify the application wrapper.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRpc = vi.fn();
vi.mock("@/lib/server/supabase-admin.server", () => ({
  getAdminClient: () => ({ rpc: mockRpc }),
}));

const mockResolve = vi.fn();
vi.mock("@/lib/server/sundays-auth.server", () => ({
  resolveSundaysActorWithPermission: (permission: string) => mockResolve(permission),
  SundaysAuthorizationError: class SundaysAuthorizationError extends Error {
    constructor(message = "You are not authorized.") {
      super(message);
      this.name = "SundaysAuthorizationError";
    }
  },
}));

const { serverAssignReservationTables } =
  await import("@/lib/server/reservation-tables-actions.server");

const ACTOR_ID = "verified-session-user-id";
const RES_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "44444444-4444-4444-4444-444444444444";
const TABLE_A = "22222222-2222-2222-2222-222222222222";
const TABLE_B = "33333333-3333-3333-3333-333333333333";
const TABLE_C = "55555555-5555-5555-5555-555555555555";
const EXPECTED_AT = "2026-01-01T00:00:00.000Z";
const NEW_AT = "2026-01-02T00:00:00.000Z";

function authActor(): { role: string; userId: string } {
  return { role: "ops_manager", userId: ACTOR_ID };
}

function authReject(): never {
  throw new (class extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "SundaysAuthorizationError";
    }
  })();
}

function rpcSuccess(
  overrides: Partial<{
    ids: string[];
    updatedAt: string;
    reservationId: string;
  }> = {},
) {
  return {
    data: {
      ok: true,
      reservation_id: overrides.reservationId ?? RES_ID,
      assigned_table_ids: overrides.ids ?? [TABLE_A, TABLE_B],
      reservation_updated_at: overrides.updatedAt ?? NEW_AT,
    },
    error: null,
  };
}

function rpcFailure(code: string) {
  return { data: { ok: false, code }, error: null };
}

describe("serverAssignReservationTables", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockReset();
    mockRpc.mockReset();
  });

  it("requires seating.manage before reaching the RPC", async () => {
    mockResolve.mockImplementation(authReject);
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith("seating.manage");
  });

  it("rejects malformed reservation ID without calling the RPC", async () => {
    mockResolve.mockImplementation(authActor);
    const result = await serverAssignReservationTables({
      reservationId: "not-a-uuid",
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_data");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID table ID without calling the RPC", async () => {
    mockResolve.mockImplementation(authActor);
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: ["bad-id"],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects duplicate table IDs without calling the RPC", async () => {
    mockResolve.mockImplementation(authActor);
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A, TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid timestamp without calling the RPC", async () => {
    mockResolve.mockImplementation(authActor);
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: "",
    });
    expect(result.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects injected actor/status/room fields before reaching the RPC", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcSuccess());
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
      actorUserId: "hacker",
      status: "confirmed",
      room: "ballroom",
    });
    expect(result.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("uses the verified session actor, never a browser-supplied one", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcSuccess());
    await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    const call = mockRpc.mock.calls[0];
    expect(call[0]).toBe("assign_reservation_tables_atomic");
    const args = call[1];
    expect(args.p_actor_user_id).toBe(ACTOR_ID);
    expect(args).not.toHaveProperty("status");
    expect(args).not.toHaveProperty("room");
  });

  it("passes the verified actor and exact expected timestamp to the RPC", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcSuccess());
    await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A, TABLE_B],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(mockRpc).toHaveBeenCalledWith("assign_reservation_tables_atomic", {
      p_reservation_id: RES_ID,
      p_table_ids: [TABLE_A, TABLE_B],
      p_expected_updated_at: EXPECTED_AT,
      p_actor_user_id: ACTOR_ID,
    });
  });

  it("passes an empty array through as an explicit release-all", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcSuccess({ ids: [], updatedAt: NEW_AT }));
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(mockRpc).toHaveBeenCalledWith("assign_reservation_tables_atomic", {
      p_reservation_id: RES_ID,
      p_table_ids: [],
      p_expected_updated_at: EXPECTED_AT,
      p_actor_user_id: ACTOR_ID,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.assignedTableIds).toEqual([]);
  });

  it("maps success to typed camelCase fields", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcSuccess());
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A, TABLE_B],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reservationId).toBe(RES_ID);
      expect(result.assignedTableIds).toEqual([TABLE_A, TABLE_B]);
      expect(result.reservationUpdatedAt).toBe(NEW_AT);
    }
  });

  it("accepts a different ordering of the same assigned table IDs", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcSuccess({ ids: [TABLE_B, TABLE_A] }));
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A, TABLE_B],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.assignedTableIds).toEqual([TABLE_B, TABLE_A]);
  });

  it("preserves fractional-second timestamp precision from the response", async () => {
    mockResolve.mockImplementation(authActor);
    const fractional = "2026-01-02T00:00:00.123456Z";
    mockRpc.mockResolvedValue(rpcSuccess({ ids: [TABLE_A], updatedAt: fractional }));
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reservationUpdatedAt).toBe(fractional);
  });

  it("maps conflict code to a reload message", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcFailure("conflict"));
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("conflict");
      expect(result.error).toContain("Reload");
    }
  });

  it("maps table_conflict code to an unavailable-table message", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcFailure("table_conflict"));
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("table_conflict");
      expect(result.error).toContain("already reserved");
    }
  });

  it("maps insufficient_seats code to a capacity message", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcFailure("insufficient_seats"));
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("insufficient_seats");
      expect(result.error).toContain("party size");
    }
  });

  it("maps invalid_table, invalid_configuration, invalid_status codes distinctly", async () => {
    mockResolve.mockImplementation(authActor);
    for (const code of ["invalid_table", "invalid_configuration", "invalid_status"] as const) {
      mockRpc.mockResolvedValue(rpcFailure(code));
      const result = await serverAssignReservationTables({
        reservationId: RES_ID,
        tableIds: [TABLE_A],
        expectedUpdatedAt: EXPECTED_AT,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
    }
  });

  it("an unknown failure code becomes unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcFailure("totally_made_up"));
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("database/transport error produces a safe failure, not success", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unexpected");
      expect(result.error).not.toContain("connection reset");
    }
  });

  it("a thrown client error produces a safe failure, not a raw message", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockRejectedValue(new Error("db down"));
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("db down");
  });

  it("a malformed response (ok true but missing fields) is unexpected, not success", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a malformed response (ok true but missing timestamp) is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({
      data: { ok: true, reservation_id: RES_ID, assigned_table_ids: [TABLE_A] },
      error: null,
    });
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a malformed response (invalid timestamp, no timezone) is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({
      data: {
        ok: true,
        reservation_id: RES_ID,
        assigned_table_ids: [TABLE_A],
        reservation_updated_at: "2026-01-02T00:00:00",
      },
      error: null,
    });
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a response with a wrong reservation ID is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcSuccess({ reservationId: OTHER_ID, ids: [TABLE_A] }));
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a response with a non-array assigned_table_ids is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({
      data: {
        ok: true,
        reservation_id: RES_ID,
        assigned_table_ids: TABLE_A,
        reservation_updated_at: NEW_AT,
      },
      error: null,
    });
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a response with a non-UUID table ID is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({
      data: {
        ok: true,
        reservation_id: RES_ID,
        assigned_table_ids: ["not-a-uuid"],
        reservation_updated_at: NEW_AT,
      },
      error: null,
    });
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a response with duplicate assigned_table_ids is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({
      data: {
        ok: true,
        reservation_id: RES_ID,
        assigned_table_ids: [TABLE_A, TABLE_A],
        reservation_updated_at: NEW_AT,
      },
      error: null,
    });
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a response whose assigned table set does not match the request is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(
      rpcSuccess({ ids: [TABLE_A, TABLE_C] }), // C was not requested
    );
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A, TABLE_B],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a response with more table IDs than requested is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(
      rpcSuccess({ ids: [TABLE_A, TABLE_B] }), // B was not requested
    );
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a null response is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({ data: null, error: null });
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a non-object response is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({ data: "assigned", error: null });
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a response with a non-boolean ok field is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({ data: { ok: "true", reservation_id: RES_ID }, error: null });
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a failure response with an unknown code is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({ data: { ok: false, code: 42 }, error: null });
    const result = await serverAssignReservationTables({
      reservationId: RES_ID,
      tableIds: [TABLE_A],
      expectedUpdatedAt: EXPECTED_AT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });
});
