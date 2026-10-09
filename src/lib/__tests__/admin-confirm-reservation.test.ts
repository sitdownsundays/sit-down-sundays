/**
 * Confirm Reservation — focused helper tests.
 *
 * Exercises the pure production helpers in confirm-reservation-helpers.ts.
 * These are HELPER tests, not rendered-dialog tests; they do not prove
 * dialog interaction behavior.
 */
import { describe, it, expect } from "vitest";

import {
  CONFIRMABLE_STATUS,
  isConfirmableStatus,
  buildConfirmPayload,
  requiresReloadBeforeRetry,
  partyDisplayName,
} from "@/components/admin/confirm-reservation-helpers";
import type { ReservationDetailDTO } from "@/lib/reservation/types";

function makeReservation(overrides: Partial<ReservationDetailDTO> = {}): ReservationDetailDTO {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    reservationNumber: "SDS-0001",
    status: "pending_review",
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

describe("isConfirmableStatus", () => {
  it("accepts pending_review only", () => {
    expect(isConfirmableStatus("pending_review")).toBe(true);
    expect(CONFIRMABLE_STATUS).toBe("pending_review");
  });

  it("rejects confirmed, cancelled, and other statuses", () => {
    const ineligible = [
      "confirmed",
      "balance_due",
      "paid_in_full",
      "ready_for_service",
      "checked_in",
      "seated",
      "completed",
      "no_show",
      "refund_review",
      "cancelled",
      "transfer_requested",
      "cancellation_requested",
    ];
    for (const s of ineligible) {
      expect(isConfirmableStatus(s)).toBe(false);
    }
  });

  it("rejects unknown statuses", () => {
    expect(isConfirmableStatus("unknown")).toBe(false);
    expect(isConfirmableStatus("")).toBe(false);
  });
});

describe("buildConfirmPayload", () => {
  it("preserves the reservation ID and the original updatedAt verbatim", () => {
    const r = makeReservation({ updatedAt: "2026-01-01T12:00:00.123456Z" });
    const payload = buildConfirmPayload(r);
    expect(payload).toEqual({
      reservationId: r.id,
      expectedUpdatedAt: "2026-01-01T12:00:00.123456Z",
    });
  });

  it("does not re-fetch or alter the timestamp", () => {
    const r = makeReservation({ updatedAt: "2026-03-15T08:30:00.000Z" });
    const payload = buildConfirmPayload(r);
    expect(payload.expectedUpdatedAt).toBe("2026-03-15T08:30:00.000Z");
    expect(payload.reservationId).toBe(r.id);
  });

  it("does not include a reason field (the endpoint does not accept one)", () => {
    const payload = buildConfirmPayload(makeReservation());
    expect(payload).not.toHaveProperty("reason");
    expect(Object.keys(payload).sort()).toEqual(["expectedUpdatedAt", "reservationId"]);
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
