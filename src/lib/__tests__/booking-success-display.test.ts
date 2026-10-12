/**
 * Focused tests for buildSuccessDisplay — the pure presentation helper used by
 * the reservation success display. A fixed "now" is injected; no timers.
 *
 * Mocked-boundary verification: these test the pure helper only, NOT the
 * rendered React success branch.
 */
import { describe, it, expect } from "vitest";
import { buildSuccessDisplay, formatHoldDeadline } from "@/lib/booking/success-display";
import type { SubmitReservationResult } from "@/lib/reservation/types";

const TZ = "America/Chicago";
const NOW = new Date("2026-10-11T18:00:00Z");
// Server-issued hold deadline 2h in the future, explicit timezone (Z).
const FUTURE_DEADLINE = "2026-10-11T20:00:00Z";
const PAST_DEADLINE = "2026-10-11T16:00:00Z";
const HOLD_ID = "11111111-1111-4111-8111-111111111111";

function result(overrides: Partial<SubmitReservationResult> = {}): SubmitReservationResult {
  return {
    success: true,
    reservationNumber: "SDS-20261011-ABCD",
    status: "pending_review",
    paymentStatus: "unpaid",
    ...overrides,
  };
}

describe("buildSuccessDisplay — reservation reference & statuses", () => {
  it("returns the reservation number", () => {
    const d = buildSuccessDisplay(result(), TZ, NOW);
    expect(d.reservationNumber).toBe("SDS-20261011-ABCD");
  });

  it("null reservation number when missing", () => {
    const d = buildSuccessDisplay(result({ reservationNumber: undefined }), TZ, NOW);
    expect(d.reservationNumber).toBeNull();
  });

  it("null reservation number when blank", () => {
    const d = buildSuccessDisplay(result({ reservationNumber: "  " }), TZ, NOW);
    expect(d.reservationNumber).toBeNull();
  });

  it("labels confirmed/paid_in_full — not pending/unpaid", () => {
    const d = buildSuccessDisplay(
      result({ status: "confirmed", paymentStatus: "paid_in_full" }),
      TZ,
      NOW,
    );
    expect(d.statusLabel).toBe("Confirmed");
    expect(d.paymentLabel).toBe("Paid in full");
  });

  it("unknown status yields null — never fabricated", () => {
    const d = buildSuccessDisplay(
      result({ status: "unknown_xyz" as never, paymentStatus: "unknown_xyz" as never }),
      TZ,
      NOW,
    );
    expect(d.statusLabel).toBeNull();
    expect(d.paymentLabel).toBeNull();
  });

  it("missing status yields null", () => {
    const d = buildSuccessDisplay(result({ status: undefined, paymentStatus: undefined }), TZ, NOW);
    expect(d.statusLabel).toBeNull();
    expect(d.paymentLabel).toBeNull();
  });
});

