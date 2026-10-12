/**
 * Party-wide meal validation wiring — proves the helper is enforced in both
 * the public quote and the NEW reservation submission path, and that
 * historical replays bypass the new check.
 *
 * These are MOCKED-CLIENT tests against the REAL handleSubmitReservationRequest
 * and quoteOrder server functions. They do NOT execute PostgreSQL or prove
 * concurrency behavior.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OrderingConfigDTO } from "@/lib/ordering/types";

// ---------------------------------------------------------------------------
// Shared fixtures — a complete, valid Basic Meal (2 meats, 2 sides, 1 bread).
// ---------------------------------------------------------------------------
const PKG_BASIC = "11111111-0000-4000-8000-000000000001";
const PKG_PREMIUM = "11111111-0000-4000-8000-000000000002";
const MEAT_A = "22222222-0000-4000-8000-000000000001";
const MEAT_B = "22222222-0000-4000-8000-000000000002";
const SIDE_A = "33333333-0000-4000-8000-000000000001";
const SIDE_B = "33333333-0000-4000-8000-000000000002";
const BREAD_A = "44444444-0000-4000-8000-000000000001";

function makeConfig(): OrderingConfigDTO {
  return {
    packages: [
      {
        id: PKG_BASIC,
        name: "Basic Meal",
        slug: "basic-meal",
        description: "",
        pricePerPersonCents: 2950,
        includedMeatsCount: 2,
        includedSidesCount: 2,
        includesBread: true,
        includesSoftDrink: true,
        isActive: true,
        displayOrder: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdBy: null,
        updatedBy: null,
        eligibleItems: [
          {
            id: "e1",
            packageId: PKG_BASIC,
            menuItemId: MEAT_A,
            menuItemName: "Beef",
            selectionCategory: "meat",
          },
          {
            id: "e2",
            packageId: PKG_BASIC,
            menuItemId: MEAT_B,
            menuItemName: "Chicken",
            selectionCategory: "meat",
          },
          {
            id: "e3",
            packageId: PKG_BASIC,
            menuItemId: SIDE_A,
            menuItemName: "Beans",
            selectionCategory: "side",
          },
          {
            id: "e4",
            packageId: PKG_BASIC,
            menuItemId: SIDE_B,
            menuItemName: "Cabbage",
            selectionCategory: "side",
          },
          {
            id: "e5",
            packageId: PKG_BASIC,
            menuItemId: BREAD_A,
            menuItemName: "Rolls",
            selectionCategory: "bread",
          },
        ],
      },
      {
        id: PKG_PREMIUM,
        name: "Premium Meal",
        slug: "premium-meal",
        description: "",
        pricePerPersonCents: 4450,
        includedMeatsCount: 2,
        includedSidesCount: 3,
        includesBread: true,
        includesSoftDrink: true,
        isActive: true,
        displayOrder: 30,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdBy: null,
        updatedBy: null,
        eligibleItems: [
          {
            id: "p1",
            packageId: PKG_PREMIUM,
            menuItemId: MEAT_A,
            menuItemName: "Beef",
            selectionCategory: "meat",
          },
          {
            id: "p2",
            packageId: PKG_PREMIUM,
            menuItemId: MEAT_B,
            menuItemName: "Chicken",
            selectionCategory: "meat",
          },
          {
            id: "p3",
            packageId: PKG_PREMIUM,
            menuItemId: SIDE_A,
            menuItemName: "Beans",
            selectionCategory: "side",
          },
          {
            id: "p4",
            packageId: PKG_PREMIUM,
            menuItemId: SIDE_B,
            menuItemName: "Cabbage",
            selectionCategory: "side",
          },
          {
            id: "p5",
            packageId: PKG_PREMIUM,
            menuItemId: BREAD_A,
            menuItemName: "Rolls",
            selectionCategory: "bread",
          },
        ],
      },
    ],
    addons: [],
    platters: [],
    guestPricingRules: null,
  };
}

function validIncluded() {
  return [
    { menuItemId: MEAT_A, selectionCategory: "meat" as const },
    { menuItemId: MEAT_B, selectionCategory: "meat" as const },
    { menuItemId: SIDE_A, selectionCategory: "side" as const },
    { menuItemId: SIDE_B, selectionCategory: "side" as const },
    { menuItemId: BREAD_A, selectionCategory: "bread" as const },
  ];
}

// ---------------------------------------------------------------------------
// Submission wiring tests
// ---------------------------------------------------------------------------
import { handleSubmitReservationRequest } from "@/lib/server/reservation-submit.server";

const sundaysMock = {
  listAllSundayServices: vi.fn(),
  getSundayService: vi.fn(),
  listSeatingTimesForService: vi.fn(),
  getPaymentPolicy: vi.fn(),
};
const spacesMock = {
  listAllSpaces: vi.fn(),
};
const orderingMock = {
  getOrderingConfig: vi.fn(),
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

function baseInput(over: Record<string, unknown> = {}) {
  return {
    sundayServiceId: "svc-1",
    seatingTimeId: "seat-1",
    experienceType: "standard" as const,
    partySize: 2,
    adults: 2,
    seniors: 0,
    children: 0,
    contactFirstName: "Jane",
    contactLastName: "Doe",
    contactEmail: "jane@example.com",
    contactPhone: "+13125550000",
    guests: [
      {
        guestIndex: 0,
        category: "adult",
        packageId: PKG_BASIC,
        included: validIncluded(),
        addons: [],
      },
      {
        guestIndex: 1,
        category: "adult",
        packageId: PKG_BASIC,
        included: validIncluded(),
        addons: [],
      },
    ],
    platters: [],
    idempotencyKey: "key-1",
    // Required for new requests: a complete ReviewedPrice matching the
    // authoritative recalculation (2 × 2950 = 5900 food, 0 gratuity, 0 tax,
    // 50% deposit). Without this the handler returns review_required before
    // reaching the mocked repository.
    clientPreviewPrice: {
      subtotalCents: 5900,
      gratuityCents: 0,
      taxCents: 0,
      grandTotalCents: 5900,
      depositRequiredCents: 2950,
      appliedGratuityRateBasisPoints: 0,
      appliedTaxRateBasisPoints: 0,
      appliedTaxOnGratuity: false,
      appliedDepositPercent: 50,
    },
    ...over,
  };
}

function setupSubmission() {
  sundaysMock.getSundayService.mockResolvedValue({
    id: "svc-1",
    date: "2099-11-07",
    label: "First Sunday",
    status: "open",
    spaceId: "space-1",
    onlineBookingLimit: 80,
    capacityResourceId: null,
    isActive: true,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
  });
  sundaysMock.listSeatingTimesForService.mockResolvedValue([
    {
      id: "seat-1",
      sundayServiceId: "svc-1",
      label: "Noon",
      startTime: "12:00",
      endTime: "14:30",
      onlineBookingLimit: 40,
      isActive: true,
      displayOrder: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: null,
      updatedBy: null,
    },
  ]);
  sundaysMock.getPaymentPolicy.mockResolvedValue({
    depositPercent: 50,
    defaultBalanceDeadlineHours: 72,
    restaurantTimezone: "America/Chicago",
    // Explicit "no charges" — valid configured policy (food-only total).
    // NULL/undefined would fail pricing under the corrected contract.
    taxRateBasisPoints: 0,
    gratuityRateBasisPoints: 0,
    taxOnGratuity: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
  });
  spacesMock.listAllSpaces.mockResolvedValue([
    {
      id: "space-1",
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
    },
  ]);
  orderingMock.getOrderingConfig.mockResolvedValue(makeConfig());
  reservationMock.submitRequest.mockResolvedValue({
    success: true,
    reservationId: "res-1",
    reservationNumber: "SDS-20991107-AAAA",
    status: "pending_review",
    paymentStatus: "unpaid",
  });
  reservationMock.findByIdempotencyKey.mockResolvedValue(null);
}

describe("handleSubmitReservationRequest — party-wide meal wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSubmission();
  });

  it("accepts a uniform party and persists", async () => {
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(true);
    expect(reservationMock.submitRequest).toHaveBeenCalledTimes(1);
  });

  it("rejects mixed packages as proven_rejection and never persists", async () => {
    const r = await handleSubmitReservationRequest(
      baseInput({
        guests: [
          {
            guestIndex: 0,
            category: "adult",
            packageId: PKG_BASIC,
            included: validIncluded(),
            addons: [],
          },
          {
            guestIndex: 1,
            category: "adult",
            packageId: PKG_PREMIUM,
            included: validIncluded(),
            addons: [],
          },
        ],
      }) as never,
    );
    expect(r.success).toBe(false);
    expect(r.outcome).toBe("proven_rejection");
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("rejects mismatched selections (2nd guest different meat) as proven_rejection", async () => {
    const r = await handleSubmitReservationRequest(
      baseInput({
        guests: [
          {
            guestIndex: 0,
            category: "adult",
            packageId: PKG_BASIC,
            included: validIncluded(),
            addons: [],
          },
          {
            guestIndex: 1,
            category: "adult",
            packageId: PKG_BASIC,
            included: [
              { menuItemId: "22222222-0000-4000-8000-000000000099", selectionCategory: "meat" },
              { menuItemId: MEAT_B, selectionCategory: "meat" },
              { menuItemId: SIDE_A, selectionCategory: "side" },
              { menuItemId: SIDE_B, selectionCategory: "side" },
              { menuItemId: BREAD_A, selectionCategory: "bread" },
            ],
            addons: [],
          },
        ],
      }) as never,
    );
    expect(r.success).toBe(false);
    expect(r.outcome).toBe("proven_rejection");
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("rejects a duplicate selection in the SECOND guest as proven_rejection", async () => {
    const r = await handleSubmitReservationRequest(
      baseInput({
        guests: [
          {
            guestIndex: 0,
            category: "adult",
            packageId: PKG_BASIC,
            included: validIncluded(),
            addons: [],
          },
          {
            guestIndex: 1,
            category: "adult",
            packageId: PKG_BASIC,
            included: [
              { menuItemId: MEAT_A, selectionCategory: "meat" },
              { menuItemId: MEAT_A, selectionCategory: "meat" },
              { menuItemId: SIDE_A, selectionCategory: "side" },
              { menuItemId: SIDE_B, selectionCategory: "side" },
              { menuItemId: BREAD_A, selectionCategory: "bread" },
            ],
            addons: [],
          },
        ],
      }) as never,
    );
    expect(r.success).toBe(false);
    expect(r.outcome).toBe("proven_rejection");
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("rejects individual add-ons as proven_rejection and never persists", async () => {
    const r = await handleSubmitReservationRequest(
      baseInput({
        guests: [
          {
            guestIndex: 0,
            category: "adult",
            packageId: PKG_BASIC,
            included: validIncluded(),
            addons: [{ addonId: "addon-1", quantity: 1 }],
          },
          {
            guestIndex: 1,
            category: "adult",
            packageId: PKG_BASIC,
            included: validIncluded(),
            addons: [],
          },
        ],
      }) as never,
    );
    expect(r.success).toBe(false);
    expect(r.outcome).toBe("proven_rejection");
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("replays a matching existing request BEFORE party-wide validation", async () => {
    // A historical reservation may have mixed meals; replay must bypass
    // the new party-wide check and return the original identity.
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
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
    expect(orderingMock.getOrderingConfig).not.toHaveBeenCalled();
  });
});
