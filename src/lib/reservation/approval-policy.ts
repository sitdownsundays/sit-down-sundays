/**
 * Late-booking approval policy — pure, testable helpers.
 *
 * For NEW reservation requests, compare the server submission time with the
 * selected seating's start (in the configured restaurant timezone):
 *
 *   * >= 168 hours before seating  → eligible for automatic confirmation
 *                                    after the verified required deposit.
 *   * <  168 hours before seating  → management approval is required BEFORE
 *                                    the customer can create or access a
 *                                    deposit Checkout Session.
 *
 * Exactly 168 hours qualifies for automatic confirmation.
 *
 * Management approval is NOT payment and must NOT mark an unpaid reservation
 * as deposit-paid or payment-confirmed. It only authorises the deposit-
 * payment window.
 *
 * The server derives the approval requirement and its timing basis. No
 * approval decision, approval timestamp, or exemption is accepted from
 * browser input.
 */

/** The cutoff in hours: 7 days = 168 hours. */
export const APPROVAL_CUTOFF_HOURS = 168;

/** The deposit-payment window in hours after approval (or submission for early bookings). */
export const DEPOSIT_WINDOW_HOURS = 2;

/** Default remaining-balance deadline: hours before the selected seating. */
export const DEFAULT_BALANCE_DEADLINE_HOURS = 72;

export type BalanceDeadlineType = "default" | "hours_before" | "custom" | "pay_at_check_in";

export interface LateBookingAssessment {
  /** >= 168 h before seating — automatic confirmation eligible after verified deposit. */
  earlyBooking: boolean;
  /** < 168 h before seating — management approval required before payment. */
  requiresApproval: boolean;
  /** Hours between submission and seating (may be negative for past seatings). */
  hoursBeforeSeating: number;
}

/**
 * Assess whether a new reservation request requires management approval.
 *
 * Both timestamps are epoch milliseconds. The caller MUST derive
 * `seatingStartMs` from the authoritative service date + seating start time
 * using the configured restaurant timezone — never the browser timezone or
 * UTC calendar arithmetic.
 */
export function assessApprovalPolicy(
  submittedAtMs: number,
  seatingStartMs: number,
): LateBookingAssessment {
  const msDiff = seatingStartMs - submittedAtMs;
  const hours = msDiff / (60 * 60 * 1000);
  const earlyBooking = hours >= APPROVAL_CUTOFF_HOURS;
  return {
    earlyBooking,
    requiresApproval: !earlyBooking,
    hoursBeforeSeating: hours,
  };
}

/**
 * Compute the remaining-balance deadline (epoch ms) for a given rule.
 *
 * Returns `null` when the inputs are invalid (missing/zero/negative custom
 * hours). The caller must separately reject a past default deadline by
 * checking `isDefaultDeadlinePassed`.
 */
export function computeBalanceDeadline(
  seatingStartMs: number,
  deadlineType: BalanceDeadlineType,
  customHours: number | null,
): number | null {
  if (deadlineType === "pay_at_check_in") {
    return seatingStartMs;
  }

  if (deadlineType === "default") {
    return seatingStartMs - DEFAULT_BALANCE_DEADLINE_HOURS * 60 * 60 * 1000;
  }

  if (deadlineType === "hours_before" || deadlineType === "custom") {
    if (customHours === null || customHours <= 0 || !Number.isFinite(customHours)) {
      return null;
    }
    return seatingStartMs - customHours * 60 * 60 * 1000;
  }

  return null;
}

/**
 * Whether the default 72-hour balance deadline has already passed.
 *
 * If true, an explicit management decision is required — the deadline must
 * not be silently moved or presented as a future deadline.
 */
export function isDefaultDeadlinePassed(seatingStartMs: number, nowMs: number): boolean {
  const deadline = seatingStartMs - DEFAULT_BALANCE_DEADLINE_HOURS * 60 * 60 * 1000;
  return deadline <= nowMs;
}

/**
 * Compute the deposit-payment deadline (epoch ms) from an approval or
 * submission timestamp. The window is fixed at 2 hours; it is never extended.
 */
export function computeDepositDeadline(approvalOrSubmissionMs: number): number {
  return approvalOrSubmissionMs + DEPOSIT_WINDOW_HOURS * 60 * 60 * 1000;
}

/**
 * Validate a balance-deadline selection for an approval action.
 *
 * Returns `null` when valid, or a safe error code when invalid.
 */
export function validateBalanceDeadlineSelection(
  deadlineType: BalanceDeadlineType,
  customHours: number | null,
): "invalid_data" | null {
  if (deadlineType === "pay_at_check_in") {
    return null;
  }

  if (deadlineType === "default") {
    return null;
  }

  if (deadlineType === "hours_before" || deadlineType === "custom") {
    if (customHours === null || customHours <= 0 || !Number.isFinite(customHours)) {
      return "invalid_data";
    }
    return null;
  }

  return "invalid_data";
}
