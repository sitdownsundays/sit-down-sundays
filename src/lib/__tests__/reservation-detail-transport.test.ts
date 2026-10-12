import { describe, it, expect } from "vitest";
import {
  toReservationDetailTransport,
  asJsonObject,
} from "@/lib/server/reservation-detail-transport.server";
import type { ReservationDetailDTO } from "@/lib/reservation/types";

function baseDetail(overrides: Partial<ReservationDetailDTO> = {}): ReservationDetailDTO {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    reservationNumber: "RES-0001",
    status: "pending_review",
    paymentStatus: "unpaid",
    experienceType: "standard",
    contactFirstName: "Jane",
    contactLastName: "Doe",
    contactEmail: "jane@example.com",
    contactPhone: "555-1234",
    sundayServiceId: "22222222-2222-2222-2222-222222222222",
    seatingTimeId: "33333333-3333-3333-3333-333333333333",
    spaceName: "Main Hall",
    serviceDate: "2026-10-11",
    seatingStartTime: "12:00:00",
    seatingEndTime: "14:00:00",
    partySize: 4,
    adults: 2,
    seniors: 1,
    children: 1,
    guestNotes: "",
    dietaryNotes: "",
    accessibilityRequests: "",
    occasion: "",
    internalNotes: "",
    subtotalCents: 11800,
    depositRequiredCents: 2950,
    grandTotalCents: 11800,
    amountPaidCents: 0,
    remainingBalanceCents: 11800,
    balanceDeadline: "2026-10-11T14:00:00Z",
    approval: {
      requiresManagementApproval: false,
      approvedAt: null,
      approvedBy: null,
      timingBasis: "historical_unverified",
      submittedAt: null,
      seatingStart: null,
      restaurantTimezone: null,
    },
    pricingSnapshot: {},
    policySnapshot: {},
    guests: [],
    platters: [],
    createdAt: "2026-10-10T10:00:00.123Z",
    updatedAt: "2026-10-10T10:00:00.123Z",
    ...overrides,
  };
}

