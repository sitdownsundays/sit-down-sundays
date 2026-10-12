/**
 * Server-only payment-access verification.
 *
 * Verifies that a caller possesses the opaque bearer credential bound to a
 * reservation during its atomic submission. This checks credential
 * possession ONLY — it does NOT prove management approval, an active capacity
 * hold, an unpaid deposit, or current Checkout eligibility. Those remain
 * authoritative checks in the Checkout service / SQL.
 *
 * Never returns or logs the raw token, the stored hash, a raw database error,
 * or any payment URL.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchesPaymentAccessToken, hashPaymentAccessToken } from "./payment-access-token.server";
import { getAdminClient } from "./supabase-admin.server";
import { isValidOffsetOrZTimestamp } from "@/lib/sundays/schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VerifyPaymentAccessResult =
  { ok: true; reservationId: string } | { ok: false; code: "access_denied" | "unavailable" };

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isFiniteIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && isValidOffsetOrZTimestamp(value);
}

/**
 * Verify that the caller possesses the payment-access credential bound to
 * the given reservation. Returns a discriminated result; never throws.
 */
export async function verifyReservationPaymentAccess(
  reservationId: unknown,
  token: unknown,
): Promise<VerifyPaymentAccessResult> {
  // Validate inputs BEFORE any database access.
  if (!isValidUuid(reservationId)) {
    return { ok: false, code: "access_denied" };
  }
  // hashPaymentAccessToken rejects malformed tokens without leaking why.
  if (hashPaymentAccessToken(token) === null) {
    return { ok: false, code: "access_denied" };
  }

  let client: SupabaseClient;
  try {
    client = getAdminClient();
  } catch {
    return { ok: false, code: "unavailable" };
  }

  let data: unknown;
  try {
    const response = await client
      .from("reservation_payment_access")
      .select("reservation_id,token_hash,created_at,expires_at,revoked_at")
      .eq("reservation_id", reservationId)
      .maybeSingle();

    if (response.error) {
      return { ok: false, code: "unavailable" };
    }
    data = response.data;
  } catch {
    return { ok: false, code: "unavailable" };
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, code: "access_denied" };
  }
  const row = data as Record<string, unknown>;

  // Runtime-validate the row.
  if (
    typeof row["reservation_id"] !== "string" ||
    row["reservation_id"] !== reservationId ||
    typeof row["token_hash"] !== "string" ||
    (row["token_hash"] as string).length !== 64 ||
    !/^[0-9a-f]{64}$/.test(row["token_hash"] as string) ||
    !isFiniteIsoTimestamp(row["created_at"]) ||
    !isFiniteIsoTimestamp(row["expires_at"]) ||
    (row["revoked_at"] !== null && !isFiniteIsoTimestamp(row["revoked_at"]))
  ) {
    return { ok: false, code: "access_denied" };
  }

  const createdAtMs = Date.parse(row["created_at"] as string);
  const expiresAtMs = Date.parse(row["expires_at"] as string);
  const nowMs = Date.now();

  // expires_at must be after created_at and still in the future.
  if (!(expiresAtMs > createdAtMs && expiresAtMs > nowMs)) {
    return { ok: false, code: "access_denied" };
  }

  // Any non-null revoked_at denies access.
  if (row["revoked_at"] !== null) {
    return { ok: false, code: "access_denied" };
  }

  // Constant-time comparison of the supplied token against the stored hash.
  if (!matchesPaymentAccessToken(token, row["token_hash"])) {
    return { ok: false, code: "access_denied" };
  }

  return { ok: true, reservationId };
}
