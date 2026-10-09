/**
 * Mocked-Supabase-client tests for the REAL SupabaseReservationRepository
 * idempotency lookup. These exercise the actual repository method
 * (findByIdempotencyKey) — NOT a mock of that method — against a mocked
 * Supabase client, verifying column selection, result mapping, and safe
 * failure handling.
 *
 * These are MOCKED-CLIENT tests, NOT live PostgreSQL execution. They verify
 * the repository's query construction and result mapping; they do NOT verify
 * real concurrent database behavior, the unique(idempotency_key) constraint,
 * or the atomic RPC's transaction semantics.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupabaseReservationRepository } from "@/lib/server/reservation-supabase.server";

// Minimal mocked Supabase client: only the chain methods the repository uses.
function makeClient(
  opts: {
    data?: unknown;
    error?: unknown;
  } = {},
) {
  const selectMock = vi.fn(() => chain);
  const eqMock = vi.fn(() => chain);
  const maybeSingleMock = vi.fn(async () => ({
    data: opts.data ?? null,
    error: opts.error ?? null,
  }));
  const chain = {
    select: selectMock,
    eq: eqMock,
    maybeSingle: maybeSingleMock,
  };
  const fromMock = vi.fn(() => chain);
  const rpcMock = vi.fn(async () => ({ data: null, error: null }));
  return {
    client: { from: fromMock, rpc: rpcMock } as never,
    fromMock,
    selectMock,
    eqMock,
    maybeSingleMock,
  };
}

describe("SupabaseReservationRepository.findByIdempotencyKey (real method, mocked client)", () => {
  let repo: SupabaseReservationRepository;
  let harness: ReturnType<typeof makeClient>;

  beforeEach(() => {
    harness = makeClient();
    repo = new SupabaseReservationRepository(harness.client);
  });

  it("selects only minimal columns and filters by idempotency_key", async () => {
    harness = makeClient({ data: null });
    repo = new SupabaseReservationRepository(harness.client);
    await repo.findByIdempotencyKey("key-1", "hash-1");
    expect(harness.fromMock).toHaveBeenCalledWith("reservations");
    // Only minimal submission-result columns — no contact details, notes,
    // or order contents.
    expect(harness.selectMock).toHaveBeenCalledWith(
      "id,reservation_number,status,payment_status,payload_hash",
    );
    expect(harness.eqMock).toHaveBeenCalledWith("idempotency_key", "key-1");
    expect(harness.maybeSingleMock).toHaveBeenCalled();
  });

  it("returns the original reservation identity for a matching record", async () => {
    harness = makeClient({
      data: {
        id: "res-123",
        reservation_number: "SDS-20991107-AAAA",
        status: "pending_review",
        payment_status: "unpaid",
        payload_hash: "hash-1",
      },
    });
    repo = new SupabaseReservationRepository(harness.client);
    const r = await repo.findByIdempotencyKey("key-1", "hash-1");
    expect(r).toEqual({
      success: true,
      reservationId: "res-123",
      reservationNumber: "SDS-20991107-AAAA",
      status: "pending_review",
      paymentStatus: "unpaid",
      idempotentReplay: true,
    });
  });

  it("returns a safe mismatch result for a different payload hash", async () => {
    harness = makeClient({
      data: {
        id: "res-123",
        reservation_number: "SDS-20991107-AAAA",
        status: "pending_review",
        payment_status: "unpaid",
        payload_hash: "different-hash",
      },
    });
    repo = new SupabaseReservationRepository(harness.client);
    const r = await repo.findByIdempotencyKey("key-1", "hash-1");
    expect(r).toEqual({
      success: false,
      error: "This request key was used for a different reservation.",
    });
  });

  it("returns null when no record exists (proceed to new-request validation)", async () => {
    harness = makeClient({ data: null });
    repo = new SupabaseReservationRepository(harness.client);
    const r = await repo.findByIdempotencyKey("key-1", "hash-1");
    expect(r).toBeNull();
  });

  it("throws on database failure so submission stops safely (not treated as not-found)", async () => {
    harness = makeClient({ error: { message: "connection lost" } });
    repo = new SupabaseReservationRepository(harness.client);
    await expect(repo.findByIdempotencyKey("key-1", "hash-1")).rejects.toThrow();
  });
});

/**
 * Submission-action tests: verify the production submission handler
 * (handleSubmitReservationRequest) correctly interprets every lookup result
 * and never writes on replay, mismatch, or lookup failure. The repository is
 * mocked at the getReservationRepository boundary; findByIdempotencyKey is
 * mocked here because the submission handler delegates to it — these tests
 * verify the HANDLER's interpretation, complementing the repository tests above.
 */