describe("buildSuccessDisplay — hold metadata", () => {
  it("active held with a future deadline", () => {
    const d = buildSuccessDisplay(
      result({ holdId: HOLD_ID, holdDeadline: FUTURE_DEADLINE, capacityState: "held" }),
      TZ,
      NOW,
    );
    expect(d.hold).toEqual({
      kind: "active_held",
      deadlineFormatted: expect.any(String),
      deadlinePassed: false,
    });
    if (d.hold.kind === "active_held") {
      expect(d.hold.deadlineFormatted).toContain("CDT");
    }
  });

  it("past deadline — no cancellation/release claim", () => {
    const d = buildSuccessDisplay(
      result({ holdId: HOLD_ID, holdDeadline: PAST_DEADLINE, capacityState: "held" }),
      TZ,
      NOW,
    );
    expect(d.hold).toEqual({
      kind: "active_held",
      deadlineFormatted: expect.any(String),
      deadlinePassed: true,
    });
  });

  it("historical replay with no hold metadata — kind none", () => {
    const d = buildSuccessDisplay(result(), TZ, NOW);
    expect(d.hold).toEqual({ kind: "none" });
  });

  it("historical replay with all-empty hold metadata — kind none", () => {
    const d = buildSuccessDisplay(
      result({ holdId: "", holdDeadline: "", capacityState: "" }),
      TZ,
      NOW,
    );
    expect(d.hold).toEqual({ kind: "none" });
  });

  it("malformed holdId → unverified", () => {
    const d = buildSuccessDisplay(
      result({ holdId: "not-a-uuid", holdDeadline: FUTURE_DEADLINE, capacityState: "held" }),
      TZ,
      NOW,
    );
    expect(d.hold).toEqual({ kind: "unverified" });
  });

  it("timezone-less deadline → unverified", () => {
    const d = buildSuccessDisplay(
      result({ holdId: HOLD_ID, holdDeadline: "2026-10-11T20:00:00", capacityState: "held" }),
      TZ,
      NOW,
    );
    expect(d.hold).toEqual({ kind: "unverified" });
  });

  it("offset-without-colon deadline → unverified", () => {
    const d = buildSuccessDisplay(
      result({ holdId: HOLD_ID, holdDeadline: "2026-10-11T20:00:00-0500", capacityState: "held" }),
      TZ,
      NOW,
    );
    expect(d.hold).toEqual({ kind: "unverified" });
  });

  it("unknown capacityState → unverified", () => {
    const d = buildSuccessDisplay(
      result({ holdId: HOLD_ID, holdDeadline: FUTURE_DEADLINE, capacityState: "frozen" }),
      TZ,
      NOW,
    );
    expect(d.hold).toEqual({ kind: "unverified" });
  });

  it("partial metadata (state only) → unverified", () => {
    const d = buildSuccessDisplay(result({ capacityState: "held" }), TZ, NOW);
    expect(d.hold).toEqual({ kind: "unverified" });
  });

  it("partial metadata (deadline only) → unverified", () => {
    const d = buildSuccessDisplay(result({ holdDeadline: FUTURE_DEADLINE }), TZ, NOW);
    expect(d.hold).toEqual({ kind: "unverified" });
  });

  it("released state — no active hold", () => {
    const d = buildSuccessDisplay(
      result({ holdId: HOLD_ID, holdDeadline: PAST_DEADLINE, capacityState: "released" }),
      TZ,
      NOW,
    );
    expect(d.hold).toEqual({ kind: "released" });
  });

  it("allocated state — no pending-payment hold countdown", () => {
    const d = buildSuccessDisplay(
      result({ holdId: HOLD_ID, holdDeadline: FUTURE_DEADLINE, capacityState: "allocated" }),
      TZ,
      NOW,
    );
    expect(d.hold).toEqual({ kind: "allocated" });
  });

  it("invalid/missing restaurant timezone with otherwise-valid held → unverified", () => {
    const d = buildSuccessDisplay(
      result({ holdId: HOLD_ID, holdDeadline: FUTURE_DEADLINE, capacityState: "held" }),
      "",
      NOW,
    );
    expect(d.hold).toEqual({ kind: "unverified" });
  });

  it("null restaurant timezone → unverified", () => {
    const d = buildSuccessDisplay(
      result({ holdId: HOLD_ID, holdDeadline: FUTURE_DEADLINE, capacityState: "held" }),
      null,
      NOW,
    );
    expect(d.hold).toEqual({ kind: "unverified" });
  });

  it("does not use the browser timezone when tz provided", () => {
    const d = buildSuccessDisplay(
      result({ holdId: HOLD_ID, holdDeadline: FUTURE_DEADLINE, capacityState: "held" }),
      "America/Los_Angeles",
      NOW,
    );
    if (d.hold.kind === "active_held") {
      expect(d.hold.deadlineFormatted).toContain("PDT");
    } else {
      throw new Error("expected active_held");
    }
  });
});

describe("formatHoldDeadline", () => {
  it("returns null for invalid timezone", () => {
    expect(formatHoldDeadline(FUTURE_DEADLINE, "Not/A_Tz")).toBeNull();
  });

  it("returns null for unparseable deadline", () => {
    expect(formatHoldDeadline("not-a-date", TZ)).toBeNull();
  });

  it("formats in the restaurant timezone with a tz label", () => {
    const formatted = formatHoldDeadline(FUTURE_DEADLINE, TZ);
    expect(formatted).not.toBeNull();
    expect(formatted).toMatch(/CDT|CST/);
  });
});
