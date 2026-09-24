/**
 * Centralized status definitions and metadata.
 * No mutation logic here — only definitions and labels.
 */
import type { PaymentStatus, ReservationStatus } from "./types";

export const RESERVATION_STATUSES: ReservationStatus[] = [
  "draft",
  "booking_started",
  "deposit_pending",
  "confirmed",
  "balance_due",
  "paid_in_full",
  "ready_for_service",
  "checked_in",
  "seated",
  "completed",
  "transfer_requested",
  "cancellation_requested",
  "cancelled",
  "no_show",
  "refund_review",
];

export const PAYMENT_STATUSES: PaymentStatus[] = [
  "unpaid",
  "deposit_pending",
  "deposit_paid",
  "partially_paid",
  "balance_due",
  "paid_in_full",
  "partially_refunded",
  "refunded",
  "payment_failed",
  "disputed",
];

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  draft: "Draft",
  booking_started: "Booking Started",
  deposit_pending: "Deposit Pending",
  confirmed: "Confirmed",
  balance_due: "Balance Due",
  paid_in_full: "Paid in Full",
  ready_for_service: "Ready for Service",
  checked_in: "Checked In",
  seated: "Seated",
  completed: "Completed",
  transfer_requested: "Transfer Requested",
  cancellation_requested: "Cancellation Requested",
  cancelled: "Cancelled",
  no_show: "No Show",
  refund_review: "Refund Review",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  deposit_pending: "Deposit Pending",
  deposit_paid: "Deposit Paid",
  partially_paid: "Partially Paid",
  balance_due: "Balance Due",
  paid_in_full: "Paid in Full",
  partially_refunded: "Partially Refunded",
  refunded: "Refunded",
  payment_failed: "Payment Failed",
  disputed: "Disputed",
};

/** Presentation tone for status badges. */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export const RESERVATION_STATUS_TONE: Record<ReservationStatus, StatusTone> = {
  draft: "neutral",
  booking_started: "info",
  deposit_pending: "warning",
  confirmed: "success",
  balance_due: "warning",
  paid_in_full: "success",
  ready_for_service: "info",
  checked_in: "info",
  seated: "info",
  completed: "neutral",
  transfer_requested: "warning",
  cancellation_requested: "warning",
  cancelled: "danger",
  no_show: "danger",
  refund_review: "warning",
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, StatusTone> = {
  unpaid: "neutral",
  deposit_pending: "warning",
  deposit_paid: "info",
  partially_paid: "info",
  balance_due: "warning",
  paid_in_full: "success",
  partially_refunded: "warning",
  refunded: "neutral",
  payment_failed: "danger",
  disputed: "danger",
};
