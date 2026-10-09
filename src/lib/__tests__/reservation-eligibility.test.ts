/**
 * Reservation submission eligibility — behavioral tests.
 *
 * Exercises the REAL production helpers in reservation-eligibility.server.ts
 * and the REAL handleSubmitReservationRequest submission core (with mocked
 * repository dependencies). Proves the shared eligibility rules used by both
 * public availability and submission reject invalid requests with zero writes.
 *
 * These are MOCKED-CLIENT tests (no real database, no real Supabase). They do
 * NOT prove PostgreSQL concurrency behavior.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SundayServiceDTO, SeatingTimeDTO, PaymentPolicyDTO } from "@/lib/sundays/types";
import type { VenueSpaceDTO } from "@/lib/spaces/types";
import type { OrderingConfigDTO } from "@/lib/ordering/types";

import {
  evaluateEligibility,
  validatePartyComposition,
  validatePartySizeAgainstCeiling,
  validateNewRequestEligibility,
  buildEligibleOptions,
} from "@/lib/server/reservation-eligibility.server";

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
const BREAD_ID = "99999999-9999-9999-9999-999999999999";

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

const FUTURE_NOW = new Date("2026-01-01T00:00:00.000Z");

describe("evaluateEligibility — single (service, seating, space) pair", () => {
  it("accepts a valid general-dining option and returns the smallest ceiling", () => {
    const r = evaluateEligibility(service(), seating(), space(), policy(), FUTURE_NOW);
    expect(r.eligible).toBe(true);
    expect(r.ceiling).toBe(40); // min(100, 80, 40)
    expect(r.seatingInstant).toBeTruthy();
  });

  it("rejects request-only spaces", () => {
    const r = evaluateEligibility(
      service(),
      seating(),
      space({ spaceType: "request_only" }),
      policy(),
      FUTURE_NOW,
    );
    expect(r.eligible).toBe(false);
  });

  it("rejects not-bookable spaces", () => {
    const r = evaluateEligibility(
      service(),
      seating(),
      space({ spaceType: "not_bookable" }),
      policy(),
      FUTURE_NOW,
    );
    expect(r.eligible).toBe(false);
  });

  it("rejects inactive spaces", () => {
    const r = evaluateEligibility(
      service(),
      seating(),
      space({ isActive: false }),
      policy(),
      FUTURE_NOW,
    );
    expect(r.eligible).toBe(false);
  });

  it("rejects missing space", () => {
    const r = evaluateEligibility(service(), seating(), null, policy(), FUTURE_NOW);
    expect(r.eligible).toBe(false);
  });

  it("rejects scheduled services (only 'open' is requestable)", () => {
    const r = evaluateEligibility(
      service({ status: "scheduled" }),
      seating(),
      space(),
      policy(),
      FUTURE_NOW,
    );
    expect(r.eligible).toBe(false);
  });

  it("rejects closed services", () => {
    const r = evaluateEligibility(
      service({ status: "closed" }),
      seating(),
      space(),
      policy(),
      FUTURE_NOW,
    );
    expect(r.eligible).toBe(false);
  });

  it("rejects inactive services", () => {
    const r = evaluateEligibility(
      service({ isActive: false }),
      seating(),
      space(),
      policy(),
      FUTURE_NOW,
    );
    expect(r.eligible).toBe(false);
  });

  it("rejects missing service", () => {
    const r = evaluateEligibility(null, seating(), space(), policy(), FUTURE_NOW);
    expect(r.eligible).toBe(false);
  });

  it("rejects inactive seating", () => {
    const r = evaluateEligibility(
      service(),
      seating({ isActive: false }),
      space(),
      policy(),
      FUTURE_NOW,
    );
    expect(r.eligible).toBe(false);
  });

  it("rejects seating belonging to a different service", () => {
    const r = evaluateEligibility(
      service(),
      seating({ sundayServiceId: "other" }),
      space(),
      policy(),
      FUTURE_NOW,
    );
    expect(r.eligible).toBe(false);
  });

  it("rejects missing seating", () => {
    const r = evaluateEligibility(service(), null, space(), policy(), FUTURE_NOW);
    expect(r.eligible).toBe(false);
  });

  it("rejects null space onlineBookingLimit", () => {
    const r = evaluateEligibility(
      service(),
      seating(),
      space({ onlineBookingLimit: null }),
      policy(),
      FUTURE_NOW,
    );
    expect(r.eligible).toBe(false);
  });

  it("rejects zero space onlineBookingLimit", () => {
    const r = evaluateEligibility(
      service(),
      seating(),
      space({ onlineBookingLimit: 0 }),
      policy(),
      FUTURE_NOW,
    );
    expect(r.eligible).toBe(false);
  });

  it("rejects null service onlineBookingLimit", () => {
    const r = evaluateEligibility(
      service({ onlineBookingLimit: null }),
      seating(),
      space(),
      policy(),
      FUTURE_NOW,
    );
    expect(r.eligible).toBe(false);
  });

  it("rejects null seating onlineBookingLimit", () => {
    const r = evaluateEligibility(
      service(),
      seating({ onlineBookingLimit: null }),
      space(),
      policy(),
      FUTURE_NOW,
    );
    expect(r.eligible).toBe(false);
  });

  it("rejects zero seating onlineBookingLimit", () => {
    const r = evaluateEligibility(
      service(),
      seating({ onlineBookingLimit: 0 }),
      space(),
      policy(),
      FUTURE_NOW,
    );
    expect(r.eligible).toBe(false);
  });

  it("rejects missing restaurant timezone", () => {
    const r = evaluateEligibility(
      service(),
      seating(),
      space(),
      policy({ restaurantTimezone: null }),
      FUTURE_NOW,
    );
    expect(r.eligible).toBe(false);
  });

  it("rejects invalid restaurant timezone", () => {
    const r = evaluateEligibility(
      service(),
      seating(),
      space(),
      policy({ restaurantTimezone: "Not/A/Zone" }),
      FUTURE_NOW,
    );
    expect(r.eligible).toBe(false);
  });

  it("rejects past seating starts", () => {
    const r = evaluateEligibility(
      service({ date: "2001-01-07" }),
      seating(),
      space(),
      policy(),
      FUTURE_NOW,
    );
    expect(r.eligible).toBe(false);
  });

  it("rejects a service whose spaceId does not match the space", () => {
    const r = evaluateEligibility(
      service({ spaceId: "other-space" }),
      seating(),
      space(),
      policy(),
      FUTURE_NOW,
    );
    expect(r.eligible).toBe(false);
  });
});

describe("validatePartyComposition", () => {
  it("accepts matching counts", () => {
    const err = validatePartyComposition({
      partySize: 3,
      adults: 2,
      seniors: 0,
      children: 1,
      guests: [
        { guestIndex: 0, category: "adult" },
        { guestIndex: 1, category: "adult" },
        { guestIndex: 2, category: "child" },
      ],
    });
    expect(err).toBeNull();
  });

  it("rejects when counts do not sum to partySize", () => {
    const err = validatePartyComposition({
      partySize: 3,
      adults: 2,
      seniors: 0,
      children: 0,
      guests: [
        { guestIndex: 0, category: "adult" },
        { guestIndex: 1, category: "adult" },
      ],
    });
    expect(err).not.toBeNull();
  });

  it("rejects when guest count differs from partySize", () => {
    const err = validatePartyComposition({
      partySize: 2,
      adults: 2,
      seniors: 0,
      children: 0,
      guests: [{ guestIndex: 0, category: "adult" }],
    });
    expect(err).not.toBeNull();
  });

  it("rejects duplicate guest indices", () => {
    const err = validatePartyComposition({
      partySize: 2,
      adults: 2,
      seniors: 0,
      children: 0,
      guests: [
        { guestIndex: 0, category: "adult" },
        { guestIndex: 0, category: "adult" },
      ],
    });
    expect(err).not.toBeNull();
  });

  it("rejects out-of-range guest indices", () => {
    const err = validatePartyComposition({
      partySize: 2,
      adults: 2,
      seniors: 0,
      children: 0,
      guests: [
        { guestIndex: 0, category: "adult" },
        { guestIndex: 5, category: "adult" },
      ],
    });
    expect(err).not.toBeNull();
  });

  it("rejects when guest categories do not match declared counts", () => {
    // Declares two adults but supplies two child allocations.
    const err = validatePartyComposition({
      partySize: 2,
      adults: 2,
      seniors: 0,
      children: 0,
      guests: [
        { guestIndex: 0, category: "child" },
        { guestIndex: 1, category: "child" },
      ],
    });
    expect(err).not.toBeNull();
  });
});

describe("validatePartySizeAgainstCeiling", () => {
  it("accepts a party within the ceiling", () => {
    expect(validatePartySizeAgainstCeiling(40, 40)).toBeNull();
    expect(validatePartySizeAgainstCeiling(10, 40)).toBeNull();
  });
  it("rejects a party exceeding the ceiling", () => {
    expect(validatePartySizeAgainstCeiling(41, 40)).not.toBeNull();
  });
});

describe("buildEligibleOptions — availability and submission agree on ceiling", () => {
  it("surfaces the smallest configured limit as configuredRequestCeiling", () => {
    const opts = buildEligibleOptions(
      [service()],
      new Map([[SERVICE_ID, [seating()]]]),
      [space()],
      policy(),
      FUTURE_NOW,
    );
    expect(opts).toHaveLength(1);
    expect(opts[0]!.configuredRequestCeiling).toBe(40);
  });

  it("excludes ineligible options entirely", () => {
    const opts = buildEligibleOptions(
      [service({ status: "scheduled" })],
      new Map([[SERVICE_ID, [seating()]]]),
      [space()],
      policy(),
      FUTURE_NOW,
    );
    expect(opts).toHaveLength(0);
  });
});

describe("validateNewRequestEligibility — submission path", () => {
  it("accepts a valid request and returns the seating instant", () => {
    const r = validateNewRequestEligibility(
      { service: service(), seating: seating(), space: space(), policy: policy() },
      10,
      FUTURE_NOW,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.seatingInstant).toBeTruthy();
  });

  it("rejects a party exceeding the ceiling", () => {
    const r = validateNewRequestEligibility(
      { service: service(), seating: seating(), space: space(), policy: policy() },
      41,
      FUTURE_NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeTruthy();
  });

  it("rejects a private-room (request-only) space", () => {
    const r = validateNewRequestEligibility(
      {
        service: service(),
        seating: seating(),
        space: space({ spaceType: "request_only" }),
        policy: policy(),
      },
      10,
      FUTURE_NOW,
    );
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full submission path — exercises handleSubmitReservationRequest with mocked
// repository dependencies. Proves invalid requests never reach persistence.
// ---------------------------------------------------------------------------

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

import { handleSubmitReservationRequest } from "@/lib/server/reservation-submit.server";

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
            id: "ei-1",
            packageId: PKG_ID,
            menuItemId: MEAT_ID,
            menuItemName: "Fried Chicken",
            selectionCategory: "meat",
          },
          {
            id: "ei-2",
            packageId: PKG_ID,
            menuItemId: MEAT_B_ID,
            menuItemName: "Smoked Brisket",
            selectionCategory: "meat",
          },
          {
            id: "ei-3",
            packageId: PKG_ID,
            menuItemId: SIDE_ID,
            menuItemName: "Mac & Cheese",
            selectionCategory: "side",
          },
          {
            id: "ei-4",
            packageId: PKG_ID,
            menuItemId: SIDE_B_ID,
            menuItemName: "Collard Greens",
            selectionCategory: "side",
          },
          {
            id: "ei-5",
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

function setupSubmission(
  opts: {
    spaces?: VenueSpaceDTO[];
    services?: SundayServiceDTO[];
    seatings?: SeatingTimeDTO[];
    policy?: PaymentPolicyDTO;
    config?: OrderingConfigDTO;
  } = {},
) {
  sundaysMock.getSundayService.mockResolvedValue(opts.services?.[0] ?? service());
  sundaysMock.listSeatingTimesForService.mockResolvedValue(opts.seatings ?? [seating()]);
  sundaysMock.getPaymentPolicy.mockResolvedValue(opts.policy ?? policy());
  spacesMock.listAllSpaces.mockResolvedValue(opts.spaces ?? [space()]);
  orderingMock.getOrderingConfig.mockResolvedValue(opts.config ?? orderingConfig());
  reservationMock.submitRequest.mockResolvedValue({
    success: true,
    reservationId: "res-1",
    reservationNumber: "SDS-20991107-AAAA",
    status: "pending_review",
    paymentStatus: "unpaid",
  });
  reservationMock.findByIdempotencyKey.mockResolvedValue(null);
}

describe("handleSubmitReservationRequest — eligibility + party validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSubmission();
  });

  it("accepts a valid request and persists pending_review/unpaid", async () => {
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(true);
    expect(reservationMock.submitRequest).toHaveBeenCalledTimes(1);
    expect(r.status).toBe("pending_review");
    expect(r.paymentStatus).toBe("unpaid");
  });

  it("rejects private-room requests without persisting", async () => {
    const r = await handleSubmitReservationRequest(
      baseInput({ experienceType: "private_room" }) as never,
    );
    expect(r.success).toBe(false);
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("rejects a guest-category mismatch without persisting", async () => {
    const r = await handleSubmitReservationRequest(
      baseInput({
        adults: 2,
        seniors: 0,
        children: 0,
        guests: [
          { guestIndex: 0, category: "child", packageId: PKG_ID, included: [], addons: [] },
          { guestIndex: 1, category: "child", packageId: PKG_ID, included: [], addons: [] },
        ],
      }) as never,
    );
    expect(r.success).toBe(false);
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("rejects a request-only space without persisting", async () => {
    spacesMock.listAllSpaces.mockResolvedValue([space({ spaceType: "request_only" })]);
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(false);
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("rejects a scheduled service without persisting", async () => {
    sundaysMock.getSundayService.mockResolvedValue(service({ status: "scheduled" }));
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(false);
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("rejects a closed service without persisting", async () => {
    sundaysMock.getSundayService.mockResolvedValue(service({ status: "closed" }));
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(false);
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("rejects an inactive seating without persisting", async () => {
    sundaysMock.listSeatingTimesForService.mockResolvedValue([seating({ isActive: false })]);
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(false);
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("rejects a mismatched seating without persisting", async () => {
    sundaysMock.listSeatingTimesForService.mockResolvedValue([
      seating({ sundayServiceId: "other-service" }),
    ]);
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(false);
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("rejects null space limit without persisting", async () => {
    spacesMock.listAllSpaces.mockResolvedValue([space({ onlineBookingLimit: null })]);
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(false);
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("rejects null service limit without persisting", async () => {
    sundaysMock.getSundayService.mockResolvedValue(service({ onlineBookingLimit: null }));
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(false);
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("rejects null seating limit without persisting", async () => {
    sundaysMock.listSeatingTimesForService.mockResolvedValue([
      seating({ onlineBookingLimit: null }),
    ]);
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(false);
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("rejects a missing timezone without persisting", async () => {
    sundaysMock.getPaymentPolicy.mockResolvedValue(policy({ restaurantTimezone: null }));
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(false);
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("rejects a party exceeding the ceiling without persisting", async () => {
    // seating limit 40, party 41
    sundaysMock.listSeatingTimesForService.mockResolvedValue([seating({ onlineBookingLimit: 40 })]);
    const r = await handleSubmitReservationRequest(
      baseInput({ partySize: 41, adults: 41, guests: validGuests(41) }) as never,
    );
    expect(r.success).toBe(false);
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("rejects a past seating without persisting", async () => {
    sundaysMock.getSundayService.mockResolvedValue(service({ date: "2001-01-07" }));
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(false);
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("rejects a preview-to-submit subtotal drift with a review-required result", async () => {
    const r = await handleSubmitReservationRequest(
      baseInput({ clientPreviewSubtotalCents: 999999 }) as never,
    );
    expect(r.success).toBe(false);
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("replays an already-saved request via idempotency without re-persisting or re-pricing", async () => {
    reservationMock.findByIdempotencyKey.mockResolvedValue({
      success: true,
      reservationId: "res-existing",
      reservationNumber: "SDS-20991107-BBBB",
      status: "pending_review",
      paymentStatus: "unpaid",
      idempotentReplay: true,
    });
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(true);
    expect(r.idempotentReplay).toBe(true);
    // A replay must NOT re-persist or even re-fetch pricing config.
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
    expect(orderingMock.getOrderingConfig).not.toHaveBeenCalled();
  });

  it("a changed payload under the same key is not replayed as the old reservation", async () => {
    // The repository returns a mismatch indicator for a same-key/different-payload.
    reservationMock.findByIdempotencyKey.mockResolvedValue({
      success: false,
      error: "This request key was used for a different reservation. Please start a new request.",
    });
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(false);
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });
});
