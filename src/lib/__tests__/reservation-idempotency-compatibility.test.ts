/**
 * Idempotency compatibility regression — real handler, mocked persistence.
 *
 * Mocked-boundary verification, NOT live PostgreSQL. Exercises the REAL
 * handleSubmitReservationRequest with the repository mocked at the
 * getReservationRepository boundary. The mock repository reproduces the real
 * MockReservationRepository matching semantics (same key → compare hash →
 * replay / mismatch / null), so the handler's interpretation of each result
 * is what's actually under test.
 *
 * Four cases:
 *  1. Same key + same current payload (with matching clientPreviewPrice) →
 *     original reservation replay, zero writes.
 *  2. Same key + changed reviewed terms → idempotency_key_mismatch, zero writes.
 *     (NOT a fresh request and NOT a repricing fall-through.)
 *  3. Legacy absent-field payload (no clientPreviewPrice) → original replay.
 *  4. A payload containing clientPreviewPrice that was SAVED under the
 *     PREVIOUS hash algorithm (which omitted clientPreviewPrice). Retrying the
 *     identical payload against the CURRENT handler (which now includes
 *     clientPreviewPrice in the hash) — reports the actual outcome.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleSubmitReservationRequest } from "@/lib/server/reservation-submit.server";
import { buildPayloadHash } from "@/lib/server/reservation-submit.server";
import type { ReviewedPrice } from "@/lib/reservation/types";

const SERVICE_ID = "11111111-1111-1111-1111-111111111111";
const SEATING_ID = "22222222-2222-2222-2222-222222222222";
const PKG_ID = "33333333-3333-3333-3333-333333333333";
const MEAT_ID = "77777777-7777-7777-7777-777777777777";
const MEAT_B_ID = "77777777-7777-7777-7777-777777777778";
const SIDE_ID = "88888888-8888-8888-8888-888888888888";
const SIDE_B_ID = "88888888-8888-8888-8888-888888888889";

/**
 * A fixed pre-change hash fixture: the value the CURRENT buildPayloadHash
 * produces for the base payload WITHOUT clientPreviewPrice. This is the exact
 * algorithm applied to legacy no-reviewed-price submissions, captured as a
 * constant (not recomputed by a second call) so the test cannot silently
 * re-agree with itself.
 */
/**
 * Fixed hash fixture for this test's base payload WITHOUT clientPreviewPrice
 * — the value the CURRENT buildPayloadHash produces for the exact object the
 * handler constructs (including guestNotes/dietaryNotes/accessibilityRequests/
 * occasion and per-guest note keys defaulted to ""). Captured as a constant
 * (not recomputed) so the test cannot silently re-agree with itself. This is
 * also the hash the PREVIOUS algorithm would have produced for a payload that
 * included clientPreviewPrice (since the previous algorithm omitted that field
 * entirely).
 */
const LEGACY_ABSENT_HASH = "a5647cac2cc4cf87ce62eaf27bcc0c8087cc0f6e64629d450ab3f6cef5c69496";

/**
 * The current algorithm's hash for the exact handler-built object WITH the
 * matching ReviewedPrice. Captured as a constant fixture.
 */
const WITH_RP_HASH = "37de312001f042632ea0ea943fc31cc4aefed737617b228c136871d1f5f8762c";

const sundaysMock = {
  listAllSundayServices: vi.fn(),
  getSundayService: vi.fn(),
  listSeatingTimesForService: vi.fn(),
  getPaymentPolicy: vi.fn(),
};
const spacesMock = { listAllSpaces: vi.fn() };
const orderingMock = { getOrderingConfig: vi.fn() };

/**
 * In-memory mock repository that reproduces MockReservationRepository's
 * real matching semantics: same idempotency key → compare stored hash to the
 * query hash → replay (match), mismatch (proven_rejection), or null (no row).
 * The handler delegates to findByIdempotencyKey + submitRequest; this mock
 * stores rows so the handler's interpretation of the lookup result is tested.
 */
interface StoredRow {
  idempotencyKey: string;
  payloadHash: string;
  reservationId: string;
  reservationNumber: string;
  status: string;
  paymentStatus: string;
}
let store: StoredRow[] = [];

const reservationMock = {
  listPublicAvailability: vi.fn(),
  findByIdempotencyKey: vi.fn(async (key: string, hash: string) => {
    const existing = store.find((r) => r.idempotencyKey === key);
    if (!existing) return null;
    if (existing.payloadHash !== hash) {
      return {
        success: false,
        outcome: "proven_rejection" as const,
        rejectionCode: "idempotency_key_mismatch" as const,
        error: "This request key was used for a different reservation.",
      };
    }
    return {
      success: true,
      reservationId: existing.reservationId,
      reservationNumber: existing.reservationNumber,
      status: existing.status,
      paymentStatus: existing.paymentStatus,
      idempotentReplay: true,
    };
  }),
  submitRequest: vi.fn(async () => {
    throw new Error("submitRequest must not be called on a replay/mismatch path");
  }),
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
    idempotencyKey: "key-compat-1",
  };
}