describe("reservation-detail-transport adapter", () => {
  describe("asJsonObject", () => {
    it("accepts nested valid JSON objects", () => {
      const obj = { a: 1, b: "x", c: true, d: null, e: [1, "y", { f: false }] };
      expect(asJsonObject(obj)).toEqual(obj);
    });

    it("accepts null, arrays, booleans, numbers, and strings inside snapshots", () => {
      const obj = {
        str: "hello",
        num: 42,
        bool: true,
        nil: null,
        arr: [1, null, "z", { nested: false }],
      };
      expect(asJsonObject(obj)).toEqual(obj);
    });

    it("rejects functions", () => {
      expect(asJsonObject({ fn: () => 1 })).toBeNull();
    });

    it("rejects undefined values", () => {
      expect(asJsonObject({ u: undefined })).toBeNull();
    });

    it("rejects non-plain objects (Date, Map)", () => {
      expect(asJsonObject({ d: new Date() })).toBeNull();
      expect(asJsonObject({ m: new Map() })).toBeNull();
    });

    it("rejects NaN/Infinity", () => {
      expect(asJsonObject({ nan: NaN })).toBeNull();
      expect(asJsonObject({ inf: Infinity })).toBeNull();
    });

    it("rejects top-level non-objects", () => {
      expect(asJsonObject("string")).toBeNull();
      expect(asJsonObject(42)).toBeNull();
      expect(asJsonObject(null)).toBeNull();
      expect(asJsonObject([1, 2])).toBeNull();
    });
  });

  describe("toReservationDetailTransport", () => {
    it("preserves nested valid pricing/policy JSON unchanged", () => {
      const pricing = {
        lines: [{ label: "Basic Meal x4", amountCents: 11800, kind: "package" }],
        subtotalCents: 11800,
        depositRequiredCents: 2950,
        hasUnresolvedRules: false,
        unresolvedNotes: [],
      };
      const policy = {
        depositPercent: 25,
        balanceDeadlineHours: 2,
        restaurantTimezone: "America/Chicago",
        balanceDeadline: "2026-10-11T14:00:00Z",
      };
      const detail = baseDetail({ pricingSnapshot: pricing, policySnapshot: policy });
      const result = toReservationDetailTransport(detail);
      expect(result.success).toBe(true);
      expect(result.reservation?.pricingSnapshot).toEqual(pricing);
      expect(result.reservation?.policySnapshot).toEqual(policy);
    });

    it("preserves reservation identity and timestamp precision", () => {
      const detail = baseDetail({
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        updatedAt: "2026-10-10T10:00:00.999876Z",
        createdAt: "2026-10-10T09:59:59.123456Z",
      });
      const result = toReservationDetailTransport(detail);
      expect(result.success).toBe(true);
      expect(result.reservation?.id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
      expect(result.reservation?.updatedAt).toBe("2026-10-10T10:00:00.999876Z");
      expect(result.reservation?.createdAt).toBe("2026-10-10T09:59:59.123456Z");
    });

    it("preserves monetary values, guest notes, and all non-snapshot fields", () => {
      const detail = baseDetail({
        subtotalCents: 12345,
        amountPaidCents: 3000,
        remainingBalanceCents: 9345,
        guests: [
          {
            id: "g1",
            guestIndex: 0,
            guestCategory: "adult",
            guestName: "Alice",
            packageId: "pkg-1",
            packageNameSnapshot: "Basic Meal",
            packagePriceSnapshot: 2950,
            includedSelections: [{ menuItemId: "m1", selectionCategory: "meat", name: "Beef" }],
            addons: [],
            foodAllergies: "peanuts",
            dietaryPreferences: "vegetarian",
            mealRequests: "no ice",
          },
        ],
      });
      const result = toReservationDetailTransport(detail);
      expect(result.success).toBe(true);
      expect(result.reservation?.subtotalCents).toBe(12345);
      expect(result.reservation?.amountPaidCents).toBe(3000);
      expect(result.reservation?.remainingBalanceCents).toBe(9345);
      const guest = result.reservation?.guests[0];
      expect(guest).toBeDefined();
      expect(guest?.foodAllergies).toBe("peanuts");
      expect(guest?.guestName).toBe("Alice");
    });

    it("rejects non-JSON pricing snapshot safely without replacing with {}", () => {
      const detail = baseDetail({
        pricingSnapshot: { bad: () => 1 } as unknown as Record<string, unknown>,
      });
      const result = toReservationDetailTransport(detail);
      expect(result.success).toBe(false);
      expect(result.reservation).toBeUndefined();
      expect(result.error).toBeTruthy();
    });

    it("rejects non-JSON policy snapshot safely", () => {
      const detail = baseDetail({
        policySnapshot: { d: new Date() } as unknown as Record<string, unknown>,
      });
      const result = toReservationDetailTransport(detail);
      expect(result.success).toBe(false);
      expect(result.reservation).toBeUndefined();
    });

    it("does not replace invalid snapshots with empty objects", () => {
      const detail = baseDetail({
        pricingSnapshot: { x: undefined } as unknown as Record<string, unknown>,
      });
      const result = toReservationDetailTransport(detail);
      expect(result.success).toBe(false);
      // Must NOT have silently produced {} — the reservation must be absent.
      expect(result.reservation).toBeUndefined();
    });

    it("preserves a valid early-booking approval object", () => {
      const detail = baseDetail({
        approval: {
          requiresManagementApproval: false,
          approvedAt: null,
          approvedBy: null,
          timingBasis: "early_booking_168h_or_more",
          submittedAt: "2026-10-10T10:00:00Z",
          seatingStart: "2026-10-25T17:00:00-05:00",
          restaurantTimezone: "America/Chicago",
        },
      });
      const result = toReservationDetailTransport(detail);
      expect(result.success).toBe(true);
      expect(result.reservation?.approval.timingBasis).toBe("early_booking_168h_or_more");
      expect(result.reservation?.approval.requiresManagementApproval).toBe(false);
      expect(result.reservation?.approval.submittedAt).toBe("2026-10-10T10:00:00Z");
      expect(result.reservation?.approval.seatingStart).toBe("2026-10-25T17:00:00-05:00");
    });

    it("preserves a late-unapproved approval object", () => {
      const detail = baseDetail({
        approval: {
          requiresManagementApproval: true,
          approvedAt: null,
          approvedBy: null,
          timingBasis: "late_booking_under_168h",
          submittedAt: "2026-10-24T10:00:00-05:00",
          seatingStart: "2026-10-25T17:00:00-05:00",
          restaurantTimezone: "America/Chicago",
        },
      });
      const result = toReservationDetailTransport(detail);
      expect(result.success).toBe(true);
      expect(result.reservation?.approval.requiresManagementApproval).toBe(true);
      expect(result.reservation?.approval.approvedAt).toBeNull();
    });

    it("preserves an approved approval with actor pair", () => {
      const detail = baseDetail({
        approval: {
          requiresManagementApproval: true,
          approvedAt: "2026-10-24T11:00:00-05:00",
          approvedBy: "44444444-4444-4444-4444-444444444444",
          timingBasis: "late_booking_under_168h",
          submittedAt: "2026-10-24T10:00:00-05:00",
          seatingStart: "2026-10-25T17:00:00-05:00",
          restaurantTimezone: "America/Chicago",
        },
      });
      const result = toReservationDetailTransport(detail);
      expect(result.success).toBe(true);
      expect(result.reservation?.approval.approvedAt).toBe("2026-10-24T11:00:00-05:00");
      expect(result.reservation?.approval.approvedBy).toBe("44444444-4444-4444-4444-444444444444");
    });

    it("preserves a historical-unverified approval with null timing snapshots", () => {
      const detail = baseDetail({
        approval: {
          requiresManagementApproval: false,
          approvedAt: null,
          approvedBy: null,
          timingBasis: "historical_unverified",
          submittedAt: null,
          seatingStart: null,
          restaurantTimezone: null,
        },
      });
      const result = toReservationDetailTransport(detail);
      expect(result.success).toBe(true);
      expect(result.reservation?.approval.timingBasis).toBe("historical_unverified");
      expect(result.reservation?.approval.submittedAt).toBeNull();
      expect(result.reservation?.approval.seatingStart).toBeNull();
    });

    it("rejects a non-boolean requiresManagementApproval", () => {
      const detail = baseDetail({
        approval: {
          requiresManagementApproval: "false",
          approvedAt: null,
          approvedBy: null,
          timingBasis: "historical_unverified",
          submittedAt: null,
          seatingStart: null,
          restaurantTimezone: null,
        } as unknown as ReservationDetailDTO["approval"],
      });
      const result = toReservationDetailTransport(detail);
      expect(result.success).toBe(false);
      expect(result.reservation).toBeUndefined();
    });

    it("rejects an unrecognized timing basis", () => {
      const detail = baseDetail({
        approval: {
          requiresManagementApproval: false,
          approvedAt: null,
          approvedBy: null,
          timingBasis: "unknown_basis",
          submittedAt: null,
          seatingStart: null,
          restaurantTimezone: null,
        } as unknown as ReservationDetailDTO["approval"],
      });
      const result = toReservationDetailTransport(detail);
      expect(result.success).toBe(false);
      expect(result.reservation).toBeUndefined();
    });

    it("rejects a timestamp without a timezone", () => {
      const detail = baseDetail({
        approval: {
          requiresManagementApproval: true,
          approvedAt: "2026-10-24T11:00:00",
          approvedBy: "44444444-4444-4444-4444-444444444444",
          timingBasis: "late_booking_under_168h",
          submittedAt: "2026-10-24T10:00:00-05:00",
          seatingStart: "2026-10-25T17:00:00-05:00",
          restaurantTimezone: "America/Chicago",
        } as unknown as ReservationDetailDTO["approval"],
      });
      const result = toReservationDetailTransport(detail);
      expect(result.success).toBe(false);
      expect(result.reservation).toBeUndefined();
    });

    it("rejects a date-only approvedAt", () => {
      const detail = baseDetail({
        approval: {
          requiresManagementApproval: true,
          approvedAt: "2026-10-24",
          approvedBy: "44444444-4444-4444-4444-444444444444",
          timingBasis: "late_booking_under_168h",
          submittedAt: "2026-10-24T10:00:00-05:00",
          seatingStart: "2026-10-25T17:00:00-05:00",
          restaurantTimezone: "America/Chicago",
        } as unknown as ReservationDetailDTO["approval"],
      });
      const result = toReservationDetailTransport(detail);
      expect(result.success).toBe(false);
      expect(result.reservation).toBeUndefined();
    });

    it("rejects an actor pair where approvedAt is present but approvedBy is null", () => {
      const detail = baseDetail({
        approval: {
          requiresManagementApproval: true,
          approvedAt: "2026-10-24T11:00:00-05:00",
          approvedBy: null,
          timingBasis: "late_booking_under_168h",
          submittedAt: "2026-10-24T10:00:00-05:00",
          seatingStart: "2026-10-25T17:00:00-05:00",
          restaurantTimezone: "America/Chicago",
        } as unknown as ReservationDetailDTO["approval"],
      });
      const result = toReservationDetailTransport(detail);
      expect(result.success).toBe(false);
      expect(result.reservation).toBeUndefined();
    });

    it("rejects an invalid approvedBy UUID", () => {
      const detail = baseDetail({
        approval: {
          requiresManagementApproval: true,
          approvedAt: "2026-10-24T11:00:00-05:00",
          approvedBy: "not-a-uuid",
          timingBasis: "late_booking_under_168h",
          submittedAt: "2026-10-24T10:00:00-05:00",
          seatingStart: "2026-10-25T17:00:00-05:00",
          restaurantTimezone: "America/Chicago",
        } as unknown as ReservationDetailDTO["approval"],
      });
      const result = toReservationDetailTransport(detail);
      expect(result.success).toBe(false);
      expect(result.reservation).toBeUndefined();
    });

    it("rejects a missing approval object", () => {
      const detail = baseDetail({
        approval: undefined as unknown as ReservationDetailDTO["approval"],
      });
      const result = toReservationDetailTransport(detail);
      expect(result.success).toBe(false);
      expect(result.reservation).toBeUndefined();
    });
  });
});
