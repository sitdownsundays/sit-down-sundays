/**
 * Cancel Reservation — focused helper tests.
 *
 * Exercises the pure production helpers in cancel-reservation-helpers.ts.
 * These are HELPER tests, not rendered-dialog tests; they do not prove
 * dialog interaction behavior.
 */
import { describe, it, expect } from "vitest";

import {
  CANCELLABLE_STATUSES,
  isCancellableStatus,
  validateCancellationReason,
  reasonIsValid,
  buildCancelPayload,
  requiresReloadBeforeRetry,
  partyDisplayName,
} from "@/components/admin/cancel-reservation-helpers";
import type { ReservationDetailDTO } from "@/lib/reservation/types";

function makeReservation(overrides: Partial<ReservationDetailDTO> = {}): ReservationDetailDTO {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    reservationNumber: "SDS-0001",
    status: "confirmed",
    paymentStatus: "unpaid",
    experienceType: "standard",
    contactFirstName: "Jane",
    contactLastName: "Doe",
    contactEmail: "jane@example.com",
    contactPhone: "555-0000",
    sundayServiceId: "22222222-2222-2222-2222-222222222222",
    seatingTimeId: "33333333-3333-3333-3333-333333333333",
    spaceName: "Main Hall",
    serviceDate: "2026-10-11",
    seatingStartTime: "17:00",
    seatingEndTime: "19:00",
    partySize: 4,
    adults: 2,
    seniors: 1,
    children: 1,
    guestNotes: "",
    dietaryNotes: "",
    accessibilityRequests: "",
    occasion: "",
    internalNotes: "",
    subtotalCents: 10000,
    depositRequiredCents: 5000,
    grandTotalCents: 10000,
    amountPaidCents: 0,
    remainingBalanceCents: 10000,
    balanceDeadline: null,
    pricingSnapshot: {},
    policySnapshot: {},
    guests: [],
    platters: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("isCancellableStatus", () => {
  it("accepts each supported cancellable status", () => {
    for (const s of CANCELLABLE_STATUSES) {
      expect(isCancellableStatus(s)).toBe(true);
    }
  });

  it("rejects terminal / ineligible statuses", () => {
    const ineligible = [
      "checked_in",
      "seated",
      "completed",
      "no_show",
      "refund_review",
      "cancelled",
      "draft",
      "booking_started",
      "deposit_pending",
    ];
    for (const s of ineligible) {
      expect(isCancellableStatus(s)).toBe(false);
    }
  });

  it("rejects unknown statuses", () => {
    expect(isCancellableStatus("unknown")).toBe(false);
    expect(isCancellableStatus("")).toBe(false);
  });
});

describe("validateCancellationReason", () => {
  it("requires a non-empty reason", () => {
    expect(validateCancellationReason("")).toBe("A cancellation reason is required.");
  });

  it("rejects whitespace-only text", () => {
    expect(validateCancellationReason("   \n\t  ")).toBeTruthy();
    expect(validateCancellationReason("   \n\t  ")).toContain("whitespace");
  });

  it("rejects over-length text", () => {
    const tooLong = "x".repeat(1001);
    expect(validateCancellationReason(tooLong)).toContain("1000");
  });

  it("accepts a valid reason", () => {
    expect(validateCancellationReason("Guest changed plans.")).toBeNull();
  });

  it("accepts a reason at exactly the max length", () => {
    expect(validateCancellationReason("x".repeat(1000))).toBeNull();
  });

  it("reasonIsValid matches validateCancellationReason", () => {
    expect(reasonIsValid("Guest changed plans.")).toBe(true);
    expect(reasonIsValid("")).toBe(false);
    expect(reasonIsValid("   ")).toBe(false);
  });
});

describe("buildCancelPayload", () => {
  it("preserves the reservation ID and the original updatedAt verbatim", () => {
    const r = makeReservation({ updatedAt: "2026-01-01T12:00:00.123456Z" });
    const payload = buildCancelPayload(r, "Guest changed plans.");
    expect(payload).toEqual({
      reservationId: r.id,
      expectedUpdatedAt: "2026-01-01T12:00:00.123456Z",
      reason: "Guest changed plans.",
    });
  });

  it("does not re-fetch or alter the timestamp", () => {
    const r = makeReservation({ updatedAt: "2026-03-15T08:30:00.000Z" });
    const payload = buildCancelPayload(r, "No longer able to attend.");
    expect(payload.expectedUpdatedAt).toBe("2026-03-15T08:30:00.000Z");
    expect(payload.reservationId).toBe(r.id);
    expect(payload.reason).toBe("No longer able to attend.");
  });
});

describe("requiresReloadBeforeRetry", () => {
  it("requires reload for conflict and unexpected codes", () => {
    expect(requiresReloadBeforeRetry("conflict")).toBe(true);
    expect(requiresReloadBeforeRetry("unexpected")).toBe(true);
  });

  it("does not require reload for proven validation/status codes", () => {
    expect(requiresReloadBeforeRetry("invalid_status")).toBe(false);
    expect(requiresReloadBeforeRetry("invalid_data")).toBe(false);
    expect(requiresReloadBeforeRetry("not_found")).toBe(false);
    expect(requiresReloadBeforeRetry("invalid_actor")).toBe(false);
  });
});

describe("partyDisplayName", () => {
  it("uses first and last name when both present", () => {
    expect(
      partyDisplayName(makeReservation({ contactFirstName: "Jane", contactLastName: "Doe" })),
    ).toBe("Jane Doe");
  });

  it("falls back to first name only", () => {
    expect(
      partyDisplayName(makeReservation({ contactFirstName: "Jane", contactLastName: "" })),
    ).toBe("Jane");
  });

  it("falls back to reservation number when no name", () => {
    expect(
      partyDisplayName(
        makeReservation({
          contactFirstName: "",
          contactLastName: "",
          reservationNumber: "SDS-0042",
        }),
      ),
    ).toBe("SDS-0042");
  });
});