const rpA: ReviewedPrice = {
  subtotalCents: 10000,
  gratuityCents: 1800,
  taxCents: 1180,
  grandTotalCents: 12980,
  depositRequiredCents: 5000,
  appliedGratuityRateBasisPoints: 1800,
  appliedTaxRateBasisPoints: 1000,
  appliedTaxOnGratuity: true,
  appliedDepositPercent: 50,
};

const rpB: ReviewedPrice = {
  ...rpA,
  gratuityCents: 2000,
  appliedGratuityRateBasisPoints: 2000,
};

function seedRow(key: string, hash: string, id = "res-seed", number = "SDS-20991107-SEED") {
  store.push({
    idempotencyKey: key,
    payloadHash: hash,
    reservationId: id,
    reservationNumber: number,
    status: "pending_review",
    paymentStatus: "unpaid",
  });
}

describe("idempotency compatibility — real handler, mocked persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store = [];
    reservationMock.submitRequest.mockImplementation(async () => {
      throw new Error("submitRequest must not be called on a replay/mismatch path");
    });
  });

  it("case 1: same key + same current payload (with matching clientPreviewPrice) → original replay, zero writes", async () => {
    seedRow("key-compat-1", WITH_RP_HASH, "res-existing", "SDS-20991107-AAAA");
    const input = { ...baseInput(), clientPreviewPrice: rpA };
    const r = await handleSubmitReservationRequest(input as never);
    expect(r.success).toBe(true);
    expect((r as { idempotentReplay?: boolean }).idempotentReplay).toBe(true);
    expect((r as { reservationId?: string }).reservationId).toBe("res-existing");
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
    expect(orderingMock.getOrderingConfig).not.toHaveBeenCalled();
  });

  it("case 2: same key + changed reviewed terms → idempotency_key_mismatch, zero writes (not a fresh request or repricing)", async () => {
    // Stored under the hash for rpA; retry with changed terms (rpB).
    seedRow("key-compat-1", WITH_RP_HASH);
    const input = { ...baseInput(), clientPreviewPrice: rpB };
    const r = await handleSubmitReservationRequest(input as never);
    expect(r.success).toBe(false);
    expect((r as { rejectionCode?: string }).rejectionCode).toBe("idempotency_key_mismatch");
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
    // Must NOT fall through to revalidation/repricing.
    expect(orderingMock.getOrderingConfig).not.toHaveBeenCalled();
    expect(sundaysMock.getPaymentPolicy).not.toHaveBeenCalled();
  });

  it("case 3: legacy absent-field payload (no clientPreviewPrice) → original replay", async () => {
    seedRow("key-compat-1", LEGACY_ABSENT_HASH, "res-legacy", "SDS-20991107-LEG");
    const input = baseInput(); // no clientPreviewPrice
    const r = await handleSubmitReservationRequest(input as never);
    expect(r.success).toBe(true);
    expect((r as { idempotentReplay?: boolean }).idempotentReplay).toBe(true);
    expect((r as { reservationId?: string }).reservationId).toBe("res-legacy");
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
    expect(orderingMock.getOrderingConfig).not.toHaveBeenCalled();
  });

  it("case 4: clientPreviewPrice saved under the PREVIOUS hash algorithm → identical retry against current handler reports the actual outcome", async () => {
    // The previous algorithm omitted clientPreviewPrice from the hash. A
    // saved request that DID include clientPreviewPrice was therefore stored
    // under the hash computed WITHOUT it — i.e. the legacy absent-field hash.
    // We seed the store with that pre-change hash, then retry the IDENTICAL
    // payload (clientPreviewPrice present) against the CURRENT handler.
    seedRow("key-compat-1", LEGACY_ABSENT_HASH, "res-prechange", "SDS-20991107-PRE");
    const input = { ...baseInput(), clientPreviewPrice: rpA };

    // Sanity: the current algorithm produces a DIFFERENT hash for this payload
    // than the pre-change one it was saved under.
    const currentHash = buildPayloadHash({
      ...input,
      clientPreviewPrice: rpA,
    });
    expect(currentHash).not.toBe(LEGACY_ABSENT_HASH);

    const r = await handleSubmitReservationRequest(input as never);
    // Actual outcome: the current handler computes a hash that includes
    // clientPreviewPrice, which does NOT match the stored pre-change hash.
    // The repository returns idempotency_key_mismatch; the handler returns it
    // without writing or repricing.
    expect(r.success).toBe(false);
    expect((r as { rejectionCode?: string }).rejectionCode).toBe("idempotency_key_mismatch");
    expect(reservationMock.submitRequest).not.toHaveBeenCalled();
    expect(orderingMock.getOrderingConfig).not.toHaveBeenCalled();
  });
});
