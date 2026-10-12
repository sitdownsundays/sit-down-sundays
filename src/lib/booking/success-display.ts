/**
 * Pure presentation helper for the reservation-submission success display.
 *
 * Derives human-readable status/payment labels and a server-issued hold
 * deadline from a SubmitReservationResult. Never fabricates a hold, deadline,
 * payment, or confirmation. Missing/unknown values surface as unavailable —
 * not as successful confirmation or a known state.
 *
 * Client-safe: no server-only imports, no env access, pure date math.
 */
import type {
  SubmitReservationResult,
  ReservationStatus,
  ReservationPaymentStatus,
} from "@/lib/reservation/types";
import { isValidTimezone } from "@/lib/reservation/timezone";

/** Combined labels covering reservation-type statuses (incl. pending_review). */
const STATUS_LABELS: Partial<Record<ReservationStatus, string>> = {
  pending_review: "Pending review",
  confirmed: "Confirmed",
  balance_due: "Balance due",
  paid_in_full: "Paid in full",
  ready_for_service: "Ready for service",
  checked_in: "Checked in",
  seated: "Seated",
  completed: "Completed",
  transfer_requested: "Transfer requested",
  cancellation_requested: "Cancellation requested",
  cancelled: "Cancelled",
  no_show: "No show",
  refund_review: "Refund review",
};

const PAYMENT_LABELS: Partial<Record<ReservationPaymentStatus, string>> = {
  unpaid: "Unpaid",
  deposit_pending: "Deposit pending",
  deposit_paid: "Deposit paid",
  partially_paid: "Partially paid",
  balance_due: "Balance due",
  paid_in_full: "Paid in full",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  payment_failed: "Payment failed",
  disputed: "Disputed",
};

const RECOGNIZED_HOLD_STATES = new Set(["held", "allocated", "released"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** An ISO timestamp with an explicit timezone (Z or numeric offset). */
function isExplicitTimezoneTimestamp(value: string): boolean {
  if (!Number.isFinite(Date.parse(value))) return false;
  // Reject timezone-less "YYYY-MM-DDTHH:MM:SS" or "...+HHMM" without colon.
  return /Z$|[+-]\d{2}:\d{2}$/.test(value);
}

export type HoldDisplay =
  | { kind: "active_held"; deadlineFormatted: string; deadlinePassed: boolean }
  | { kind: "allocated" }
  | { kind: "released" }
  | { kind: "none" }
  | { kind: "unverified" };

export interface SuccessDisplay {
  reservationNumber: string | null;
  statusLabel: string | null;
  paymentLabel: string | null;
  hold: HoldDisplay;
}

/**
 * Format a deadline ISO in the configured restaurant timezone, including a
 * timezone label. Returns null if the timezone is invalid.
 */
export function formatHoldDeadline(deadlineISO: string, tz: string): string | null {
  if (!isValidTimezone(tz)) return null;
  const instant = new Date(deadlineISO);
  if (Number.isNaN(instant.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
}

/**
 * Build the success-display presentation data from a server result.
 *
 * `now` is injected so tests can control time. `restaurantTimezone` is the
 * option's configured tz — never the browser timezone.
 */
export function buildSuccessDisplay(
  result: SubmitReservationResult,
  restaurantTimezone: string | null | undefined,
  now: Date = new Date(),
): SuccessDisplay {
  const reservationNumber =
    typeof result.reservationNumber === "string" && result.reservationNumber.trim() !== ""
      ? result.reservationNumber
      : null;

  const statusLabel = result.status != null ? (STATUS_LABELS[result.status] ?? null) : null;
  const paymentLabel =
    result.paymentStatus != null ? (PAYMENT_LABELS[result.paymentStatus] ?? null) : null;

  const hold = resolveHoldDisplay(result, restaurantTimezone, now);

  return { reservationNumber, statusLabel, paymentLabel, hold };
}

function resolveHoldDisplay(
  result: SubmitReservationResult,
  restaurantTimezone: string | null | undefined,
  now: Date,
): HoldDisplay {
  const holdId = result.holdId;
  const holdDeadline = result.holdDeadline;
  const capacityState = result.capacityState;

  // Historical replay with no hold metadata — a legitimate saved reservation
  // that predates capacity holds. Do not invent a deadline.
  if (
    (holdId === undefined || holdId === null || holdId === "") &&
    (holdDeadline === undefined || holdDeadline === null || holdDeadline === "") &&
    (capacityState === undefined || capacityState === null || capacityState === "")
  ) {
    return { kind: "none" };
  }

  // Validate every present field. Any malformed/partial metadata is unverified.
  const idValid = holdId !== undefined && holdId !== null && holdId !== "" && UUID_RE.test(holdId);
  const deadlineValid =
    holdDeadline !== undefined &&
    holdDeadline !== null &&
    holdDeadline !== "" &&
    isExplicitTimezoneTimestamp(holdDeadline as string);
  const stateValid =
    capacityState !== undefined &&
    capacityState !== null &&
    capacityState !== "" &&
    RECOGNIZED_HOLD_STATES.has(capacityState as string);

  // Partial metadata (some fields present, some missing/invalid) → unverified.
  const anyPresent =
    (holdId !== undefined && holdId !== null && holdId !== "") ||
    (holdDeadline !== undefined && holdDeadline !== null && holdDeadline !== "") ||
    (capacityState !== undefined && capacityState !== null && capacityState !== "");

  if (anyPresent && !(idValid && deadlineValid && stateValid)) {
    return { kind: "unverified" };
  }

  // Fully-valid metadata.
  if (capacityState === "released") return { kind: "released" };
  if (capacityState === "allocated") return { kind: "allocated" };

  // held — format the deadline in the restaurant timezone.
  const tz = restaurantTimezone ?? "";
  const formatted = formatHoldDeadline(holdDeadline as string, tz);
  if (formatted === null) return { kind: "unverified" };

  const deadlineMs = new Date(holdDeadline as string).getTime();
  const deadlinePassed = deadlineMs <= now.getTime();

  return { kind: "active_held", deadlineFormatted: formatted, deadlinePassed };
}
