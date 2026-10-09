/**
 * Outcome-tag regression — proves deterministic pre-write failures are tagged
 * proven_rejection (so the client controller may safely unlock editing / a new
 * key), while idempotency-lookup failures and generic submission failures
 * remain uncertain/untagged (persistence outcome unknown — only same-key
 * retry is safe).
 *
 * These are MOCKED-CLIENT tests against the REAL handleSubmitReservationRequest
 * handler. They do NOT execute PostgreSQL or prove concurrency behavior.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SundayServiceDTO, SeatingTimeDTO, PaymentPolicyDTO } from "@/lib/sundays/types";
import type { VenueSpaceDTO } from "@/lib/spaces/types";
import type { OrderingConfigDTO } from "@/lib/ordering/types";

import { handleSubmitReservationRequest } from "@/lib/server/reservation-submit.server";

const SPACE_ID = "11111111-1111-1111-1111-111111111111";
const SERVICE_ID = "22222222-2222-2222-2222-222222222222";
const SEATING_ID = "33333333-3333-3333-3333-333333333333";
const PKG_ID = "44444444-4444-4444-4444-444444444444";
const ADDON_ID = "55555555-5555-5555-5555-555555555555";
const PLATTER_ID = "66666666-6666-6666-6666-666666666666";
const MEAT_ID = "77777777-7777-7777-7777-777777777777";
const MEAT_B_ID = "77777777-7777-7777-7777-777777777778";
const SIDE_ID = "88888888-8888-8888-8888-888888888888";
const SIDE_B_ID = "88888888-8888-8888-8888-888888888889";
const BREAD_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const sundaysMock = {
  listAllSundayServices: vi.fn<() => Promise<SundayServiceDTO[]>>(),
  getSundayService: vi.fn<(id: string) => Promise<SundayServiceDTO | null>>(),
  listSeatingTimesForService: vi.fn<(id: string) => Promise<SeatingTimeDTO[]>>(),
  getPaymentPolicy: vi.fn<() => Promise<PaymentPolicyDTO>>(),
};
const spacesMock = {
  listAllSpaces: vi.fn<() => Promise<VenueSpaceDTO[]>>(),
};
const orderingMock = {
  getOrderingConfig: vi.fn<() => Promise<OrderingConfigDTO>>(),
};
const reservationMock = {
  listPublicAvailability: vi.fn(),
  findByIdempotencyKey: vi.fn(),
  submitRequest: vi.fn(),
  listReservations: vi.fn(),
  getReservation: vi.fn(),
};

vi.mock("@/lib/server/sundays-repository.server", () => ({
  getSundaysRepository: () => sundaysMock,
}));
vi.mock("@/lib/server/space-repository.server", () => ({ getSpaceRepository: () => spacesMock }));
vi.mock("@/lib/server/ordering-repository.server", () => ({
  getOrderingRepository: () => orderingMock,
}));
vi.mock("@/lib/server/reservation-repository.server", () => ({
  getReservationRepository: () => reservationMock,
}));

function space(over: Partial<VenueSpaceDTO> = {}): VenueSpaceDTO {
  return {
    id: SPACE_ID,
    name: "Grand Ballroom",
    slug: "grand-ballroom",
    description: "",
    spaceType: "general_dining",
    reportedCapacity: 950,
    onlineBookingLimit: 100,
    isActive: true,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    ...over,
  };
}

function service(over: Partial<SundayServiceDTO> = {}): SundayServiceDTO {
  return {
    id: SERVICE_ID,
    date: "2099-11-07",
    label: "First Sunday",
    status: "open",
    spaceId: SPACE_ID,
    onlineBookingLimit: 80,
    isActive: true,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    ...over,
  };
}

function seating(over: Partial<SeatingTimeDTO> = {}): SeatingTimeDTO {
  return {
    id: SEATING_ID,
    sundayServiceId: SERVICE_ID,
    label: "Noon seating",
    startTime: "12:00",
    endTime: "14:30",
    onlineBookingLimit: 40,
    isActive: true,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    ...over,
  };
}

function policy(over: Partial<PaymentPolicyDTO> = {}): PaymentPolicyDTO {
  return {
    depositPercent: 50,
    defaultBalanceDeadlineHours: 72,
    restaurantTimezone: "America/Chicago",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    ...over,
  };
}

function orderingConfig(): OrderingConfigDTO {
  return {
    packages: [
      {
        id: PKG_ID,
        name: "Basic Meal",
        slug: "basic-meal",
        description: "",
        pricePerPersonCents: 2950,
        includedMeatsCount: 2,
        includedSidesCount: 2,
        includesBread: true,
        includesSoftDrink: true,
        isActive: true,
        displayOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdBy: null,
        updatedBy: null,
        eligibleItems: [
          {
            id: "e1",
            packageId: PKG_ID,
            menuItemId: MEAT_ID,
            menuItemName: "Fried Chicken",
            selectionCategory: "meat",
          },
          {
            id: "e2",
            packageId: PKG_ID,
            menuItemId: MEAT_B_ID,
            menuItemName: "Meatloaf",
            selectionCategory: "meat",
          },
          {
            id: "e3",
            packageId: PKG_ID,
            menuItemId: SIDE_ID,
            menuItemName: "Mac & Cheese",
            selectionCategory: "side",
          },
          {
            id: "e4",
            packageId: PKG_ID,
            menuItemId: SIDE_B_ID,
            menuItemName: "Collards",
            selectionCategory: "side",
          },
          {
            id: "e5",
            packageId: PKG_ID,
            menuItemId: BREAD_ID,
            menuItemName: "Dinner Rolls",
            selectionCategory: "bread",
          },
        ],
      },
    ],
    addons: [
      {
        id: ADDON_ID,
        name: "Extra Cornbread",
        slug: "extra-cornbread",
        description: "",
        priceCents: 300,
        isActive: true,
        displayOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdBy: null,
        updatedBy: null,
        eligiblePackageIds: [],
      },
    ],
    platters: [
      {
        id: PLATTER_ID,
        name: "Family Platter",
        slug: "family-platter",
        description: "",
        pricePerPlatterCents: 1500,
        servingGuidance: null,
        isActive: true,
        displayOrder: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdBy: null,
        updatedBy: null,
      },
    ],
    guestPricingRules: null,
  };
}

function validGuests(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    guestIndex: i,
    category: "adult" as const,
    packageId: PKG_ID,
    included: [
      { menuItemId: MEAT_ID, selectionCategory: "meat" as const },
      { menuItemId: MEAT_B_ID, selectionCategory: "meat" as const },
      { menuItemId: SIDE_ID, selectionCategory: "side" as const },
      { menuItemId: SIDE_B_ID, selectionCategory: "side" as const },
      { menuItemId: BREAD_ID, selectionCategory: "bread" as const },
    ],
    addons: [] as Array<{ addonId: string; quantity: number }>,
  }));
}

function baseInput(over: Record<string, unknown> = {}) {
  return {
    sundayServiceId: SERVICE_ID,
    seatingTimeId: SEATING_ID,
    experienceType: "standard" as const,
    partySize: 2,
    adults: 2,
    seniors: 0,
    children: 0,
    contactFirstName: "Jane",
    contactLastName: "Doe",
    contactEmail: "jane@example.com",
    contactPhone: "+13125550000",
    guests: validGuests(2),
    platters: [] as Array<{ platterId: string; quantity: number }>,
    idempotencyKey: "key-1",
    ...over,
  };
}

function setupSubmission() {
  sundaysMock.getSundayService.mockResolvedValue(service());
  sundaysMock.listSeatingTimesForService.mockResolvedValue([seating()]);
  sundaysMock.getPaymentPolicy.mockResolvedValue(policy());
  spacesMock.listAllSpaces.mockResolvedValue([space()]);
  orderingMock.getOrderingConfig.mockResolvedValue(orderingConfig());
  reservationMock.submitRequest.mockResolvedValue({
    success: true,
    reservationId: "res-1",
    reservationNumber: "SDS-20991107-AAAA",
    status: "pending_review",
    paymentStatus: "unpaid",
  });
  reservationMock.findByIdempotencyKey.mockResolvedValue(null);
}

describe("handleSubmitReservationRequest — outcome tags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSubmission();
  });

  it("tags an eligibility rejection as proven_rejection and never writes", async () => {
    spacesMock.listAllSpaces.mockResolvedValue([space({ spaceType: "request_only" })]);
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(false);
    expect(r.outcome).toBe("proven_rejection");
    expect(r.rejectionCode).toBe("eligibility_failed");
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("tags a guest-category mismatch as proven_rejection and never writes", async () => {
    const r = await handleSubmitReservationRequest(
      baseInput({
        adults: 2,
        guests: [
          { guestIndex: 0, category: "child", packageId: PKG_ID, included: [], addons: [] },
          { guestIndex: 1, category: "child", packageId: PKG_ID, included: [], addons: [] },
        ],
      }) as never,
    );
    expect(r.success).toBe(false);
    expect(r.outcome).toBe("proven_rejection");
    expect(r.rejectionCode).toBe("validation_failed");
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("tags a private-room request as proven_rejection and never writes", async () => {
    const r = await handleSubmitReservationRequest(
      baseInput({ experienceType: "private_room" }) as never,
    );
    expect(r.success).toBe(false);
    expect(r.outcome).toBe("proven_rejection");
    expect(r.rejectionCode).toBe("invalid_data");
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("tags a preview-to-submit drift as proven_rejection (review_required) and never writes", async () => {
    const r = await handleSubmitReservationRequest(
      baseInput({ clientPreviewSubtotalCents: 999999 }) as never,
    );
    expect(r.success).toBe(false);
    expect(r.outcome).toBe("proven_rejection");
    expect(r.rejectionCode).toBe("review_required");
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("leaves an idempotency-lookup failure uncertain/untagged and never writes", async () => {
    // The lookup itself throws — persistence outcome is unknown. The handler
    // must NOT classify this as a proven rejection; it must surface a safe
    // generic error and never reach submitRequest.
    reservationMock.findByIdempotencyKey.mockRejectedValue(new Error("db down"));
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(false);
    expect(r.outcome).not.toBe("proven_rejection");
    expect(r.rejectionCode).toBeUndefined();
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("leaves a generic submission failure uncertain/untagged (not proven_rejection)", async () => {
    // submitRequest resolves with an untagged failure (e.g. an unknown RPC
    // error code mapped to a safe generic error). The persistence outcome is
    // unknown, so it must NOT be classified as a proven rejection.
    reservationMock.submitRequest.mockResolvedValue({
      success: false,
      error: "We couldn't complete this reservation request. Please try again.",
    });
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(false);
    expect(r.outcome).not.toBe("proven_rejection");
    expect(r.rejectionCode).toBeUndefined();
  });

  it("returns the existing request on matching replay before fresh validation", async () => {
    reservationMock.findByIdempotencyKey.mockResolvedValue({
      success: true,
      reservationId: "res-existing",
      reservationNumber: "SDS-20991107-CCCC",
      status: "pending_review",
      paymentStatus: "unpaid",
      idempotentReplay: true,
    });
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(true);
    expect(r.idempotentReplay).toBe(true);
    expect(r.reservationNumber).toBe("SDS-20991107-CCCC");
    // Replay must short-circuit BEFORE fresh validation/pricing.
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
    expect(orderingMock.getOrderingConfig).not.toHaveBeenCalled();
  });
});
