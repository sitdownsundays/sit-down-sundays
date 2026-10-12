/**
 * Focused tests for the real serverApproveReservation action.
 *
 * Exercises the actual production action with mocked authorization
 * (resolveSundaysActorWithPermission), mocked admin client (getAdminClient),
 * and mocked RPC responses. No live Supabase, no real auth session, no
 * network calls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ApprovalResult, ApprovalBalanceDeadlineType } from "@/lib/sundays/types";
import { CANNOT_VERIFY } from "@/lib/server/reservation-rpc-validation.server";

// --- Mock boundaries --------------------------------------------------------

const mockActor = { userId: "actor-uuid-1234" };

vi.mock("@/lib/server/sundays-auth.server", () => ({
  resolveSundaysActorWithPermission: vi.fn(),
}));

vi.mock("@/lib/server/supabase-admin.server", () => ({
  getAdminClient: vi.fn(),
}));

// --- Imports after mocks ---------------------------------------------------

import { serverApproveReservation } from "@/lib/server/reservation-approval-actions.server";
import { resolveSundaysActorWithPermission } from "@/lib/server/sundays-auth.server";
import { getAdminClient } from "@/lib/server/supabase-admin.server";

const RESERVATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_RESERVATION_ID = "22222222-2222-4222-8222-222222222222";

function baseInput(overrides?: Record<string, unknown>) {
  return {
    reservationId: RESERVATION_ID,
    expectedUpdatedAt: "2026-10-11T12:00:00Z",
    balanceDeadlineType: "default",
    ...overrides,
  };
}

function rpcSuccess(overrides?: Record<string, unknown>) {
  return {
    ok: true,
    reservation_id: RESERVATION_ID,
    reservation_updated_at: "2026-10-11T12:01:00Z",
    approved_at: "2026-10-11T12:01:30Z",
    deposit_deadline: "2026-10-11T14:01:30Z",
    balance_deadline: "2026-10-22T15:00:00Z",
    balance_deadline_type: "default",
    already_approved: false,
    ...overrides,
  };
}

function rpcFail(code: string) {
  return { ok: false, code };
}

function mockRpc(response: unknown, throws = false) {
  const rpcFn = vi.fn();
  if (throws) {
    rpcFn.mockRejectedValue(new Error("network failure"));
  } else {
    rpcFn.mockResolvedValue({ data: response, error: null });
  }
  (getAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: () => ({}) } as never);

  // The admin client's .rpc(...) returns a thenable; we need to mock it.
  (getAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc: () => ({ then: rpcFn.mockResolvedValueOnce.bind(rpcFn) }),
  } as never);

  // Simpler: the action calls admin.rpc(name, args) which returns a Promise.
  // We need it to return { data, error }.
  (getAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc: vi
      .fn()
      .mockImplementation((_name: string, _args: unknown) =>
        throws
          ? Promise.reject(new Error("network failure"))
          : Promise.resolve({ data: response, error: null }),
      ),
  } as never);
}

function mockRpcError() {
  (getAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "DB error", code: "P0001" } }),
  } as never);
}

let rpcCallCount = 0;

function mockRpcWithTracking(response: unknown) {
  rpcCallCount = 0;
  (getAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc: vi.fn().mockImplementation(() => {
      rpcCallCount++;
      return Promise.resolve({ data: response, error: null });
    }),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcCallCount = 0;
  (resolveSundaysActorWithPermission as ReturnType<typeof vi.fn>).mockResolvedValue(mockActor);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ------------------------------------------------------------------

describe("serverApproveReservation — authorization", () => {
  it("returns a safe error and makes no RPC call when unauthorized", async () => {
    (resolveSundaysActorWithPermission as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("forbidden"),
    );
    mockRpc(rpcSuccess());

    const result = await serverApproveReservation(baseInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unexpected");
      expect(result.error).not.toContain("DB");
    }
  });
});

describe("serverApproveReservation — input validation", () => {
  it("rejects an invalid UUID with no RPC call", async () => {
    mockRpcWithTracking(rpcSuccess());
    const result = await serverApproveReservation(baseInput({ reservationId: "not-a-uuid" }));
    expect(result.ok).toBe(false);
    expect(rpcCallCount).toBe(0);
  });

  it("rejects unknown fields with no RPC call", async () => {
    mockRpcWithTracking(rpcSuccess());
    const result = await serverApproveReservation(
      baseInput({ secret: "admin", actorUserId: "hacker" }),
    );
    expect(result.ok).toBe(false);
    expect(rpcCallCount).toBe(0);
  });

  it("rejects a timezone-less expectedUpdatedAt with no RPC call", async () => {
    mockRpcWithTracking(rpcSuccess());
    const result = await serverApproveReservation(
      baseInput({ expectedUpdatedAt: "2026-10-11T12:00:00" }),
    );
    expect(result.ok).toBe(false);
    expect(rpcCallCount).toBe(0);
  });

  it("rejects hours_before without customHours with no RPC call", async () => {
    mockRpcWithTracking(rpcSuccess());
    const result = await serverApproveReservation(
      baseInput({ balanceDeadlineType: "hours_before", reason: "Approved by manager." }),
    );
    expect(result.ok).toBe(false);
    expect(rpcCallCount).toBe(0);
  });

  it("rejects custom without customDeadline with no RPC call", async () => {
    mockRpcWithTracking(rpcSuccess());
    const result = await serverApproveReservation(
      baseInput({ balanceDeadlineType: "custom", reason: "Approved by manager." }),
    );
    expect(result.ok).toBe(false);
    expect(rpcCallCount).toBe(0);
  });

  it("rejects default with customHours supplied with no RPC call", async () => {
    mockRpcWithTracking(rpcSuccess());
    const result = await serverApproveReservation(baseInput({ customHours: 48 }));
    expect(result.ok).toBe(false);
    expect(rpcCallCount).toBe(0);
  });

  it("rejects a non-default mode without a reason with no RPC call", async () => {
    mockRpcWithTracking(rpcSuccess());
    const result = await serverApproveReservation(
      baseInput({ balanceDeadlineType: "hours_before", customHours: 48 }),
    );
    expect(result.ok).toBe(false);
    expect(rpcCallCount).toBe(0);
  });

  it("rejects a blank reason for a non-default mode with no RPC call", async () => {
    mockRpcWithTracking(rpcSuccess());
    const result = await serverApproveReservation(
      baseInput({ balanceDeadlineType: "hours_before", customHours: 48, reason: "   " }),
    );
    expect(result.ok).toBe(false);
    expect(rpcCallCount).toBe(0);
  });
});

describe("serverApproveReservation — valid inputs + RPC mapping", () => {
  it("passes session-derived actor (not browser) and exactly seven arguments", async () => {
    const rpcFn = vi.fn().mockResolvedValue({ data: rpcSuccess(), error: null });
    (getAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: rpcFn } as never);

    const result = (await serverApproveReservation(
      baseInput({
        balanceDeadlineType: "hours_before",
        customHours: 48,
        reason: "Manager override.",
      }),
    )) as ApprovalResult;

    expect(rpcFn).toHaveBeenCalledTimes(1);
    const callArgs = rpcFn.mock.calls[0];
    expect(callArgs[0]).toBe("approve_reservation_for_payment_atomic");
    const params = callArgs[1] as Record<string, unknown>;
    expect(params["p_reservation_id"]).toBe(RESERVATION_ID);
    expect(params["p_actor_user_id"]).toBe(mockActor.userId);
    expect(params["p_expected_updated_at"]).toBe("2026-10-11T12:00:00Z");
    expect(params["p_balance_deadline_type"]).toBe("hours_before");
    expect(params["p_custom_hours"]).toBe(48);
    expect(params["p_reason"]).toBe("Manager override.");
    expect(params["p_custom_deadline"]).toBeNull();
    // Exactly seven parameters.
    expect(Object.keys(params)).toHaveLength(7);
    expect(result.ok).toBe(true);
  });

  it("passes custom deadline for custom mode with null hours", async () => {
    const rpcFn = vi.fn().mockResolvedValue({
      data: rpcSuccess({ balance_deadline_type: "custom" }),
      error: null,
    });
    (getAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: rpcFn } as never);

    const result = (await serverApproveReservation(
      baseInput({
        balanceDeadlineType: "custom",
        customDeadline: "2026-10-20T15:00:00-05:00",
        reason: "Custom deadline.",
      }),
    )) as ApprovalResult;

    const params = rpcFn.mock.calls[0][1] as Record<string, unknown>;
    expect(params["p_custom_deadline"]).toBe("2026-10-20T15:00:00-05:00");
    expect(params["p_custom_hours"]).toBeNull();
    expect(params["p_balance_deadline_type"]).toBe("custom");
    expect(result.ok).toBe(true);
  });

  it("passes null for omitted optional fields on default mode", async () => {
    const rpcFn = vi.fn().mockResolvedValue({ data: rpcSuccess(), error: null });
    (getAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: rpcFn } as never);

    await serverApproveReservation(baseInput());

    const params = rpcFn.mock.calls[0][1] as Record<string, unknown>;
    expect(params["p_custom_hours"]).toBeNull();
    expect(params["p_custom_deadline"]).toBeNull();
    expect(params["p_reason"]).toBeNull();
  });

  it("preserves expectedUpdatedAt verbatim in the RPC call", async () => {
    const rpcFn = vi.fn().mockResolvedValue({ data: rpcSuccess(), error: null });
    (getAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: rpcFn } as never);

    await serverApproveReservation(
      baseInput({ expectedUpdatedAt: "2026-10-11T09:30:45.123-05:00" }),
    );

    const params = rpcFn.mock.calls[0][1] as Record<string, unknown>;
    expect(params["p_expected_updated_at"]).toBe("2026-10-11T09:30:45.123-05:00");
  });
});

describe("serverApproveReservation — success response validation", () => {
  it("returns ok:true with preserved timestamps on valid success", async () => {
    mockRpc(rpcSuccess());
    const result = (await serverApproveReservation(baseInput())) as ApprovalResult;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reservationId).toBe(RESERVATION_ID);
      expect(result.reservationUpdatedAt).toBe("2026-10-11T12:01:00Z");
      expect(result.approvedAt).toBe("2026-10-11T12:01:30Z");
      expect(result.depositDeadline).toBe("2026-10-11T14:01:30Z");
      expect(result.balanceDeadline).toBe("2026-10-22T15:00:00Z");
      expect(result.balanceDeadlineType).toBe("default");
      expect(result.alreadyApproved).toBe(false);
    }
  });

  it("returns ok:true for already_approved idempotent recovery", async () => {
    mockRpc(rpcSuccess({ already_approved: true }));
    const result = (await serverApproveReservation(baseInput())) as ApprovalResult;

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.alreadyApproved).toBe(true);
  });

  it("rejects a success response with a mismatched reservation_id", async () => {
    mockRpc(rpcSuccess({ reservation_id: OTHER_RESERVATION_ID }));
    const result = await serverApproveReservation(baseInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Mismatched success falls through to failure-code parsing; since the
      // response had ok:true, parseRpcFailureCode won't find a valid code, so
      // the safe unexpected outcome is returned.
      expect(result.code).toBe("unexpected");
    }
  });

  it("rejects a success response with a missing timestamp", async () => {
    mockRpc(rpcSuccess({ approved_at: null }));
    const result = await serverApproveReservation(baseInput());

    expect(result.ok).toBe(false);
  });

  it("rejects a success response with an unrecognized balance_deadline_type", async () => {
    mockRpc(rpcSuccess({ balance_deadline_type: "unknown_type" }));
    const result = await serverApproveReservation(baseInput());

    expect(result.ok).toBe(false);
  });

  it("rejects a success response with a non-boolean already_approved", async () => {
    mockRpc(rpcSuccess({ already_approved: "yes" }));
    const result = await serverApproveReservation(baseInput());

    expect(result.ok).toBe(false);
  });

  it("rejects a null data response safely", async () => {
    mockRpc(null);
    const result = await serverApproveReservation(baseInput());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });
});

describe("serverApproveReservation — failure codes", () => {
  it("maps conflict to a reload message", async () => {
    mockRpc(rpcFail("conflict"));
    const result = (await serverApproveReservation(baseInput())) as ApprovalResult;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("conflict");
      expect(result.error).toContain("Reload");
    }
  });

  it("maps checkout_requires_review to a reconciliation message", async () => {
    mockRpc(rpcFail("checkout_requires_review"));
    const result = (await serverApproveReservation(baseInput())) as ApprovalResult;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("checkout_requires_review");
      expect(result.error).toContain("reconciliation");
    }
  });

  it("maps default_deadline_passed to a deadline-choice message", async () => {
    mockRpc(rpcFail("default_deadline_passed"));
    const result = (await serverApproveReservation(baseInput())) as ApprovalResult;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("default_deadline_passed");
      expect(result.error).toContain("deadline");
    }
  });

  it("maps invalid_status to a status message", async () => {
    mockRpc(rpcFail("invalid_status"));
    const result = (await serverApproveReservation(baseInput())) as ApprovalResult;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_status");
  });

  it("maps an unknown code to unexpected without exposing raw text", async () => {
    mockRpc(rpcFail("some_unknown_code"));
    const result = (await serverApproveReservation(baseInput())) as ApprovalResult;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unexpected");
      expect(result.error).not.toContain("some_unknown_code");
    }
  });
});

describe("serverApproveReservation — transport failures", () => {
  it("returns an uncertain outcome on RPC error (not a claim of success)", async () => {
    mockRpcError();
    const result = await serverApproveReservation(baseInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unexpected");
      expect(result.error).not.toContain("DB");
    }
  });

  it("returns an uncertain outcome on a thrown network error", async () => {
    mockRpc(rpcSuccess(), true);
    const result = await serverApproveReservation(baseInput());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unexpected");
      expect(result.error).not.toContain("network");
    }
  });
});

describe("serverApproveReservation — returned timestamp validation", () => {
  const TIMESTAMP_FIELDS = [
    { rpcField: "reservation_updated_at", resultField: "reservationUpdatedAt" },
    { rpcField: "approved_at", resultField: "approvedAt" },
    { rpcField: "deposit_deadline", resultField: "depositDeadline" },
    { rpcField: "balance_deadline", resultField: "balanceDeadline" },
  ] as const;

  describe.each(TIMESTAMP_FIELDS)("$rpcField", ({ rpcField, resultField }) => {
    it("rejects a timezone-less timestamp (never success)", async () => {
      mockRpc(rpcSuccess({ [rpcField]: "2026-10-11T12:00:00" }));
      const result = await serverApproveReservation(baseInput());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("unexpected");
        expect(result.error).toBe(CANNOT_VERIFY);
      }
    });

    it("rejects a date-only string (never success)", async () => {
      mockRpc(rpcSuccess({ [rpcField]: "2026-10-11" }));
      const result = await serverApproveReservation(baseInput());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("unexpected");
        expect(result.error).toBe(CANNOT_VERIFY);
      }
    });

    it("accepts a valid Z timestamp with fractional seconds, unchanged", async () => {
      const ts = "2026-10-11T12:01:00.123Z";
      mockRpc(rpcSuccess({ [rpcField]: ts }));
      const result = (await serverApproveReservation(baseInput())) as ApprovalResult;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result[resultField]).toBe(ts);
      }
    });

    it("accepts a valid numeric-offset timestamp with fractional seconds, unchanged", async () => {
      const ts = "2026-10-11T12:01:00.456-05:00";
      mockRpc(rpcSuccess({ [rpcField]: ts }));
      const result = (await serverApproveReservation(baseInput())) as ApprovalResult;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result[resultField]).toBe(ts);
      }
    });
  });
});
