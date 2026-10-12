/**
 * Focused tests for serverSavePackagePricing — the authorized server action
 * for update_package_guest_pricing_atomic (migration 0025).
 *
 * Exercises the real action with mocked authorization and admin-client
 * boundaries. The action resolves the actor from the authenticated session,
 * validates the strict schema, and calls the RPC — we mock those boundaries,
 * not the action's internal logic.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/server/ordering-auth.server", () => ({
  resolveOrderingActor: vi.fn(),
}));

vi.mock("@/lib/server/supabase-admin.server", () => ({
  getAdminClient: vi.fn(),
}));

import { serverSavePackagePricing } from "@/lib/server/ordering-package-pricing-actions.server";
import { resolveOrderingActor } from "@/lib/server/ordering-auth.server";
import { getAdminClient } from "@/lib/server/supabase-admin.server";

const ACTOR_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const PACKAGE_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const TS = "2026-10-10T12:00:00.000Z";
const TS_ADV = "2026-10-10T12:00:00.001Z";

function mockAdminRpc(rpcResult: { data: unknown; error: null }) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  (getAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc });
  return rpc;
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PACKAGE_ID,
    updated_at: TS_ADV,
    child_rule_type: null,
    child_fixed_price_cents: null,
    child_discount_basis_points: null,
    senior_rule_type: null,
    senior_fixed_price_cents: null,
    senior_discount_basis_points: null,
    ...overrides,
  };
}

function nullPricing() {
  return {
    childRuleType: null,
    childFixedPriceCents: null,
    childDiscountBasisPoints: null,
    seniorRuleType: null,
    seniorFixedPriceCents: null,
    seniorDiscountBasisPoints: null,
  };
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    packageId: PACKAGE_ID,
    expectedUpdatedAt: TS,
    ...nullPricing(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (resolveOrderingActor as ReturnType<typeof vi.fn>).mockResolvedValue({
    role: "content_manager",
    userId: ACTOR_ID,
  });
});

describe("serverSavePackagePricing", () => {
  // ---- Unauthorized: no database access ----
  it("rejects unauthorized access without any RPC call", async () => {
    (resolveOrderingActor as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("unauthorized"));
    const rpc = mockAdminRpc({ data: { ok: true, row: makeRow() }, error: null });
    const result = await serverSavePackagePricing(validInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unexpected");
      expect(result.error).toContain("authorized");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  // ---- Invalid input: no RPC ----
  it("rejects invalid input (missing fields) without any RPC call", async () => {
    const rpc = mockAdminRpc({ data: { ok: true, row: makeRow() }, error: null });
    const result = await serverSavePackagePricing({ packageId: PACKAGE_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_value");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects unknown fields without any RPC call", async () => {
    const rpc = mockAdminRpc({ data: { ok: true, row: makeRow() }, error: null });
    const result = await serverSavePackagePricing({
      ...validInput(),
      actorUserId: "hacker",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_value");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid UUID without any RPC call", async () => {
    const rpc = mockAdminRpc({ data: { ok: true, row: makeRow() }, error: null });
    const result = await serverSavePackagePricing(validInput({ packageId: "not-a-uuid" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_value");
    expect(rpc).not.toHaveBeenCalled();
  });

  // ---- Exact nine-argument mapping and server-derived actor ----
  it("passes the actor from the session, not the browser", async () => {
    const rpc = mockAdminRpc({ data: { ok: true, row: makeRow() }, error: null });
    await serverSavePackagePricing(validInput());
    const args = rpc.mock.calls[0][1];
    expect(args["p_actor"]).toBe(ACTOR_ID);
  });

  it("calls the RPC with exactly nine named arguments", async () => {
    const rpc = mockAdminRpc({ data: { ok: true, row: makeRow() }, error: null });
    await serverSavePackagePricing(
      validInput({
        childRuleType: "fixed_package_price",
        childFixedPriceCents: 1000,
      }),
    );
    const args = rpc.mock.calls[0][1];
    expect(Object.keys(args).sort()).toEqual(
      [
        "p_actor",
        "p_child_discount_basis_points",
        "p_child_fixed_price_cents",
        "p_child_rule_type",
        "p_expected_updated_at",
        "p_package_id",
        "p_senior_discount_basis_points",
        "p_senior_fixed_price_cents",
        "p_senior_rule_type",
      ].sort(),
    );
  });

  // ---- Null and zero preservation ----
  it("preserves null values through the RPC call", async () => {
    const rpc = mockAdminRpc({
      data: { ok: true, row: makeRow({ child_rule_type: null, child_fixed_price_cents: null }) },
      error: null,
    });
    const result = await serverSavePackagePricing(validInput());
    expect(result.ok).toBe(true);
    const args = rpc.mock.calls[0][1];
    expect(args["p_child_rule_type"]).toBeNull();
    expect(args["p_child_fixed_price_cents"]).toBeNull();
    if (result.ok) {
      expect(result.pricing.childRuleType).toBeNull();
      expect(result.pricing.childFixedPriceCents).toBeNull();
    }
  });

  it("preserves zero values through the RPC call", async () => {
    const row = makeRow({
      child_rule_type: "fixed_package_price",
      child_fixed_price_cents: 0,
    });
    const rpc = mockAdminRpc({ data: { ok: true, row }, error: null });
    const result = await serverSavePackagePricing(
      validInput({ childRuleType: "fixed_package_price", childFixedPriceCents: 0 }),
    );
    expect(result.ok).toBe(true);
    const args = rpc.mock.calls[0][1];
    expect(args["p_child_fixed_price_cents"]).toBe(0);
    if (result.ok) expect(result.pricing.childFixedPriceCents).toBe(0);
  });

  // ---- Valid success including no-op timestamp ----
  it("returns success with unchanged timestamp for a legitimate no-op", async () => {
    const row = makeRow({ updated_at: TS });
    mockAdminRpc({ data: { ok: true, row }, error: null });
    const result = await serverSavePackagePricing(validInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.updatedAt).toBe(TS);
      expect(result.noOp).toBe(true);
    }
  });

  it("returns success with advanced timestamp for a real change", async () => {
    const row = makeRow({ updated_at: TS_ADV });
    mockAdminRpc({ data: { ok: true, row }, error: null });
    const result = await serverSavePackagePricing(validInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.updatedAt).toBe(TS_ADV);
      expect(result.noOp).toBe(false);
    }
  });

  // ---- Mismatched package ID or saved values rejected ----
  it("rejects a mismatched package ID in the success response", async () => {
    const row = makeRow({ id: "cccccccc-0000-4000-8000-000000000003" });
    mockAdminRpc({ data: { ok: true, row }, error: null });
    const result = await serverSavePackagePricing(validInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("rejects a saved value mismatch", async () => {
    const row = makeRow({
      child_rule_type: "percentage_discount",
      child_discount_basis_points: 500,
    });
    mockAdminRpc({ data: { ok: true, row }, error: null });
    const result = await serverSavePackagePricing(validInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  // ---- Malformed/timezone-less response timestamp rejected ----
  it("rejects a timezone-less response timestamp", async () => {
    const row = makeRow({ updated_at: "2026-10-10T12:00:00" });
    mockAdminRpc({ data: { ok: true, row }, error: null });
    const result = await serverSavePackagePricing(validInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("rejects a date-only response timestamp", async () => {
    const row = makeRow({ updated_at: "2026-10-10" });
    mockAdminRpc({ data: { ok: true, row }, error: null });
    const result = await serverSavePackagePricing(validInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("accepts a valid Z timestamp with fractional seconds", async () => {
    const row = makeRow({ updated_at: "2026-10-10T12:00:00.123456Z" });
    mockAdminRpc({ data: { ok: true, row }, error: null });
    const result = await serverSavePackagePricing({
      ...validInput(),
      expectedUpdatedAt: "2026-10-10T12:00:00.123456Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.updatedAt).toBe("2026-10-10T12:00:00.123456Z");
  });

  // ---- Recognized failure codes ----
  it("maps 'conflict' to a reload message", async () => {
    mockAdminRpc({ data: { ok: false, code: "conflict" }, error: null });
    const result = await serverSavePackagePricing(validInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("conflict");
      expect(result.error).toContain("Reload");
    }
  });

  it("maps 'not_found' to a not-found message", async () => {
    mockAdminRpc({ data: { ok: false, code: "not_found" }, error: null });
    const result = await serverSavePackagePricing(validInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
  });

  it("maps 'invalid_value' to a validation message", async () => {
    mockAdminRpc({ data: { ok: false, code: "invalid_value" }, error: null });
    const result = await serverSavePackagePricing(validInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_value");
  });

  // ---- Unknown code, malformed response, and network exception ----
  it("returns 'unexpected' for an unknown failure code", async () => {
    mockAdminRpc({ data: { ok: false, code: "something_else" }, error: null });
    const result = await serverSavePackagePricing(validInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("returns 'unexpected' for a malformed response (ok:null)", async () => {
    mockAdminRpc({ data: { ok: null }, error: null });
    const result = await serverSavePackagePricing(validInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("returns 'unexpected' for a malformed response (missing row)", async () => {
    mockAdminRpc({ data: { ok: true }, error: null });
    const result = await serverSavePackagePricing(validInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unexpected");
  });

  it("returns 'unexpected' on a transport error, without exposing raw error text", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("DB_SECRET_CONNECTION_STRING"));
    (getAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc });
    const result = await serverSavePackagePricing(validInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unexpected");
      expect(result.error).not.toContain("DB_SECRET");
    }
  });

  it("returns 'unexpected' when the RPC returns a Supabase error object", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Internal constraint violation" },
    });
    (getAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({ rpc });
    const result = await serverSavePackagePricing(validInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unexpected");
      expect(result.error).not.toContain("Internal constraint");
    }
  });
});
