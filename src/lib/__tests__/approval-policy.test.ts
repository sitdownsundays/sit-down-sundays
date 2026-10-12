/**
 * Focused tests for the late-booking approval policy helpers.
 *
 * These exercise the pure production logic in src/lib/reservation/approval-policy.ts.
 * NOT live PostgreSQL, Stripe, or rendered-browser verification.
 */
import { describe, it, expect } from "vitest";
import {
  APPROVAL_CUTOFF_HOURS,
  DEPOSIT_WINDOW_HOURS,
  DEFAULT_BALANCE_DEADLINE_HOURS,
  assessApprovalPolicy,
  computeBalanceDeadline,
  isDefaultDeadlinePassed,
  computeDepositDeadline,
  validateBalanceDeadlineSelection,
} from "@/lib/reservation/approval-policy";

const HOUR_MS = 60 * 60 * 1000;

describe("assessApprovalPolicy — 168-hour cutoff", () => {
  it("qualifies for automatic confirmation at exactly 168 hours", () => {
    const now = Date.now();
    const seating = now + APPROVAL_CUTOFF_HOURS * HOUR_MS;
    const result = assessApprovalPolicy(now, seating);
    expect(result.earlyBooking).toBe(true);
    expect(result.requiresApproval).toBe(false);
    expect(result.hoursBeforeSeating).toBe(168);
  });

  it("qualifies just inside the cutoff (168.01 hours)", () => {
    const now = Date.now();
    const seating = now + 168.01 * HOUR_MS;
    const result = assessApprovalPolicy(now, seating);
    expect(result.earlyBooking).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it("requires approval just before the cutoff (167.99 hours)", () => {
    const now = Date.now();
    const seating = now + 167.99 * HOUR_MS;
    const result = assessApprovalPolicy(now, seating);
    expect(result.earlyBooking).toBe(false);
    expect(result.requiresApproval).toBe(true);
  });

  it("requires approval for a booking 3 days (72 hours) before seating", () => {
    const now = Date.now();
    const seating = now + 72 * HOUR_MS;
    const result = assessApprovalPolicy(now, seating);
    expect(result.requiresApproval).toBe(true);
    expect(result.earlyBooking).toBe(false);
  });

  it("requires approval for a same-time booking (0 hours)", () => {
    const now = Date.now();
    const result = assessApprovalPolicy(now, now);
    expect(result.requiresApproval).toBe(true);
  });

  it("requires approval for a past seating (negative hours)", () => {
    const now = Date.now();
    const pastSeating = now - HOUR_MS;
    const result = assessApprovalPolicy(now, pastSeating);
    expect(result.requiresApproval).toBe(true);
    expect(result.hoursBeforeSeating).toBe(-1);
  });

  it("uses the configured restaurant timezone via caller-supplied epoch ms", () => {
    // The caller converts (serviceDate + seatingStartTime) to epoch ms using
    // the restaurant timezone. The helper just compares the two timestamps.
    // Simulate a 2026-10-25 12:00 America/Chicago seating:
    //   Oct 25 12:00 CDT = Oct 25 17:00 UTC = epoch 1798375200000 (approx)
    const seatingMs = Date.UTC(2026, 9, 25, 17, 0, 0);
    const submissionMs = seatingMs - 200 * HOUR_MS; // 200 hours before
    const result = assessApprovalPolicy(submissionMs, seatingMs);
    expect(result.earlyBooking).toBe(true);
    expect(result.requiresApproval).toBe(false);
    expect(result.hoursBeforeSeating).toBeCloseTo(200, 5);
  });
});

describe("computeBalanceDeadline — deadline types", () => {
  const seatingMs = Date.UTC(2026, 9, 25, 17, 0, 0);

  it("default deadline is 72 hours before seating", () => {
    const deadline = computeBalanceDeadline(seatingMs, "default", null);
    expect(deadline).toBe(seatingMs - DEFAULT_BALANCE_DEADLINE_HOURS * HOUR_MS);
  });

  it("hours_before uses the supplied custom hours", () => {
    const deadline = computeBalanceDeadline(seatingMs, "hours_before", 48);
    expect(deadline).toBe(seatingMs - 48 * HOUR_MS);
  });

  it("custom uses the supplied custom hours", () => {
    const deadline = computeBalanceDeadline(seatingMs, "custom", 24);
    expect(deadline).toBe(seatingMs - 24 * HOUR_MS);
  });

  it("pay_at_check_in returns the seating start", () => {
    const deadline = computeBalanceDeadline(seatingMs, "pay_at_check_in", null);
    expect(deadline).toBe(seatingMs);
  });

  it("returns null for hours_before with missing custom hours", () => {
    expect(computeBalanceDeadline(seatingMs, "hours_before", null)).toBeNull();
  });

  it("returns null for custom with zero hours", () => {
    expect(computeBalanceDeadline(seatingMs, "custom", 0)).toBeNull();
  });

  it("returns null for custom with negative hours", () => {
    expect(computeBalanceDeadline(seatingMs, "custom", -1)).toBeNull();
  });

  it("returns null for custom with NaN hours", () => {
    expect(computeBalanceDeadline(seatingMs, "custom", NaN)).toBeNull();
  });

  it("returns null for custom with Infinity hours", () => {
    expect(computeBalanceDeadline(seatingMs, "custom", Infinity)).toBeNull();
  });
});

describe("isDefaultDeadlinePassed", () => {
  it("returns true when the default deadline is in the past", () => {
    const seatingMs = Date.now() + 24 * HOUR_MS; // 24h from now
    // Default deadline = seatingMs - 72h = 48h ago
    expect(isDefaultDeadlinePassed(seatingMs, Date.now())).toBe(true);
  });

  it("returns false when the default deadline is in the future", () => {
    const seatingMs = Date.now() + 200 * HOUR_MS; // 200h from now
    // Default deadline = seatingMs - 72h = 128h from now → future
    expect(isDefaultDeadlinePassed(seatingMs, Date.now())).toBe(false);
  });

  it("returns true when exactly at the deadline (<=)", () => {
    const now = Date.now();
    const seatingMs = now + DEFAULT_BALANCE_DEADLINE_HOURS * HOUR_MS;
    // Deadline = now → passed (<=)
    expect(isDefaultDeadlinePassed(seatingMs, now)).toBe(true);
  });
});

describe("computeDepositDeadline — fixed 2-hour window", () => {
  it("is exactly 2 hours after the reference time", () => {
    const approvalMs = Date.now();
    const deadline = computeDepositDeadline(approvalMs);
    expect(deadline).toBe(approvalMs + DEPOSIT_WINDOW_HOURS * HOUR_MS);
  });

  it("does not extend when called again with the same reference", () => {
    const approvalMs = Date.now();
    const d1 = computeDepositDeadline(approvalMs);
    const d2 = computeDepositDeadline(approvalMs);
    expect(d1).toBe(d2);
  });
});

describe("validateBalanceDeadlineSelection", () => {
  it("accepts default", () => {
    expect(validateBalanceDeadlineSelection("default", null)).toBeNull();
  });

  it("accepts pay_at_check_in", () => {
    expect(validateBalanceDeadlineSelection("pay_at_check_in", null)).toBeNull();
  });

  it("accepts hours_before with valid positive hours", () => {
    expect(validateBalanceDeadlineSelection("hours_before", 48)).toBeNull();
  });

  it("accepts custom with valid positive hours", () => {
    expect(validateBalanceDeadlineSelection("custom", 24)).toBeNull();
  });

  it("rejects hours_before with null", () => {
    expect(validateBalanceDeadlineSelection("hours_before", null)).toBe("invalid_data");
  });

  it("rejects custom with zero", () => {
    expect(validateBalanceDeadlineSelection("custom", 0)).toBe("invalid_data");
  });

  it("rejects custom with negative", () => {
    expect(validateBalanceDeadlineSelection("custom", -1)).toBe("invalid_data");
  });

  it("rejects an unknown deadline type", () => {
    expect(validateBalanceDeadlineSelection("unknown" as never, null)).toBe("invalid_data");
  });
});

describe("constants", () => {
  it("APPROVAL_CUTOFF_HOURS is 168 (7 days)", () => {
    expect(APPROVAL_CUTOFF_HOURS).toBe(168);
  });

  it("DEPOSIT_WINDOW_HOURS is 2", () => {
    expect(DEPOSIT_WINDOW_HOURS).toBe(2);
  });

  it("DEFAULT_BALANCE_DEADLINE_HOURS is 72", () => {
    expect(DEFAULT_BALANCE_DEADLINE_HOURS).toBe(72);
  });
});
