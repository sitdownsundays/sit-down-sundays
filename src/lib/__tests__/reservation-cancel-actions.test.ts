/**
 * cancelReservation action — behavioral tests.
 *
 * Exercises the REAL production action handler serverCancelReservation in
 * reservation-cancel-actions.server.ts. The authorization helper
 * (resolveSundaysActorWithPermission) and the admin Supabase client
 * (getAdminClient) are mocked at their real module boundaries via vi.mock,
 * so the action wiring — permission requested, actor passed to the RPC,
 * input validation, runtime response validation, code/message mapping, and
 * error handling — is what is under test.
 *
 * These are MOCKED-BOUNDARY tests, not live PostgreSQL. They do not prove the
 * RPC's atomic/rollback behavior; they verify the application wrapper.
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

const { serverCancelReservation } = await import("@/lib/server/reservation-cancel-actions.server");

const ACTOR_ID = "verified-session-user-id";
const RES_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "44444444-4444-4444-4444-444444444444";
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

function rpcSuccess(
  overrides: Partial<{ updatedAt: string; alreadyCancelled: boolean; reservationId: string }> = {},
) {
  return {
    data: {
      ok: true,
      reservation_id: overrides.reservationId ?? RES_ID,
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

  it("preserves fractional-second timestamp precision from the response", async () => {
    mockResolve.mockImplementation(authActor);
    const fractional = "2026-01-02T00:00:00.123456Z";
    mockRpc.mockResolvedValue(rpcSuccess({ updatedAt: fractional }));
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reservationUpdatedAt).toBe(fractional);
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

  it("an unknown failure code becomes unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcFailure("totally_made_up"));
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
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

  it("a malformed response (ok true but missing fields) is unexpected, not success", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a malformed response (ok true but missing timestamp) is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({
      data: { ok: true, reservation_id: RES_ID, already_cancelled: false },
      error: null,
    });
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
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
        reservation_updated_at: "2026-01-02T00:00:00",
        already_cancelled: false,
      },
      error: null,
    });
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a response with a wrong reservation ID is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue(rpcSuccess({ reservationId: OTHER_ID }));
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a response with a non-boolean already_cancelled is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({
      data: {
        ok: true,
        reservation_id: RES_ID,
        reservation_updated_at: NEW_AT,
        already_cancelled: "yes",
      },
      error: null,
    });
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a null response is unexpected", async () => {
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

  it("a non-object response is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({ data: "cancelled", error: null });
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a response with a non-boolean ok field is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({ data: { ok: "true", reservation_id: RES_ID }, error: null });
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("a failure response with an unknown code is unexpected", async () => {
    mockResolve.mockImplementation(authActor);
    mockRpc.mockResolvedValue({ data: { ok: false, code: 42 }, error: null });
    const result = await serverCancelReservation({
      reservationId: RES_ID,
      expectedUpdatedAt: EXPECTED_AT,
      reason: REASON,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });
});
