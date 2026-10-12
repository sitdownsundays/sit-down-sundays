/**
 * Mocked-boundary verification of verifyReservationPaymentAccess().
 *
 * Exercises the REAL helper with a mocked admin-client boundary. NOT live
 * PostgreSQL verification. No tokens or hashes appear in failure results.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPaymentAccessToken } from "@/lib/server/payment-access-token.server";
import { verifyReservationPaymentAccess } from "@/lib/server/payment-access-authorization.server";

const FIXED_NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

// --- Hoisted mocks --------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getAdminClient: vi.fn(),
}));

vi.mock("@/lib/server/env.server", () => ({
  resolveDataMode: () => ({ dataMode: "supabase", isProduction: false }),
  isSupabaseMode: () => true,
  isMockMode: () => false,
  requireSupabaseEnv: () => ({
    url: "https://example.supabase.co",
    anonKey: "anon",
    serviceRoleKey: "service-role",
    siteUrl: "https://sitdownsundays.net",
  }),
}));

vi.mock("@/lib/server/supabase-admin.server", () => ({
  getAdminClient: mocks.getAdminClient,
}));

// --- Fixtures --------------------------------------------------------------

const RESERVATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_RESERVATION_ID = "22222222-2222-4222-8222-222222222222";

/** Build a fake PostgREST chain: .select().eq().maybeSingle() */
function makeQuery(row: unknown, error: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error }),
  };
  return chain;
}

function accessRow(overrides: Record<string, unknown> = {}) {
  const created = new Date(FIXED_NOW - 1000).toISOString();
  const expires = new Date(FIXED_NOW + 3600_000).toISOString();
  return {
    reservation_id: RESERVATION_ID,
    token_hash: "0".repeat(64),
    created_at: created,
    expires_at: expires,
    revoked_at: null,
    ...overrides,
  };
}

function installClient(row: unknown, error: unknown = null) {
  const chain = makeQuery(row, error);
  mocks.getAdminClient.mockReturnValue({
    from: vi.fn().mockReturnValue(chain),
  });
  return chain;
}

// --- Suite -----------------------------------------------------------------

