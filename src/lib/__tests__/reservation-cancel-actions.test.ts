/**
 * cancelReservation action — behavioral tests.
 *
 * Exercises the REAL production action handler serverCancelReservation in
 * reservation-cancel-actions.server.ts. The authorization helper
 * (resolveSundaysActorWithPermission) and the admin Supabase client
 * (getAdminClient) are mocked at their real module boundaries via vi.mock,
 * so the action wiring — permission requested, actor passed to the RPC,
 * input validation, code/message mapping, error handling — is what is under
 * test.
 *
 * These are MOCKED-BOUNDARY tests, not live PostgreSQL. They do not prove the
 * RPC's atomic/rollback behavior; they verify the application wrapper.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the admin Supabase client so we can assert RPC call args and control
// results. getAdminClient returns an object with an .rpc() mock.
// ---------------------------------------------------------------------------
const mockRpc = vi.fn();
vi.mock("@/lib/server/supabase-admin.server", () => ({
  getAdminClient: () => ({ rpc: mockRpc }),
}));

// ---------------------------------------------------------------------------
// Mock the authorization helper so we can control auth outcomes per test.
// ---------------------------------------------------------------------------
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

// Import AFTER mocks are registered.
const { serverCancelReservation } = await import("@/lib/server/reservation-cancel-actions.server");

const ACTOR_ID = "verified-session-user-id";
const RES_ID = "11111111-1111-1111-1111-111111111111";
const EXPECTED_AT = "2026-01-01T00:00:00.000Z";
const NEW_AT = "2026-01-02T00:00:00.000Z";
const REASON = "Guest changed plans.";

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

function rpcSuccess(overrides: Partial<{ updatedAt: string; alreadyCancelled: boolean }> = {}) {
  return {
    data: {
      ok: true,
      reservation_id: RES_ID,
      reservation_updated_at: overrides.updatedAt ?? NEW_AT,
      already_cancelled: overrides.alreadyCancelled ?? false,
    },
    error: null,
  };
}

function rpcFailure(code: string) {
  return { data: { ok: false, code }, error: null };
}

describe("serverCancelReservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockReset();
    mockRpc.mockReset();
  });

  it("requires reservations.manage before reaching the RPC", async () => {
    mockResolve.mockImplementation(authReject);
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith("reservations.manage");
  });

  it("rejects a malformed reservation ID without calling the RPC", async () => {
    mockResolve.mockImplementation(authActor);
    const result = await serverCancelReservation({
      reservationId: "not-a-uuid",
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_data");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid timestamp without calling the RPC", async () => {
    mockResolve.mockImplementation(authActor);
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: "2026-01-01T00:00:00",
      reason: REASON,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_data");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a missing reason without calling the RPC", async () => {
    mockResolve.mockImplementation(authActor);
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_data");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only reason without calling the RPC", async () => {
    mockResolve.mockImplementation(authActor);
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: "   \n\t  ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_data");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects a too-long reason without calling the RPC", async () => {
    mockResolve.mockImplementation(authActor);
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: "x".repeat(1001),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_data");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("rejects injected actor/status/payment fields before reaching the RPC", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcSuccess());
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
      actorUserId: "hacker",
      status: "confirmed",
      paymentStatus: "paid_in_full",
    });
    // The strict schema rejects unknown keys, so the RPC is never called and
    // no injected actor/status/payment field can reach the database.
    expect(result.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("uses the verified session actor, never a browser-supplied one", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcSuccess());
    await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    const call = mockRpc.mock.calls[0];
    expect(call[0]).toBe("cancel_reservation_atomic");
    const args = call[1];
    expect(args.p_actor_user_id).toBe(ACTOR_ID);
    expect(args).not.toHaveProperty("status");
    expect(args).not.toHaveProperty("paymentStatus");
  });

  it("passes the verified actor, exact timestamp, and preserved reason to the RPC", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcSuccess());
    const fractionalTimestamp = "2026-01-01T00:00:00.123456Z";
    const longReason = "Guest called to cancel due to a family emergency.";
    await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: fractionalTimestamp,
      reason: longReason,
    });
    expect(mockRpc).toHaveBeenCalledWith("cancel_reservation_atomic", {
      p_reservation_id: RES_ID,
      p_expected_updated_at: fractionalTimestamp,
      p_actor_user_id: ACTOR_ID,
      p_reason: longReason,
    });
  });

  it("maps a fresh cancellation to typed camelCase fields", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcSuccess());
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reservationId).toBe(RES_ID);
      expect(result.reservationUpdatedAt).toBe(NEW_AT);
      expect(result.alreadyCancelled).toBe(false);
    }
  });

  it("maps an already-cancelled recovery as a successful outcome", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcSuccess({ alreadyCancelled: true }));
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.alreadyCancelled).toBe(true);
      expect(result.reservationUpdatedAt).toBeTruthy();
    }
  });

  it("maps conflict code to a reload message", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcFailure("conflict"));
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("conflict");
      expect(result.error).toContain("Reload");
    }
  });

  it("maps invalid_status code to a status message", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcFailure("invalid_status"));
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("invalid_status");
      expect(result.error).toContain("cannot be cancelled");
    }
  });

  it("maps not_found, invalid_data, and invalid_actor codes distinctly", async () => {
    mockResolve.mockImplementation(authActor);
    for (const code of ["not_found", "invalid_data", "invalid_actor"] as const) {
      mockRpc.mockResolvedValue(rpcFailure(code));
      const result = await serverCancelReservation({
        reservationId: RES_ID,
        expectedUpdatedAt: EXPECTED_AT,
        reason: REASON,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(code);
    }
  });

  it("database/transport error produces a safe failure, not success", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
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
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("db down");
  });

  it("a malformed RPC response (ok true but missing fields) still returns a safe result", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reservationId).toBe(RES_ID);
      expect(result.alreadyCancelled).toBe(false);
    }
  });

  it("a malformed RPC response (no ok field) produces a safe failure", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({ data: null, error: null });
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });
});
