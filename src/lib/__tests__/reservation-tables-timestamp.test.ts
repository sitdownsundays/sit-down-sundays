/**
 * assignTablesSchema.expectedUpdatedAt — timestamp validation tests.
 *
 * Exercises the REAL production schema (assignTablesSchema) and the
 * isValidOffsetOrZTimestamp helper. Verifies that only timezone-bearing
 * timestamps (Z or numeric offset) are accepted, that fractional seconds are
 * preserved verbatim (not re-serialized through Date), and that naive /
 * malformed values are rejected.
 */
import { describe, it, expect } from "vitest";
import { assignTablesSchema, isValidOffsetOrZTimestamp } from "@/lib/sundays/schema";

const RES_ID = "11111111-1111-1111-1111-111111111111";
const TABLE_A = "22222222-2222-2222-2222-222222222222";

function baseInput(expectedUpdatedAt: string) {
  return { reservationId: RES_ID, tableIds: [TABLE_A], expectedUpdatedAt };
}

describe("isValidOffsetOrZTimestamp", () => {
  it("accepts a Z (UTC) timestamp", () => {
    expect(isValidOffsetOrZTimestamp("2026-01-01T00:00:00.000Z")).toBe(true);
  });

  it("accepts fractional seconds with Z", () => {
    expect(isValidOffsetOrZTimestamp("2026-01-01T12:34:56.789012Z")).toBe(true);
  });

  it("accepts a numeric offset with a colon", () => {
    expect(isValidOffsetOrZTimestamp("2026-01-01T00:00:00-05:00")).toBe(true);
    expect(isValidOffsetOrZTimestamp("2026-01-01T00:00:00+09:00")).toBe(true);
  });

  it("accepts a numeric offset without a colon", () => {
    expect(isValidOffsetOrZTimestamp("2026-01-01T00:00:00-0500")).toBe(true);
  });

  it("accepts fractional seconds with a numeric offset", () => {
    expect(isValidOffsetOrZTimestamp("2026-01-01T12:34:56.123456-05:00")).toBe(true);
  });

  it("rejects a timezone-less (naive) timestamp", () => {
    expect(isValidOffsetOrZTimestamp("2026-01-01T00:00:00")).toBe(false);
    expect(isValidOffsetOrZTimestamp("2026-01-01T00:00:00.000")).toBe(false);
  });

  it("rejects a date-only value", () => {
    expect(isValidOffsetOrZTimestamp("2026-01-01")).toBe(false);
  });

  it("rejects malformed values", () => {
    expect(isValidOffsetOrZTimestamp("")).toBe(false);
    expect(isValidOffsetOrZTimestamp("not-a-date")).toBe(false);
    expect(isValidOffsetOrZTimestamp("2026-13-40T99:99:99Z")).toBe(false);
  });

  it("rejects an offset that is not a real timezone suffix (e.g. bare +5)", () => {
    expect(isValidOffsetOrZTimestamp("2026-01-01T00:00:00+5")).toBe(false);
  });
});

describe("assignTablesSchema.expectedUpdatedAt", () => {
  it("accepts a Z timestamp with fractional seconds", () => {
    const res = assignTablesSchema.safeParse(baseInput("2026-01-01T12:34:56.789012Z"));
    expect(res.success).toBe(true);
  });

  it("accepts a numeric-offset timestamp", () => {
    const res = assignTablesSchema.safeParse(baseInput("2026-01-01T00:00:00-05:00"));
    expect(res.success).toBe(true);
  });

  it("preserves the original fractional string verbatim (no Date rounding)", () => {
    const ts = "2026-01-01T12:34:56.789012345Z";
    const res = assignTablesSchema.safeParse(baseInput(ts));
    expect(res.success).toBe(true);
    if (res.success) {
      // The schema returns the original string, not a re-serialized Date.
      expect(res.data.expectedUpdatedAt).toBe(ts);
    }
  });

  it("rejects a timezone-less timestamp", () => {
    const res = assignTablesSchema.safeParse(baseInput("2026-01-01T00:00:00"));
    expect(res.success).toBe(false);
  });

  it("rejects a malformed timestamp", () => {
    const res = assignTablesSchema.safeParse(baseInput("not-a-timestamp"));
    expect(res.success).toBe(false);
  });

  it("rejects an empty string", () => {
    const res = assignTablesSchema.safeParse(baseInput(""));
    expect(res.success).toBe(false);
  });
});