describe("verifyReservationPaymentAccess", () => {
  let dateNowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on Date.now only — do NOT use vi.useFakeTimers, which blocks
    // async promise resolution for the mocked Supabase boundary.
    dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
    mocks.getAdminClient.mockReset();
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
  });

  // --- Valid matching credential ---

  it("succeeds with a valid matching credential", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    const chain = installClient({
      ...accessRow(),
      token_hash: tokenHash,
    });

    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);

    expect(result).toEqual({ ok: true, reservationId: RESERVATION_ID });
    expect(mocks.getAdminClient).toHaveBeenCalledTimes(1);
    expect(chain.select).toHaveBeenCalledWith(
      "reservation_id,token_hash,created_at,expires_at,revoked_at",
    );
    expect(chain.eq).toHaveBeenCalledWith("reservation_id", RESERVATION_ID);
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1);
  });

  // --- Invalid input: no database call ---

  it("returns access_denied for an invalid UUID without a database call", async () => {
    installClient(accessRow());
    const result = await verifyReservationPaymentAccess("not-a-uuid", "some-token");
    expect(result).toEqual({ ok: false, code: "access_denied" });
    expect(mocks.getAdminClient).not.toHaveBeenCalled();
  });

  it("returns access_denied for a non-string reservation ID", async () => {
    installClient(accessRow());
    const result = await verifyReservationPaymentAccess(12345, "some-token");
    expect(result).toEqual({ ok: false, code: "access_denied" });
    expect(mocks.getAdminClient).not.toHaveBeenCalled();
  });

  it("returns access_denied for a malformed token without a database call", async () => {
    installClient(accessRow());
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, "not-a-valid-token");
    expect(result).toEqual({ ok: false, code: "access_denied" });
    expect(mocks.getAdminClient).not.toHaveBeenCalled();
  });

  it("returns access_denied for a non-string token", async () => {
    installClient(accessRow());
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, 12345);
    expect(result).toEqual({ ok: false, code: "access_denied" });
    expect(mocks.getAdminClient).not.toHaveBeenCalled();
  });

  // --- Missing row / wrong reservation / wrong token ---

  it("returns access_denied for a missing row", async () => {
    const { token } = createPaymentAccessToken();
    installClient(null);
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
  });

  it("returns access_denied when the row reservation_id does not match", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    installClient({ ...accessRow(), reservation_id: OTHER_RESERVATION_ID, token_hash: tokenHash });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
  });

  it("returns access_denied for a wrong token with a valid stored hash", async () => {
    const { tokenHash } = createPaymentAccessToken();
    installClient({ ...accessRow(), token_hash: tokenHash });
    const { token: otherToken } = createPaymentAccessToken();
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, otherToken);
    expect(result).toEqual({ ok: false, code: "access_denied" });
  });

  // --- Expired credential ---

  it("returns access_denied for an expired credential", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    installClient({
      ...accessRow(),
      token_hash: tokenHash,
      created_at: new Date(FIXED_NOW - 7200_000).toISOString(),
      expires_at: new Date(FIXED_NOW - 3600_000).toISOString(),
    });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
  });

  it("denies access at the exact expiry boundary (expires_at == now)", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    const nowMs = FIXED_NOW;
    installClient({
      ...accessRow(),
      token_hash: tokenHash,
      created_at: new Date(nowMs - 1000).toISOString(),
      expires_at: new Date(nowMs).toISOString(),
    });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
  });

  it("allows access one millisecond before expiry", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    const nowMs = FIXED_NOW;
    installClient({
      ...accessRow(),
      token_hash: tokenHash,
      created_at: new Date(nowMs - 1000).toISOString(),
      expires_at: new Date(nowMs + 1).toISOString(),
    });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: true, reservationId: RESERVATION_ID });
  });

  // --- Revoked credential ---

  it("returns access_denied for a revoked credential", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    installClient({
      ...accessRow(),
      token_hash: tokenHash,
      revoked_at: new Date(FIXED_NOW - 500).toISOString(),
    });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
  });

  it("returns access_denied when revoked_at is a malformed timestamp", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    installClient({
      ...accessRow(),
      token_hash: tokenHash,
      revoked_at: "not-a-date",
    });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
  });

  // --- Malformed row ---

  it("returns access_denied for a malformed stored hash (wrong length)", async () => {
    const { token } = createPaymentAccessToken();
    installClient({ ...accessRow(), token_hash: "0".repeat(32) });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
  });

  it("returns access_denied for a malformed stored hash (non-hex)", async () => {
    const { token } = createPaymentAccessToken();
    installClient({ ...accessRow(), token_hash: "g".repeat(64) });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
  });

  it("returns access_denied for a malformed created_at timestamp", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    installClient({ ...accessRow(), token_hash: tokenHash, created_at: "not-a-date" });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
  });

  it("returns access_denied for a malformed expires_at timestamp", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    installClient({ ...accessRow(), token_hash: tokenHash, expires_at: "not-a-date" });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
  });

  it("returns access_denied when expires_at precedes created_at", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    const nowMs = FIXED_NOW;
    installClient({
      ...accessRow(),
      token_hash: tokenHash,
      created_at: new Date(nowMs + 3600_000).toISOString(),
      expires_at: new Date(nowMs).toISOString(),
    });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
  });

  it("returns access_denied when expires_at equals created_at", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    const nowMs = FIXED_NOW;
    const sameTs = new Date(nowMs + 3600_000).toISOString();
    installClient({
      ...accessRow(),
      token_hash: tokenHash,
      created_at: sameTs,
      expires_at: sameTs,
    });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
  });

  // --- Database / transport errors ---

  it("returns unavailable when the query returns an error", async () => {
    const { token } = createPaymentAccessToken();
    installClient(null, { message: "connection refused" });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "unavailable" });
  });

  it("returns unavailable when getAdminClient throws", async () => {
    const { token } = createPaymentAccessToken();
    mocks.getAdminClient.mockImplementation(() => {
      throw new Error("env not configured");
    });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "unavailable" });
  });

  it("returns unavailable when maybeSingle throws", async () => {
    const { token } = createPaymentAccessToken();
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockRejectedValue(new Error("network error")),
    };
    mocks.getAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue(chain) });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "unavailable" });
  });

  // --- No sensitive data in failures ---

  it("does not expose the token or hash in a denied result", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    installClient({ ...accessRow(), token_hash: tokenHash });
    // Use a wrong token so the match fails.
    const { token: wrongToken } = createPaymentAccessToken();
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, wrongToken);
    expect(result.ok).toBe(false);
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain(wrongToken);
    expect(resultJson).not.toContain(tokenHash);
    expect(resultJson).not.toContain(token);
  });

  it("does not expose the token or hash in an unavailable result", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    installClient(null, { message: `secret=${tokenHash}` });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result.ok).toBe(false);
    const resultJson = JSON.stringify(result);
    expect(resultJson).not.toContain(token);
    expect(resultJson).not.toContain(tokenHash);
  });

  // --- Malformed rows (regression) ---

  it("returns access_denied for an undefined row", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    const chain = installClient(undefined);
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns access_denied for a null row (regression)", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    const chain = installClient(null);
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns access_denied for an array row", async () => {
    const { token } = createPaymentAccessToken();
    const chain = installClient([]);
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns access_denied for a string row", async () => {
    const { token } = createPaymentAccessToken();
    const chain = installClient("not-an-object");
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns access_denied for a number row", async () => {
    const { token } = createPaymentAccessToken();
    const chain = installClient(42);
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns access_denied for an empty object row", async () => {
    const { token } = createPaymentAccessToken();
    const chain = installClient({});
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns access_denied for a row containing only reservation_id", async () => {
    const { token } = createPaymentAccessToken();
    const chain = installClient({ reservation_id: RESERVATION_ID });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1);
  });

  // --- Timestamp regression ---

  it("returns access_denied for a timezone-less created_at", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    const chain = installClient({
      ...accessRow(),
      token_hash: tokenHash,
      created_at: "2026-10-25T12:00:00",
    });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns access_denied for a date-only created_at", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    const chain = installClient({
      ...accessRow(),
      token_hash: tokenHash,
      created_at: "2026-10-25",
    });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns access_denied for a timezone-less expires_at", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    const chain = installClient({
      ...accessRow(),
      token_hash: tokenHash,
      expires_at: "2026-10-25T13:00:00",
    });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns access_denied for a date-only expires_at", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    const chain = installClient({
      ...accessRow(),
      token_hash: tokenHash,
      expires_at: "2026-10-25",
    });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: false, code: "access_denied" });
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("accepts a valid numeric-offset timestamp with fractional seconds", async () => {
    const { token, tokenHash } = createPaymentAccessToken();
    const chain = installClient({
      ...accessRow(),
      token_hash: tokenHash,
      created_at: "2026-10-11T11:59:59.000+00:00",
      expires_at: "2026-10-11T13:00:00.000+00:00",
    });
    const result = await verifyReservationPaymentAccess(RESERVATION_ID, token);
    expect(result).toEqual({ ok: true, reservationId: RESERVATION_ID });
    expect(chain.maybeSingle).toHaveBeenCalledTimes(1);
  });

  // --- Old six-group UUID rejection ---

  it("rejects an old six-group UUID before database access", async () => {
    installClient(accessRow());
    const { token } = createPaymentAccessToken();
    const result = await verifyReservationPaymentAccess(
      "11111111-1111-4111-8111-1111-111111111111",
      token,
    );
    expect(result).toEqual({ ok: false, code: "access_denied" });
    expect(mocks.getAdminClient).not.toHaveBeenCalled();
  });
});
