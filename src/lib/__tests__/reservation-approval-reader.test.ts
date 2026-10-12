import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  readReservationApproval,
  validateApprovalRow,
} from "@/lib/server/reservation-approval-reader.server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Minimal fake Supabase query builder for the reservations table. */
function makeFakeClient(row: unknown, error: unknown = null): SupabaseClient {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: row, error })),
  };
  return { from: vi.fn(() => query) } as unknown as SupabaseClient;
}

const RESERVATION_ID = "11111111-1111-1111-1111-111111111111";
const UPDATED_AT = "2026-10-10T10:00:00.123Z";

function baseApprovalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RESERVATION_ID,
    updated_at: UPDATED_AT,
    requires_management_approval: false,
    approved_at: null,
    approved_by: null,
    approval_timing_basis: "historical_unverified",
    approval_submitted_at: null,
    approval_seating_start: null,
    approval_timezone: null,
    ...overrides,
  };
}

describe("readReservationApproval — identity + version checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a valid approval on a matching row", async () => {
    const client = makeFakeClient(baseApprovalRow());
    const result = await readReservationApproval(client, RESERVATION_ID, UPDATED_AT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.approval.timingBasis).toBe("historical_unverified");
      expect(result.approval.requiresManagementApproval).toBe(false);
    }
  });

  it("fails safely when the reservation row is missing", async () => {
    const client = makeFakeClient(null);
    const result = await readReservationApproval(client, RESERVATION_ID, UPDATED_AT);
    expect(result.success).toBe(false);
  });

  it("fails safely on a database error", async () => {
    const client = makeFakeClient(null, new Error("db down"));
    const result = await readReservationApproval(client, RESERVATION_ID, UPDATED_AT);
    expect(result.success).toBe(false);
  });

  it("fails when the row id does not match the requested id", async () => {
    const client = makeFakeClient(baseApprovalRow({ id: "99999999-9999-9999-9999-999999999999" }));
    const result = await readReservationApproval(client, RESERVATION_ID, UPDATED_AT);
    expect(result.success).toBe(false);
  });

  it("fails when updated_at does not match the expected value", async () => {
    const client = makeFakeClient(baseApprovalRow({ updated_at: "2026-10-11T10:00:00.000Z" }));
    const result = await readReservationApproval(client, RESERVATION_ID, UPDATED_AT);
    expect(result.success).toBe(false);
  });

  it("fails when requires_management_approval is null", async () => {
    const client = makeFakeClient(baseApprovalRow({ requires_management_approval: null }));
    const result = await readReservationApproval(client, RESERVATION_ID, UPDATED_AT);
    expect(result.success).toBe(false);
  });

  it("fails when the timing basis is unrecognized", async () => {
    const client = makeFakeClient(baseApprovalRow({ approval_timing_basis: "unknown" }));
    const result = await readReservationApproval(client, RESERVATION_ID, UPDATED_AT);
    expect(result.success).toBe(false);
  });

  it("fails when approvedAt has a timezone but approvedBy is null", async () => {
    const client = makeFakeClient(
      baseApprovalRow({
        approved_at: "2026-10-24T11:00:00-05:00",
        approved_by: null,
      }),
    );
    const result = await readReservationApproval(client, RESERVATION_ID, UPDATED_AT);
    expect(result.success).toBe(false);
  });

  it("fails when approvedBy is a non-UUID", async () => {
    const client = makeFakeClient(
      baseApprovalRow({
        approved_at: "2026-10-24T11:00:00-05:00",
        approved_by: "not-a-uuid",
      }),
    );
    const result = await readReservationApproval(client, RESERVATION_ID, UPDATED_AT);
    expect(result.success).toBe(false);
  });

  it("fails when approvedAt is a date-only string", async () => {
    const client = makeFakeClient(
      baseApprovalRow({
        approved_at: "2026-10-24",
        approved_by: "44444444-4444-4444-4444-444444444444",
      }),
    );
    const result = await readReservationApproval(client, RESERVATION_ID, UPDATED_AT);
    expect(result.success).toBe(false);
  });

  it("preserves a valid late-approved row with actor pair", async () => {
    const client = makeFakeClient(
      baseApprovalRow({
        requires_management_approval: true,
        approved_at: "2026-10-24T11:00:00-05:00",
        approved_by: "44444444-4444-4444-4444-444444444444",
        approval_timing_basis: "late_booking_under_168h",
        approval_submitted_at: "2026-10-24T10:00:00-05:00",
        approval_seating_start: "2026-10-25T17:00:00-05:00",
        approval_timezone: "America/Chicago",
      }),
    );
    const result = await readReservationApproval(client, RESERVATION_ID, UPDATED_AT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.approval.approvedAt).toBe("2026-10-24T11:00:00-05:00");
      expect(result.approval.approvedBy).toBe("44444444-4444-4444-4444-444444444444");
      expect(result.approval.timingBasis).toBe("late_booking_under_168h");
      expect(result.approval.restaurantTimezone).toBe("America/Chicago");
    }
  });

  it("preserves an early-booking row with null actor pair", async () => {
    const client = makeFakeClient(
      baseApprovalRow({
        requires_management_approval: false,
        approval_timing_basis: "early_booking_168h_or_more",
        approval_submitted_at: "2026-10-10T10:00:00Z",
        approval_seating_start: "2026-10-25T17:00:00-05:00",
        approval_timezone: "America/Chicago",
      }),
    );
    const result = await readReservationApproval(client, RESERVATION_ID, UPDATED_AT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.approval.approvedAt).toBeNull();
      expect(result.approval.approvedBy).toBeNull();
      expect(result.approval.timingBasis).toBe("early_booking_168h_or_more");
    }
  });
});

describe("validateApprovalRow — unit cases", () => {
  it("rejects a non-object row", () => {
    expect(validateApprovalRow("not-an-object")).toBeNull();
    expect(validateApprovalRow(null)).toBeNull();
    expect(validateApprovalRow([])).toBeNull();
  });

  it("rejects when requires_management_approval is missing", () => {
    const row = { ...baseApprovalRow() };
    delete (row as Record<string, unknown>)["requires_management_approval"];
    expect(validateApprovalRow(row)).toBeNull();
  });

  it("accepts a minimal historical-unverified row", () => {
    const approval = validateApprovalRow(baseApprovalRow());
    expect(approval).not.toBeNull();
    expect(approval?.timingBasis).toBe("historical_unverified");
  });
});
