import { describe, it, expect } from "vitest";
import {
  RESERVATION_STATUSES,
  RESERVATION_STATUS_LABELS,
  RESERVATION_STATUS_TONE,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
} from "@/lib/domain/statuses";
import type { ReservationStatus, PaymentStatus } from "@/lib/domain/types";

describe("reservation status definitions", () => {
  it("defines all required statuses", () => {
    const required: ReservationStatus[] = [
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
    expect(RESERVATION_STATUSES.sort()).toEqual(required.sort());
  });

  it("every status has a label and tone", () => {
    for (const s of RESERVATION_STATUSES) {
      expect(RESERVATION_STATUS_LABELS[s]).toBeTruthy();
      expect(RESERVATION_STATUS_TONE[s]).toBeTruthy();
    }
  });

  it("contains no duplicate statuses", () => {
    expect(new Set(RESERVATION_STATUSES).size).toBe(RESERVATION_STATUSES.length);
  });
});

describe("payment status definitions", () => {
  it("defines all required statuses", () => {
    const required: PaymentStatus[] = [
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
    expect(PAYMENT_STATUSES.sort()).toEqual(required.sort());
  });

  it("every status has a label and tone", () => {
    for (const s of PAYMENT_STATUSES) {
      expect(PAYMENT_STATUS_LABELS[s]).toBeTruthy();
      expect(PAYMENT_STATUS_TONE[s]).toBeTruthy();
    }
  });

  it("contains no duplicate statuses", () => {
    expect(new Set(PAYMENT_STATUSES).size).toBe(PAYMENT_STATUSES.length);
  });
});
