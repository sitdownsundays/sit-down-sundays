/**
 * Reservation availability builder + mock detail — behavioral tests.
 *
 * Exercises the real buildPublicAvailability() and MockReservationRepository
 * with mocked repository dependencies (no real database). Proves the
 * filtering rules and that saved mock detail reflects the selected service,
 * seating, and space — not hardcoded values.
 *
 * These are MOCKED-CLIENT tests, NOT real PostgreSQL execution.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SundayServiceDTO, SeatingTimeDTO, PaymentPolicyDTO } from "@/lib/sundays/types";
import type { VenueSpaceDTO } from "@/lib/spaces/types";

// --- Mock repository dependencies -------------------------------------------
const sundaysMock = {
  listAllSundayServices: vi.fn<() => Promise<SundayServiceDTO[]>>(),
  getSundayService: vi.fn<(id: string) => Promise<SundayServiceDTO | null>>(),
  listSeatingTimesForService: vi.fn<(id: string) => Promise<SeatingTimeDTO[]>>(),
  getPaymentPolicy: vi.fn<() => Promise<PaymentPolicyDTO>>(),
};
const spacesMock = {
  listAllSpaces: vi.fn<() => Promise<VenueSpaceDTO[]>>(),
};

vi.mock("@/lib/server/sundays-repository.server", () => ({
  getSundaysRepository: () => sundaysMock,
}));
vi.mock("@/lib/server/space-repository.server", () => ({
  getSpaceRepository: () => spacesMock,
}));

// Import AFTER mocks are registered.
import { buildPublicAvailability } from "@/lib/server/reservation-availability.server";
import { MockReservationRepository } from "@/lib/server/reservation-mock.server";
import type { SubmitReservationRepoInput } from "@/lib/server/reservation-repository-interface.server";

const SPACE_ID = "space-ballroom";
const SERVICE_ID = "svc-1";
const SEATING_ID = "seat-1";

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
    date: "2099-11-01",
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

function setup(opts: {
  spaces?: VenueSpaceDTO[];
  services?: SundayServiceDTO[];
  seatings?: SeatingTimeDTO[];
  policy?: PaymentPolicyDTO;
}) {
  sundaysMock.listAllSundayServices.mockResolvedValue(opts.services ?? []);
  sundaysMock.getSundayService.mockResolvedValue(opts.services?.[0] ?? null);
  sundaysMock.listSeatingTimesForService.mockResolvedValue(opts.seatings ?? []);
  sundaysMock.getPaymentPolicy.mockResolvedValue(opts.policy ?? policy());
  spacesMock.listAllSpaces.mockResolvedValue(opts.spaces ?? [space()]);
}

describe("buildPublicAvailability — eligibility filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an eligible general-dining option with configured ceiling", async () => {
    setup({
      spaces: [space()],
      services: [service()],
      seatings: [seating()],
    });
    const options = await buildPublicAvailability();
    expect(options).toHaveLength(1);
    expect(options[0]!.spaceName).toBe("Grand Ballroom");
    expect(options[0]!.sundayService.id).toBe(SERVICE_ID);
    expect(options[0]!.seatingTime.id).toBe(SEATING_ID);
    expect(options[0]!.configuredRequestCeiling).toBe(40);
  });

  it("excludes request-only spaces", async () => {
    setup({
      spaces: [space({ name: "Mayoral Room 1", spaceType: "request_only" })],
      services: [service()],
      seatings: [seating()],
    });
    const options = await buildPublicAvailability();
    expect(options).toHaveLength(0);
  });

  it("excludes not-bookable spaces", async () => {
    setup({
      spaces: [space({ name: "Suite", spaceType: "not_bookable" })],
      services: [service()],
      seatings: [seating()],
    });
    const options = await buildPublicAvailability();
    expect(options).toHaveLength(0);
  });

  it("excludes inactive spaces", async () => {
    setup({
      spaces: [space({ isActive: false })],
      services: [service()],
      seatings: [seating()],
    });
    const options = await buildPublicAvailability();
    expect(options).toHaveLength(0);
  });

  it("excludes scheduled services (only 'open' is requestable)", async () => {
    setup({
      spaces: [space()],
      services: [service({ status: "scheduled" })],
      seatings: [seating()],
    });
    const options = await buildPublicAvailability();
    expect(options).toHaveLength(0);
  });

  it("excludes closed services", async () => {
    setup({
      spaces: [space()],
      services: [service({ status: "closed" })],
      seatings: [seating()],
    });
    const options = await buildPublicAvailability();
    expect(options).toHaveLength(0);
  });

  it("excludes inactive services", async () => {
    setup({
      spaces: [space()],
      services: [service({ isActive: false })],
      seatings: [seating()],
    });
    const options = await buildPublicAvailability();
    expect(options).toHaveLength(0);
  });

  it("excludes inactive seating times", async () => {
    setup({
      spaces: [space()],
      services: [service()],
      seatings: [seating({ isActive: false })],
    });
    const options = await buildPublicAvailability();
    expect(options).toHaveLength(0);
  });

  it("excludes when space onlineBookingLimit is null", async () => {
    setup({
      spaces: [space({ onlineBookingLimit: null })],
      services: [service()],
      seatings: [seating()],
    });
    const options = await buildPublicAvailability();
    expect(options).toHaveLength(0);
  });

  it("excludes when space onlineBookingLimit is zero", async () => {
    setup({
      spaces: [space({ onlineBookingLimit: 0 })],
      services: [service()],
      seatings: [seating()],
    });
    const options = await buildPublicAvailability();
    expect(options).toHaveLength(0);
  });

  it("excludes when service onlineBookingLimit is null", async () => {
    setup({
      spaces: [space()],
      services: [service({ onlineBookingLimit: null })],
      seatings: [seating()],
    });
    const options = await buildPublicAvailability();
    expect(options).toHaveLength(0);
  });

  it("excludes when seating onlineBookingLimit is null", async () => {
    setup({
      spaces: [space()],
      services: [service()],
      seatings: [seating({ onlineBookingLimit: null })],
    });
    const options = await buildPublicAvailability();
    expect(options).toHaveLength(0);
  });

  it("excludes when seating onlineBookingLimit is zero", async () => {
    setup({
      spaces: [space()],
      services: [service()],
      seatings: [seating({ onlineBookingLimit: 0 })],
    });
    const options = await buildPublicAvailability();
    expect(options).toHaveLength(0);
  });

  it("excludes when restaurant timezone is missing", async () => {
    setup({
      spaces: [space()],
      services: [service()],
      seatings: [seating()],
      policy: policy({ restaurantTimezone: null }),
    });
    const options = await buildPublicAvailability();
    expect(options).toHaveLength(0);
  });

  it("excludes when restaurant timezone is invalid", async () => {
    setup({
      spaces: [space()],
      services: [service()],
      seatings: [seating()],
      policy: policy({ restaurantTimezone: "Not/A/Zone" }),
    });
    const options = await buildPublicAvailability();
    expect(options).toHaveLength(0);
  });

  it("excludes past seating starts using the restaurant timezone", async () => {
    setup({
      spaces: [space()],
      services: [service({ date: "2001-01-07" })],
      seatings: [seating()],
    });
    const options = await buildPublicAvailability();
    expect(options).toHaveLength(0);
  });

  it("excludes seating not belonging to the selected service", async () => {
    setup({
      spaces: [space()],
      services: [service()],
      seatings: [seating({ sundayServiceId: "other-service" })],
    });
    // The builder fetches seatings for the service id, so a mismatched
    // sundayServiceId on the returned row still gets filtered out by the
    // service-scoped fetch. Confirm no option is produced.
    const options = await buildPublicAvailability();
    expect(options).toHaveLength(0);
  });
});

describe("MockReservationRepository — detail reflects selected service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saved detail uses the selected service date, seating times, and space label", async () => {
    const svc = service({ date: "2099-11-01", label: "Thanksgiving Sunday" });
    const seat = seating({ startTime: "13:00", endTime: "15:30" });
    setup({
      spaces: [space({ name: "Grand Ballroom" })],
      services: [svc],
      seatings: [seat],
    });

    const repo = new MockReservationRepository();
    const input: SubmitReservationRepoInput = {
      reservationNumber: "SDS-2099-0001",
      contactFirstName: "Jane",
      contactLastName: "Doe",
      contactEmail: "jane@example.com",
      contactPhone: "+13125550000",
      sundayServiceId: SERVICE_ID,
      seatingTimeId: SEATING_ID,
      experienceType: "standard",
      privateRoomId: null,
      partySize: 2,
      adults: 2,
      seniors: 0,
      children: 0,
      guestNotes: "",
      dietaryNotes: "",
      accessibilityRequests: "",
      occasion: "",
      pricing: {
        success: true,
        lines: [],
        subtotalCents: 5900,
        depositRequiredCents: 2950,
        grandTotalCents: 5900,
        remainingBalanceCents: 5900,
        balanceDeadline: "2099-10-29T13:00:00-05:00",
        hasUnresolvedRules: false,
        unresolvedNotes: [],
        pricingSnapshot: {},
        policySnapshot: {},
      },
      guests: [],
      platters: [],
      idempotencyKey: "key-1",
      payloadHash: "hash-1",
      actorUserId: null,
      snapshots: { guests: [], platters: [] },
    };

    const result = await repo.submitRequest(input);
    expect(result.success).toBe(true);
    expect(result.reservationId).toBeDefined();

    const detail = await repo.getReservation(result.reservationId!);
    expect(detail.success).toBe(true);
    expect(detail.reservation!.serviceDate).toBe("2099-11-01");
    expect(detail.reservation!.seatingStartTime).toBe("13:00");
    expect(detail.reservation!.seatingEndTime).toBe("15:30");
    // spaceName must come from the venue space, NOT the service label.
    expect(detail.reservation!.spaceName).toBe("Grand Ballroom");
    expect(detail.reservation!.status).toBe("pending_review");
    expect(detail.reservation!.paymentStatus).toBe("unpaid");
  });

  it("idempotent replay with same key + hash returns the original reservation", async () => {
    setup({
      spaces: [space()],
      services: [service()],
      seatings: [seating()],
    });
    const repo = new MockReservationRepository();
    const input: SubmitReservationRepoInput = {
      reservationNumber: "SDS-2099-0002",
      contactFirstName: "Jane",
      contactLastName: "Doe",
      contactEmail: "jane@example.com",
      contactPhone: "+13125550000",
      sundayServiceId: SERVICE_ID,
      seatingTimeId: SEATING_ID,
      experienceType: "standard",
      privateRoomId: null,
      partySize: 1,
      adults: 1,
      seniors: 0,
      children: 0,
      guestNotes: "",
      dietaryNotes: "",
      accessibilityRequests: "",
      occasion: "",
      pricing: {
        success: true,
        lines: [],
        subtotalCents: 2950,
        depositRequiredCents: 1475,
        grandTotalCents: 2950,
        remainingBalanceCents: 2950,
        balanceDeadline: null,
        hasUnresolvedRules: false,
        unresolvedNotes: [],
        pricingSnapshot: {},
        policySnapshot: {},
      },
      guests: [],
      platters: [],
      idempotencyKey: "key-replay",
      payloadHash: "hash-replay",
      actorUserId: null,
      snapshots: { guests: [], platters: [] },
    };

    const first = await repo.submitRequest(input);
    const second = await repo.submitRequest(input);
    expect(second.success).toBe(true);
    expect(second.idempotentReplay).toBe(true);
    expect(second.reservationId).toBe(first.reservationId);
    expect(second.reservationNumber).toBe(first.reservationNumber);
  });

  it("same key with a different payload hash is rejected", async () => {
    setup({
      spaces: [space()],
      services: [service()],
      seatings: [seating()],
    });
    const repo = new MockReservationRepository();
    const base: SubmitReservationRepoInput = {
      reservationNumber: "SDS-2099-0003",
      contactFirstName: "Jane",
      contactLastName: "Doe",
      contactEmail: "jane@example.com",
      contactPhone: "+13125550000",
      sundayServiceId: SERVICE_ID,
      seatingTimeId: SEATING_ID,
      experienceType: "standard",
      privateRoomId: null,
      partySize: 1,
      adults: 1,
      seniors: 0,
      children: 0,
      guestNotes: "",
      dietaryNotes: "",
      accessibilityRequests: "",
      occasion: "",
      pricing: {
        success: true,
        lines: [],
        subtotalCents: 2950,
        depositRequiredCents: 1475,
        grandTotalCents: 2950,
        remainingBalanceCents: 2950,
        balanceDeadline: null,
        hasUnresolvedRules: false,
        unresolvedNotes: [],
        pricingSnapshot: {},
        policySnapshot: {},
      },
      guests: [],
      platters: [],
      idempotencyKey: "key-mismatch",
      payloadHash: "hash-a",
      actorUserId: null,
      snapshots: { guests: [], platters: [] },
    };
    await repo.submitRequest(base);
    const second = await repo.submitRequest({ ...base, payloadHash: "hash-b" });
    expect(second.success).toBe(false);
    expect(second.error).toBeDefined();
  });
});
