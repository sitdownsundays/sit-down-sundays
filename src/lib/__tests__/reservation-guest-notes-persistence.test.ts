/**
 * Focused tests for per-guest note persistence and retrieval wiring.
 *
 * Exercises the REAL production code paths:
 *  - MockReservationRepository.submitRequest + getReservation (round-trip).
 *  - SupabaseReservationRepository.submitRequest RPC payload (mocked client).
 *  - SupabaseReservationRepository.getReservation detail mapping (mocked client).
 *  - buildPayloadHash idempotency normalization for guest notes.
 *
 * These are MOCKED-CLIENT / MOCKED-REPOSITORY tests, NOT live PostgreSQL
 * execution. They verify the repository's payload construction, column
 * selection, and result mapping; they do NOT verify real database writes
 * or the atomic RPC's transaction semantics.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupabaseReservationRepository } from "@/lib/server/reservation-supabase.server";
import { buildPayloadHash } from "@/lib/server/reservation-submit.server";
import type { SubmitReservationRepoInput } from "@/lib/server/reservation-repository-interface.server";
import type { ReservationGuestInput } from "@/lib/reservation/types";
import type { SundayServiceDTO, SeatingTimeDTO } from "@/lib/sundays/types";
import type { VenueSpaceDTO } from "@/lib/spaces/types";

// Import MockReservationRepository and its store reset. The reset clears the
// in-memory store between tests so no test replays another test's saved
// reservation via the shared idempotency key.
const { MockReservationRepository, resetMockReservationStore } =
  await import("@/lib/server/reservation-mock.server");

// ---------------------------------------------------------------------------
// Mock the Sundays and Spaces repositories so MockReservationRepository
// resolves a controlled, valid service+seating+space. This exercises the
// real MockReservationRepository.submitRequest/getReservation production
// code with mocked dependencies — NOT a copied repository.
// ---------------------------------------------------------------------------

const MOCK_SPACE: VenueSpaceDTO = {
  id: "v1000000-0000-0000-0000-000000000001",
  name: "Grand Ballroom",
  slug: "grand-ballroom",
  description: "The main general dining hall.",
  spaceType: "general_dining",
  reportedCapacity: 950,
  onlineBookingLimit: 100,
  isActive: true,
  displayOrder: 1,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  createdBy: null,
  updatedBy: null,
};

const MOCK_SERVICE: SundayServiceDTO = {
  id: "svc-mock-001",
  date: "2026-11-01",
  label: "First Sunday in November",
  status: "open",
  spaceId: MOCK_SPACE.id,
  onlineBookingLimit: 50,
  isActive: true,
  displayOrder: 1,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  createdBy: null,
  updatedBy: null,
};

const MOCK_SEATING: SeatingTimeDTO = {
  id: "seat-mock-001",
  sundayServiceId: MOCK_SERVICE.id,
  label: "Lunch",
  startTime: "12:00",
  endTime: "14:30",
  onlineBookingLimit: 50,
  isActive: true,
  displayOrder: 1,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  createdBy: null,
  updatedBy: null,
};

vi.mock("@/lib/server/sundays-repository.server", () => ({
  getSundaysRepository: () => ({
    getSundayService: vi.fn(async (id: string) => (id === MOCK_SERVICE.id ? MOCK_SERVICE : null)),
    listSeatingTimesForService: vi.fn(async (id: string) =>
      id === MOCK_SERVICE.id ? [MOCK_SEATING] : [],
    ),
    getPaymentPolicy: vi.fn(async () => ({
      depositPercent: 50,
      defaultBalanceDeadlineHours: 72,
      restaurantTimezone: "America/Chicago",
      updatedAt: "2026-10-01T00:00:00Z",
    })),
  }),
}));

vi.mock("@/lib/server/space-repository.server", () => ({
  getSpaceRepository: () => ({
    listAllSpaces: vi.fn(async () => [MOCK_SPACE]),
  }),
}));

// MockReservationRepository is imported with resetMockReservationStore above
// (after the vi.mock calls so it picks up the mocked repos).

// ---------------------------------------------------------------------------
// Helpers — build a minimal valid SubmitReservationRepoInput.
// ---------------------------------------------------------------------------

function makeGuest(overrides: Partial<ReservationGuestInput> = {}): ReservationGuestInput {
  return {
    guestIndex: 0,
    category: "adult",
    name: "Guest 1",
    packageId: "pkg-1",
    included: [{ menuItemId: "m1", selectionCategory: "meat" }],
    addons: [],
    foodAllergies: "",
    dietaryPreferences: "",
    mealRequests: "",
    ...overrides,
  };
}

function makeRepoInput(
  guests: ReservationGuestInput[],
  overrides: Partial<SubmitReservationRepoInput> = {},
): SubmitReservationRepoInput {
  return {
    reservationNumber: "SDS-20261009-ABCD",
    contactFirstName: "Jane",
    contactLastName: "Doe",
    contactEmail: "jane@example.com",
    contactPhone: "555-0100",
    sundayServiceId: MOCK_SERVICE.id,
    seatingTimeId: MOCK_SEATING.id,
    experienceType: "standard",
    privateRoomId: null,
    partySize: guests.length,
    adults: guests.length,
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
    guests,
    platters: [],
    idempotencyKey: "test-key-12345",
    payloadHash: "hash-1",
    actorUserId: null,
    snapshots: {
      guests: guests.map((g) => ({
        guestIndex: g.guestIndex,
        category: g.category,
        name: g.name ?? "",
        packageId: g.packageId,
        packageName: "Basic Meal",
        packagePrice: 2950,
        included: g.included.map((s) => ({
          menuItemId: s.menuItemId,
          name: "Dish",
          category: s.selectionCategory,
        })),
        addons: [],
      })),
      platters: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock repository round-trip
// ---------------------------------------------------------------------------

describe("MockReservationRepository — per-guest notes round-trip", () => {
  let repo: MockReservationRepository;

  beforeEach(() => {
    resetMockReservationStore();
    repo = new MockReservationRepository();
  });

  it("two guests retain different notes through save/read", async () => {
    const guests = [
      makeGuest({
        guestIndex: 0,
        foodAllergies: "peanuts",
        dietaryPreferences: "vegetarian",
        mealRequests: "no salt",
      }),
      makeGuest({
        guestIndex: 1,
        foodAllergies: "shellfish",
        dietaryPreferences: "gluten-free",
        mealRequests: "extra gravy",
      }),
    ];
    const input = makeRepoInput(guests, { partySize: 2, adults: 2 });
    const submitResult = await repo.submitRequest(input);
    expect(submitResult.success).toBe(true);
    expect(submitResult.reservationId).toBeTruthy();

    const detail = await repo.getReservation(submitResult.reservationId!);
    expect(detail.success).toBe(true);
    expect(detail.reservation?.guests).toHaveLength(2);
    expect(detail.reservation?.guests[0]?.foodAllergies).toBe("peanuts");
    expect(detail.reservation?.guests[0]?.dietaryPreferences).toBe("vegetarian");
    expect(detail.reservation?.guests[0]?.mealRequests).toBe("no salt");
    expect(detail.reservation?.guests[1]?.foodAllergies).toBe("shellfish");
    expect(detail.reservation?.guests[1]?.dietaryPreferences).toBe("gluten-free");
    expect(detail.reservation?.guests[1]?.mealRequests).toBe("extra gravy");
  });

  it("missing notes return empty strings", async () => {
    const guests = [makeGuest({ guestIndex: 0 })];
    // Explicitly remove note fields to simulate an older caller.
    const guestNoNotes = { ...guests[0]! };
    delete (guestNoNotes as Partial<ReservationGuestInput>).foodAllergies;
    delete (guestNoNotes as Partial<ReservationGuestInput>).dietaryPreferences;
    delete (guestNoNotes as Partial<ReservationGuestInput>).mealRequests;
    const input = makeRepoInput([guestNoNotes as ReservationGuestInput]);
    const submitResult = await repo.submitRequest(input);
    expect(submitResult.success).toBe(true);

    const detail = await repo.getReservation(submitResult.reservationId!);
    expect(detail.success).toBe(true);
    expect(detail.reservation?.guests[0]?.foodAllergies).toBe("");
    expect(detail.reservation?.guests[0]?.dietaryPreferences).toBe("");
    expect(detail.reservation?.guests[0]?.mealRequests).toBe("");
  });

  it("matches guests by guestIndex when input ordering differs from snapshot ordering", async () => {
    // The snapshot guests array is ordered [0, 1] but the raw input guests
    // are passed in REVERSED order [1, 0]. The repository must match by
    // guestIndex, not by array position, so each guest retains their OWN
    // notes — not the notes of whichever guest happens to sit at that
    // array offset.
    const guests = [
      makeGuest({
        guestIndex: 0,
        name: "Guest 1",
        foodAllergies: "peanuts",
        dietaryPreferences: "",
        mealRequests: "",
      }),
      makeGuest({
        guestIndex: 1,
        name: "Guest 2",
        foodAllergies: "shellfish",
        dietaryPreferences: "vegan",
        mealRequests: "extra napkins",
      }),
    ];
    const input = makeRepoInput(guests, { partySize: 2, adults: 2 });
    // Simulate the raw input arriving in reversed order.
    input.guests = [...guests].reverse();

    const submitResult = await repo.submitRequest(input);
    expect(submitResult.success).toBe(true);

    const detail = await repo.getReservation(submitResult.reservationId!);
    expect(detail.success).toBe(true);
    // Guest 0 has peanuts; Guest 1 has shellfish — regardless of input order.
    const g0 = detail.reservation?.guests.find((g) => g.guestIndex === 0);
    const g1 = detail.reservation?.guests.find((g) => g.guestIndex === 1);
    expect(g0?.foodAllergies).toBe("peanuts");
    expect(g1?.foodAllergies).toBe("shellfish");
    expect(g1?.mealRequests).toBe("extra napkins");
  });
});

// ---------------------------------------------------------------------------
// Supabase repository — RPC payload contains camelCase note keys
// ---------------------------------------------------------------------------

function makeSupabaseClient(
  rpcData: unknown = {
    ok: true,
    reservation_id: "res-1",
    reservation_number: "SDS-20261009-ABCD",
  },
) {
  const rpcMock = vi.fn(async () => ({ data: rpcData, error: null }));
  return {
    client: { from: vi.fn(() => ({})), rpc: rpcMock } as never,
    rpcMock,
  };
}

describe("SupabaseReservationRepository.submitRequest — RPC guest note keys", () => {
  it("includes camelCase foodAllergies/dietaryPreferences/mealRequests in p_guests", async () => {
    const harness = makeSupabaseClient();
    const repo = new SupabaseReservationRepository(harness.client);
    const guests = [
      makeGuest({
        guestIndex: 0,
        foodAllergies: "peanuts",
        dietaryPreferences: "vegetarian",
        mealRequests: "no salt",
      }),
    ];
    const input = makeRepoInput(guests);
    await repo.submitRequest(input);

    expect(harness.rpcMock).toHaveBeenCalledTimes(1);
    const callArgs = harness.rpcMock.mock.calls[0]!;
    const rpcArgs = callArgs[1] as Record<string, unknown>;
    const pGuests = rpcArgs["p_guests"] as Array<Record<string, unknown>>;
    expect(pGuests).toHaveLength(1);
    expect(pGuests[0]?.["foodAllergies"]).toBe("peanuts");
    expect(pGuests[0]?.["dietaryPreferences"]).toBe("vegetarian");
    expect(pGuests[0]?.["mealRequests"]).toBe("no salt");
  });

  it("defaults missing notes to empty strings in the RPC payload", async () => {
    const harness = makeSupabaseClient();
    const repo = new SupabaseReservationRepository(harness.client);
    const guestNoNotes = { ...makeGuest({ guestIndex: 0 }) };
    delete (guestNoNotes as Partial<ReservationGuestInput>).foodAllergies;
    delete (guestNoNotes as Partial<ReservationGuestInput>).dietaryPreferences;
    delete (guestNoNotes as Partial<ReservationGuestInput>).mealRequests;
    const input = makeRepoInput([guestNoNotes as ReservationGuestInput]);
    await repo.submitRequest(input);

    const callArgs = harness.rpcMock.mock.calls[0]!;
    const rpcArgs = callArgs[1] as Record<string, unknown>;
    const pGuests = rpcArgs["p_guests"] as Array<Record<string, unknown>>;
    expect(pGuests[0]?.["foodAllergies"]).toBe("");
    expect(pGuests[0]?.["dietaryPreferences"]).toBe("");
    expect(pGuests[0]?.["mealRequests"]).toBe("");
  });

  it("matches notes by guestIndex when input is reordered", async () => {
    const harness = makeSupabaseClient();
    const repo = new SupabaseReservationRepository(harness.client);
    const guests = [
      makeGuest({
        guestIndex: 0,
        foodAllergies: "peanuts",
        dietaryPreferences: "",
        mealRequests: "",
      }),
      makeGuest({
        guestIndex: 1,
        foodAllergies: "shellfish",
        dietaryPreferences: "vegan",
        mealRequests: "extra napkins",
      }),
    ];
    const input = makeRepoInput(guests, { partySize: 2, adults: 2 });
    // Reverse the raw input order.
    input.guests = [...guests].reverse();
    await repo.submitRequest(input);

    const callArgs = harness.rpcMock.mock.calls[0]!;
    const rpcArgs = callArgs[1] as Record<string, unknown>;
    const pGuests = rpcArgs["p_guests"] as Array<Record<string, unknown>>;
    // p_guests is built from snapshots (ordered [0, 1]) but notes are
    // resolved from input.guests by guestIndex. Guest 0 → peanuts,
    // Guest 1 → shellfish regardless of input array order.
    const byIndex = new Map(pGuests.map((g) => [g["guestIndex"], g]));
    expect(byIndex.get(0)?.["foodAllergies"]).toBe("peanuts");
    expect(byIndex.get(1)?.["foodAllergies"]).toBe("shellfish");
    expect(byIndex.get(1)?.["mealRequests"]).toBe("extra napkins");
  });
});

// ---------------------------------------------------------------------------
// Supabase repository — detail mapping restores snake_case columns
// ---------------------------------------------------------------------------

describe("SupabaseReservationRepository.getReservation — note column mapping", () => {
  function makeDetailClient(opts: {
    reservationData?: unknown;
    guestData?: unknown;
    platterData?: unknown;
    addonData?: unknown;
    error?: unknown;
  }) {
    const reservationChain = {
      select: vi.fn(() => reservationChain),
      eq: vi.fn(() => reservationChain),
      maybeSingle: vi.fn(async () => ({
        data: opts.reservationData ?? null,
        error: opts.error ?? null,
      })),
    };
    const guestChain = {
      select: vi.fn(() => guestChain),
      eq: vi.fn(() => guestChain),
      order: vi.fn(() => guestChain),
    };
    const platterChain = {
      select: vi.fn(() => platterChain),
      eq: vi.fn(() => platterChain),
      order: vi.fn(() => platterChain),
    };
    const addonChain = {
      select: vi.fn(() => addonChain),
      in: vi.fn(() => addonChain),
      order: vi.fn(async () => ({
        data: opts.addonData ?? [],
        error: null,
      })),
    };
    const fromMock = vi.fn((table: string) => {
      if (table === "reservation_detail_view") return reservationChain;
      if (table === "reservation_guests") return guestChain;
      if (table === "reservation_platter_lines") return platterChain;
      if (table === "reservation_guest_addons") return addonChain;
      return {} as never;
    });
    // The repo uses Promise.all([guests, platters]) then a separate addon query.
    // Make the guest/platter chains resolve with data after .order().
    guestChain.order = vi.fn(async () => ({
      data: opts.guestData ?? [],
      error: null,
    })) as never;
    platterChain.order = vi.fn(async () => ({
      data: opts.platterData ?? [],
      error: null,
    })) as never;
    return {
      client: { from: fromMock, rpc: vi.fn() } as never,
      fromMock,
    };
  }

  it("maps snake_case columns to camelCase DTO fields", async () => {
    const reservationRow = {
      id: "res-1",
      reservation_number: "SDS-20261009-ABCD",
      status: "pending_review",
      payment_status: "unpaid",
      experience_type: "standard",
      contact_first_name: "Jane",
      contact_last_name: "Doe",
      contact_email: "jane@example.com",
      contact_phone: "555-0100",
      sunday_service_id: "svc-1",
      seating_time_id: "seat-1",
      space_name: "Grand Ballroom",
      service_date: "2026-10-11",
      seating_start_time: "12:00",
      seating_end_time: "14:30",
      party_size: 1,
      adults: 1,
      seniors: 0,
      children: 0,
      guest_notes: "",
      dietary_notes: "",
      accessibility_requests: "",
      occasion: "",
      internal_notes: "",
      subtotal_cents: 2950,
      deposit_required_cents: 1475,
      grand_total_cents: 2950,
      amount_paid_cents: 0,
      remaining_balance_cents: 2950,
      balance_deadline: null,
      pricing_snapshot: {},
      policy_snapshot: {},
      created_at: "2026-10-09T00:00:00Z",
      updated_at: "2026-10-09T00:00:00Z",
    };
    const guestRows = [
      {
        id: "g-1",
        guest_index: 0,
        guest_category: "adult",
        guest_name: "Guest 1",
        package_id: "pkg-1",
        package_name_snapshot: "Basic Meal",
        package_price_snapshot: 2950,
        included_selections: [{ menuItemId: "m1", name: "Beef", category: "meat" }],
        food_allergies: "peanuts",
        dietary_preferences: "vegetarian",
        meal_requests: "no salt",
      },
    ];
    const harness = makeDetailClient({
      reservationData: reservationRow,
      guestData: guestRows,
      platterData: [],
      addonData: [],
    });
    const repo = new SupabaseReservationRepository(harness.client);
    const result = await repo.getReservation("res-1");
    expect(result.success).toBe(true);
    expect(result.reservation?.guests[0]?.foodAllergies).toBe("peanuts");
    expect(result.reservation?.guests[0]?.dietaryPreferences).toBe("vegetarian");
    expect(result.reservation?.guests[0]?.mealRequests).toBe("no salt");
  });

  it("maps null columns to empty strings", async () => {
    const reservationRow = {
      id: "res-1",
      reservation_number: "SDS-20261009-ABCD",
      status: "pending_review",
      payment_status: "unpaid",
      experience_type: "standard",
      contact_first_name: "Jane",
      contact_last_name: "Doe",
      contact_email: "jane@example.com",
      contact_phone: "555-0100",
      sunday_service_id: "svc-1",
      seating_time_id: "seat-1",
      space_name: "Grand Ballroom",
      service_date: "2026-10-11",
      seating_start_time: "12:00",
      seating_end_time: "14:30",
      party_size: 1,
      adults: 1,
      seniors: 0,
      children: 0,
      guest_notes: "",
      dietary_notes: "",
      accessibility_requests: "",
      occasion: "",
      internal_notes: "",
      subtotal_cents: 2950,
      deposit_required_cents: 1475,
      grand_total_cents: 2950,
      amount_paid_cents: 0,
      remaining_balance_cents: 2950,
      balance_deadline: null,
      pricing_snapshot: {},
      policy_snapshot: {},
      created_at: "2026-10-09T00:00:00Z",
      updated_at: "2026-10-09T00:00:00Z",
    };
    const guestRows = [
      {
        id: "g-1",
        guest_index: 0,
        guest_category: "adult",
        guest_name: null,
        package_id: "pkg-1",
        package_name_snapshot: "Basic Meal",
        package_price_snapshot: 2950,
        included_selections: [],
        food_allergies: null,
        dietary_preferences: null,
        meal_requests: null,
      },
    ];
    const harness = makeDetailClient({
      reservationData: reservationRow,
      guestData: guestRows,
      platterData: [],
      addonData: [],
    });
    const repo = new SupabaseReservationRepository(harness.client);
    const result = await repo.getReservation("res-1");
    expect(result.success).toBe(true);
    expect(result.reservation?.guests[0]?.foodAllergies).toBe("");
    expect(result.reservation?.guests[0]?.dietaryPreferences).toBe("");
    expect(result.reservation?.guests[0]?.mealRequests).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Idempotency hash — guest note normalization
// ---------------------------------------------------------------------------

describe("buildPayloadHash — guest note normalization", () => {
  function baseInput(guests: Array<Partial<ReservationGuestInput>>): Record<string, unknown> {
    return {
      sundayServiceId: "svc-1",
      seatingTimeId: "seat-1",
      experienceType: "standard",
      partySize: guests.length,
      adults: guests.length,
      seniors: 0,
      children: 0,
      contactFirstName: "Jane",
      contactLastName: "Doe",
      contactEmail: "jane@example.com",
      contactPhone: "555-0100",
      guestNotes: "",
      dietaryNotes: "",
      accessibilityRequests: "",
      occasion: "",
      guests: guests.map((g, i) => ({
        guestIndex: g.guestIndex ?? i,
        category: g.category ?? "adult",
        name: g.name ?? "",
        packageId: g.packageId ?? "pkg-1",
        included: g.included ?? [],
        addons: g.addons ?? [],
        foodAllergies: g.foodAllergies ?? "",
        dietaryPreferences: g.dietaryPreferences ?? "",
        mealRequests: g.mealRequests ?? "",
      })),
      platters: [],
    };
  }

  it("changed notes produce a different hash", () => {
    const noNotes = baseInput([{}]);
    const withNotes = baseInput([{ foodAllergies: "peanuts" }]);
    expect(buildPayloadHash(noNotes)).not.toBe(buildPayloadHash(withNotes));
  });

  it("missing and empty notes produce the same hash (legacy compatibility)", () => {
    // Simulate a legacy no-note payload: guest object has NO note keys at all.
    const legacyGuest = {
      guestIndex: 0,
      category: "adult",
      name: "",
      packageId: "pkg-1",
      included: [],
      addons: [],
    };
    const legacyInput = {
      sundayServiceId: "svc-1",
      seatingTimeId: "seat-1",
      experienceType: "standard",
      partySize: 1,
      adults: 1,
      seniors: 0,
      children: 0,
      contactFirstName: "Jane",
      contactLastName: "Doe",
      contactEmail: "jane@example.com",
      contactPhone: "555-0100",
      guestNotes: "",
      dietaryNotes: "",
      accessibilityRequests: "",
      occasion: "",
      guests: [legacyGuest],
      platters: [],
    };
    // The normalized input (with empty-string notes) should hash the same.
    const normalizedInput = baseInput([{}]);
    expect(buildPayloadHash(legacyInput)).toBe(buildPayloadHash(normalizedInput));
  });

  it("different non-empty notes produce different hashes", () => {
    const a = baseInput([{ foodAllergies: "peanuts" }]);
    const b = baseInput([{ foodAllergies: "shellfish" }]);
    expect(buildPayloadHash(a)).not.toBe(buildPayloadHash(b));
  });
});