const SERVICE_ID = "11111111-1111-1111-1111-111111111111";
const SEATING_ID = "22222222-2222-2222-2222-222222222222";
const PKG_ID = "33333333-3333-3333-3333-333333333333";
const MEAT_ID = "77777777-7777-7777-7777-777777777777";
const MEAT_B_ID = "77777777-7777-7777-7777-777777777778";
const SIDE_ID = "88888888-8888-8888-8888-888888888888";
const SIDE_B_ID = "88888888-8888-8888-8888-888888888889";

const sundaysMock = {
  listAllSundayServices: vi.fn(),
  getSundayService: vi.fn(),
  listSeatingTimesForService: vi.fn(),
  getPaymentPolicy: vi.fn(),
};
const spacesMock = { listAllSpaces: vi.fn() };
const orderingMock = { getOrderingConfig: vi.fn() };
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
vi.mock("@/lib/server/space-repository.server", () => ({
  getSpaceRepository: () => spacesMock,
}));
vi.mock("@/lib/server/ordering-repository.server", () => ({
  getOrderingRepository: () => orderingMock,
}));
vi.mock("@/lib/server/reservation-repository.server", () => ({
  getReservationRepository: () => reservationMock,
}));

import { handleSubmitReservationRequest } from "@/lib/server/reservation-submit.server";

function baseInput() {
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
    guests: [
      {
        guestIndex: 0,
        category: "adult" as const,
        packageId: PKG_ID,
        included: [
          { menuItemId: MEAT_ID, selectionCategory: "meat" as const },
          { menuItemId: MEAT_B_ID, selectionCategory: "meat" as const },
          { menuItemId: SIDE_ID, selectionCategory: "side" as const },
          { menuItemId: SIDE_B_ID, selectionCategory: "side" as const },
        ],
        addons: [] as Array<{ addonId: string; quantity: number }>,
      },
      {
        guestIndex: 1,
        category: "adult" as const,
        packageId: PKG_ID,
        included: [
          { menuItemId: MEAT_ID, selectionCategory: "meat" as const },
          { menuItemId: MEAT_B_ID, selectionCategory: "meat" as const },
          { menuItemId: SIDE_ID, selectionCategory: "side" as const },
          { menuItemId: SIDE_B_ID, selectionCategory: "side" as const },
        ],
        addons: [] as Array<{ addonId: string; quantity: number }>,
      },
    ],
    platters: [] as Array<{ platterId: string; quantity: number }>,
    idempotencyKey: "key-1",
  };
}

function setupValid() {
  sundaysMock.getSundayService.mockResolvedValue({
    id: SERVICE_ID,
    date: "2099-11-07",
    label: "Thanksgiving Sunday",
    status: "open",
    spaceId: "space-1",
    onlineBookingLimit: 100,
    isActive: true,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
  });
  sundaysMock.listSeatingTimesForService.mockResolvedValue([
    {
      id: SEATING_ID,
      sundayServiceId: SERVICE_ID,
      label: "Noon",
      startTime: "12:00",
      endTime: "14:30",
      onlineBookingLimit: 100,
      isActive: true,
      displayOrder: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: null,
      updatedBy: null,
    },
  ]);
  sundaysMock.getPaymentPolicy.mockResolvedValue({
    id: 1,
    depositPercent: 50,
    defaultBalanceDeadlineHours: 72,
    restaurantTimezone: "America/Chicago",
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
  orderingMock.getOrderingConfig.mockResolvedValue({
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
        ],
      },
    ],
    addons: [],
    platters: [],
    guestPricingRules: null,
  });
  reservationMock.submitRequest.mockResolvedValue({
    success: true,
    reservationId: "res-1",
    reservationNumber: "SDS-20991107-AAAA",
    status: "pending_review",
    paymentStatus: "unpaid",
  });
  reservationMock.findByIdempotencyKey.mockResolvedValue(null);
}

describe("handleSubmitReservationRequest — idempotency lookup interpretation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupValid();
  });

  it("matching replay bypasses pricing/eligibility and does not write", async () => {
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
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
    expect(orderingMock.getOrderingConfig).not.toHaveBeenCalled();
  });

  it("mismatch does not write", async () => {
    reservationMock.findByIdempotencyKey.mockResolvedValue({
      success: false,
      error: "This request key was used for a different reservation.",
    });
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(false);
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
  });

  it("lookup failure does not write (safe failure, not treated as not-found)", async () => {
    reservationMock.findByIdempotencyKey.mockRejectedValue(new Error("db down"));
    const r = await handleSubmitReservationRequest(baseInput() as never);
    expect(r.success).toBe(false);
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
    expect(orderingMock.getOrderingConfig).not.toHaveBeenCalled();
  });
});
