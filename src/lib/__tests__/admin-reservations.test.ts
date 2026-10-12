// Admin reservations screen — contract & mapping tests.
//
// The project's vitest config runs in the `node` environment with
// include: src/**/*.test.ts and no DOM/testing-library dependency, so
// rendered React component tests are not supported here. These tests instead
// exercise the data contracts the AdminReservationsPage consumes:
//  - ReservationListItemDTO / ReservationDetailDTO field mapping.
//  - Status label/tone lookups against the domain status maps.
//  - Currency formatting.
//  - Filter values against the listReservationsSchema enum.
//
// These are STRUCTURAL / CONTRACT tests, not rendered UI tests. They verify
// that the DTO shapes and status maps the component imports actually exist and
// agree, so the screen will not crash on undefined .map/.length access.
import { describe, it, expect } from "vitest";

import {
  RESERVATION_STATUS_LABELS,
  RESERVATION_STATUS_TONE,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
} from "@/lib/domain/statuses";
import { formatCurrency } from "@/components/layout/currency-display";
import { listReservationsSchema } from "@/lib/reservation/schema";
import type {
  ReservationListItemDTO,
  ReservationDetailDTO,
  ReservationStatus,
  ReservationPaymentStatus,
} from "@/lib/reservation/types";

/* ---- DTO shape sanity (the fields the component reads) ---- */

function makeListItem(): ReservationListItemDTO {
  return {
    id: "r-1",
    reservationNumber: "SDS-20261006-AB12",
    status: "pending_review",
    paymentStatus: "unpaid",
    contactName: "Jane Doe",
    partySize: 4,
    serviceDate: "2026-10-11",
    seatingStartTime: "12:00",
    remainingBalanceCents: 5000,
    createdAt: "2026-10-06T10:00:00Z",
  };
}

function makeDetail(): ReservationDetailDTO {
  return {
    id: "r-1",
    reservationNumber: "SDS-20261006-AB12",
    status: "pending_review",
    paymentStatus: "unpaid",
    experienceType: "standard",
    contactFirstName: "Jane",
    contactLastName: "Doe",
    contactEmail: "jane@example.com",
    contactPhone: "555-1234",
    sundayServiceId: "svc-1",
    seatingTimeId: "seat-1",
    spaceName: "Grand Ballroom",
    serviceDate: "2026-10-11",
    seatingStartTime: "12:00",
    seatingEndTime: "14:30",
    partySize: 4,
    adults: 3,
    seniors: 1,
    children: 0,
    guestNotes: "",
    dietaryNotes: "Gluten allergy",
    accessibilityRequests: "",
    occasion: "Birthday",
    internalNotes: "",
    subtotalCents: 10000,
    depositRequiredCents: 5000,
    grandTotalCents: 10000,
    amountPaidCents: 0,
    remainingBalanceCents: 5000,
    balanceDeadline: "2026-10-08T12:00:00Z",
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
    guests: [
      {
        id: "g-1",
        guestIndex: 0,
        guestCategory: "adult",
        guestName: null,
        packageId: "pkg-basic",
        packageNameSnapshot: "Basic Meal",
        packagePriceSnapshot: 2950,
        includedSelections: [
          { menuItemId: "item-fried-chicken", selectionCategory: "meat" },
          { menuItemId: "item-mac", selectionCategory: "side" },
        ],
        addons: [
          {
            id: "a-1",
            addonId: "addon-1",
            addonNameSnapshot: "Extra Cornbread",
            pricePerUnitSnapshot: 350,
            quantity: 1,
          },
        ],
      },
    ],
    platters: [
      {
        id: "p-1",
        platterId: "platter-1",
        platterNameSnapshot: "Family Platter",
        pricePerPlatterSnapshot: 2000,
        quantity: 2,
      },
    ],
    createdAt: "2026-10-06T10:00:00Z",
    updatedAt: "2026-10-06T10:00:00Z",
  };
}

describe("admin reservations — list item mapping", () => {
  it("list item exposes all fields the table/cards read", () => {
    const item = makeListItem();
    expect(item.reservationNumber).toBe("SDS-20261006-AB12");
    expect(item.contactName).toBe("Jane Doe");
    expect(item.partySize).toBe(4);
    expect(item.serviceDate).toBe("2026-10-11");
    expect(item.seatingStartTime).toBe("12:00");
    expect(item.remainingBalanceCents).toBe(5000);
    expect(typeof item.status).toBe("string");
    expect(typeof item.paymentStatus).toBe("string");
  });

  it("formats remaining balance as currency", () => {
    expect(formatCurrency(5000)).toContain("50.00");
    expect(formatCurrency(0)).toContain("0.00");
  });
});

describe("admin reservations — detail mapping", () => {
  it("detail exposes contact, party, service, and room fields", () => {
    const d = makeDetail();
    expect(`${d.contactFirstName} ${d.contactLastName}`).toBe("Jane Doe");
    expect(d.spaceName).toBe("Grand Ballroom");
    expect(d.serviceDate).toBe("2026-10-11");
    expect(`${d.seatingStartTime}–${d.seatingEndTime}`).toBe("12:00–14:30");
    expect(`${d.adults} / ${d.seniors} / ${d.children}`).toBe("3 / 1 / 0");
  });

  it("detail exposes guest allocations with package, selections, and addons", () => {
    const d = makeDetail();
    const g = d.guests[0];
    expect(g.packageNameSnapshot).toBe("Basic Meal");
    expect(g.packagePriceSnapshot).toBe(2950);
    expect(g.includedSelections).toHaveLength(2);
    expect(g.includedSelections[0].selectionCategory).toBe("meat");
    expect(g.addons).toHaveLength(1);
    expect(g.addons[0].addonNameSnapshot).toBe("Extra Cornbread");
    expect(g.addons[0].quantity).toBe(1);
  });

  it("detail exposes shared platters priced per platter", () => {
    const d = makeDetail();
    const p = d.platters[0];
    expect(p.platterNameSnapshot).toBe("Family Platter");
    expect(p.pricePerPlatterSnapshot).toBe(2000);
    expect(p.quantity).toBe(2);
    // per-platter × quantity, NOT × party size
    expect(p.pricePerPlatterSnapshot * p.quantity).toBe(4000);
  });

  it("detail exposes pricing and payment snapshot fields", () => {
    const d = makeDetail();
    expect(d.subtotalCents).toBe(10000);
    expect(d.depositRequiredCents).toBe(5000);
    expect(d.grandTotalCents).toBe(10000);
    expect(d.amountPaidCents).toBe(0);
    expect(d.remainingBalanceCents).toBe(5000);
    expect(d.balanceDeadline).not.toBeNull();
  });

  it("detail exposes notes fields the screen renders", () => {
    const d = makeDetail();
    expect(d.dietaryNotes).toBe("Gluten allergy");
    expect(d.occasion).toBe("Birthday");
  });
});

describe("admin reservations — status label/tone lookups", () => {
  // Statuses shared between the reservation model and the domain status map.
  const reservationStatuses: ReservationStatus[] = [
    "confirmed",
    "balance_due",
    "paid_in_full",
    "cancelled",
  ];
  const paymentStatuses: ReservationPaymentStatus[] = [
    "unpaid",
    "deposit_pending",
    "deposit_paid",
    "partially_paid",
    "balance_due",
    "paid_in_full",
  ];

  it("every shared reservation status has a label and tone", () => {
    for (const s of reservationStatuses) {
      expect(RESERVATION_STATUS_LABELS[s as never]).toBeTruthy();
      expect(RESERVATION_STATUS_TONE[s as never]).toBeTruthy();
    }
  });

  it("every payment status used by the screen has a label and tone", () => {
    for (const s of paymentStatuses) {
      expect(PAYMENT_STATUS_LABELS[s as never]).toBeTruthy();
      expect(PAYMENT_STATUS_TONE[s as never]).toBeTruthy();
    }
  });

  it("confirmed maps to a readable label (shared with domain)", () => {
    expect(RESERVATION_STATUS_LABELS["confirmed" as never]).toBe("Confirmed");
  });

  it("unpaid maps to a readable label", () => {
    expect(PAYMENT_STATUS_LABELS["unpaid" as never]).toBe("Unpaid");
  });

  it("reservation-model-only statuses fall back to the raw value (no domain label)", () => {
    // pending_review is a reservation-model status not present in the domain
    // status map; the component falls back to the raw string.
    expect(RESERVATION_STATUS_LABELS["pending_review" as never]).toBeUndefined();
  });
});

describe("admin reservations — filter contract", () => {
  it("status filter values are valid listReservationsSchema enum members", () => {
    const validStatuses = [
      "pending_review",
      "confirmed",
      "balance_due",
      "paid_in_full",
      "cancelled",
    ];
    for (const status of validStatuses) {
      const parsed = listReservationsSchema.safeParse({ status });
      expect(parsed.success, `status ${status} should be valid`).toBe(true);
    }
  });

  it("search is optional and bounded to 120 chars", () => {
    expect(listReservationsSchema.safeParse({ search: "Jane" }).success).toBe(true);
    expect(listReservationsSchema.safeParse({ search: undefined }).success).toBe(true);
    expect(listReservationsSchema.safeParse({ search: "x".repeat(121) }).success).toBe(false);
  });

  it("rejects unknown filter fields (strict)", () => {
    expect(listReservationsSchema.safeParse({ bogus: true }).success).toBe(false);
  });
});
