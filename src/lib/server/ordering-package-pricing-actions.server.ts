/**
 * SERVER-ONLY — per-package child/senior pricing save action.
 *
 * Thin handler: resolve the authorized actor (menus.manage), validate the
 * browser input with the strict schema, then call the existing
 * update_package_guest_pricing_atomic RPC through the server-only
 * administrative Supabase client. The RPC is authoritative for the fixed-price
 * ceiling against the current package price, optimistic-concurrency, and the
 * atomic write — this module does NOT duplicate that logic.
 *
 * The verified session user ID is passed as p_actor. Browser-supplied actor
 * identity is never accepted (the strict schema rejects unknown keys).
 *
 * RPC responses are validated at runtime — missing fields, wrong types,
 * mismatched package IDs, or inconsistent saved values never fabricate success.
 * Raw Supabase errors are never exposed. A failed validation NEVER claims the
 * operation succeeded: the database may have committed before an invalid
 * response was received.
 *
 * Saving per-package pricing does NOT recalculate existing reservations,
 * confirm anything, or change payment status.
 */
import { updatePackageGuestPricingSchema } from "@/lib/ordering/schema";
import { isValidOffsetOrZTimestamp } from "@/lib/sundays/schema";
import type { ChildRuleType } from "@/lib/ordering/constants";
import type {
  PackagePricingFields,
  PackagePricingSaveResult,
  PackagePricingSaveSuccess,
  PackagePricingFailureCode,
} from "@/lib/ordering/package-pricing-types";
import { resolveOrderingActor } from "./ordering-auth.server";
import { getAdminClient } from "./supabase-admin.server";

const CANNOT_VERIFY =
  "The pricing update could not be verified. Reload the package before continuing.";

const UNAUTHORIZED: PackagePricingSaveResult = {
  ok: false,
  code: "unexpected",
  error: "You are not authorized to manage ordering configuration.",
};

const FAILURE_CODES: readonly PackagePricingFailureCode[] = [
  "unauthorized",
  "invalid_value",
  "not_found",
  "conflict",
  "unexpected",
];

function messageForCode(code: PackagePricingFailureCode): string {
  switch (code) {
    case "conflict":
      return "This package was modified by another user. Reload the latest data and try again.";
    case "not_found":
      return "This package could not be found. It may have been removed.";
    case "invalid_value":
      return "One of the pricing values is not valid for this package.";
    case "unauthorized":
      return "You are not authorized to manage ordering configuration.";
    case "unexpected":
    default:
      return CANNOT_VERIFY;
  }
}

const RULE_TYPES: readonly (ChildRuleType | null)[] = [
  null,
  "none",
  "fixed_package_price",
  "percentage_discount",
];

function isValidRuleType(v: unknown): v is ChildRuleType | null {
  if (v === null) return true;
  return typeof v === "string" && (RULE_TYPES as readonly string[]).includes(v);
}

function isValidNullableAmount(v: unknown): v is number | null {
  if (v === null) return true;
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function isValidTimestamp(v: unknown): v is string {
  return typeof v === "string" && isValidOffsetOrZTimestamp(v);
}

/**
 * Runtime-validate the update_package_guest_pricing_atomic success payload.
 * Returns null if malformed, mismatched, or inconsistent with the request.
 *
 * The RPC returns `{ ok: true, row: <meal_packages row> }`. We extract the six
 * pricing fields and `updated_at` from the row and verify every value matches
 * the requested input exactly — including nulls and zeros. A no-op (identical
 * values) returns the same timestamp; a real change advances it.
 */
function parsePricingRpcSuccess(
  data: unknown,
  expected: {
    packageId: string;
    childRuleType: ChildRuleType | null;
    childFixedPriceCents: number | null;
    childDiscountBasisPoints: number | null;
    seniorRuleType: ChildRuleType | null;
    seniorFixedPriceCents: number | null;
    seniorDiscountBasisPoints: number | null;
  },
  expectedUpdatedAt: string,
): PackagePricingSaveSuccess | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;
  if (obj["ok"] !== true) return null;
  const row = obj["row"];
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  const pkg = row as Record<string, unknown>;

  const id = pkg["id"];
  if (typeof id !== "string" || id !== expected.packageId) return null;

  const updatedAt = pkg["updated_at"];
  if (!isValidTimestamp(updatedAt)) return null;

  const childRuleType = pkg["child_rule_type"];
  if (!isValidRuleType(childRuleType) || childRuleType !== expected.childRuleType) return null;
  const childFixedPriceCents = pkg["child_fixed_price_cents"];
  if (
    !isValidNullableAmount(childFixedPriceCents) ||
    childFixedPriceCents !== expected.childFixedPriceCents
  )
    return null;
  const childDiscountBasisPoints = pkg["child_discount_basis_points"];
  if (
    !isValidNullableAmount(childDiscountBasisPoints) ||
    childDiscountBasisPoints !== expected.childDiscountBasisPoints
  )
    return null;

  const seniorRuleType = pkg["senior_rule_type"];
  if (!isValidRuleType(seniorRuleType) || seniorRuleType !== expected.seniorRuleType) return null;
  const seniorFixedPriceCents = pkg["senior_fixed_price_cents"];
  if (
    !isValidNullableAmount(seniorFixedPriceCents) ||
    seniorFixedPriceCents !== expected.seniorFixedPriceCents
  )
    return null;
  const seniorDiscountBasisPoints = pkg["senior_discount_basis_points"];
  if (
    !isValidNullableAmount(seniorDiscountBasisPoints) ||
    seniorDiscountBasisPoints !== expected.seniorDiscountBasisPoints
  )
    return null;

  const pricing: PackagePricingFields = {
    childRuleType,
    childFixedPriceCents,
    childDiscountBasisPoints,
    seniorRuleType,
    seniorFixedPriceCents,
    seniorDiscountBasisPoints,
  };

  // noOp: the timestamp is unchanged from the expected (sent) timestamp.
  // The RPC explicitly returns the same row without advancing updated_at for
  // an exact no-op.
  const noOp = updatedAt === expectedUpdatedAt;

  return {
    ok: true,
    packageId: id,
    updatedAt,
    pricing,
    noOp,
  };
}

function parseFailureCode(data: unknown): PackagePricingFailureCode {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return "unexpected";
  const obj = data as Record<string, unknown>;
  if (obj["ok"] !== false) return "unexpected";
  const code = obj["code"];
  if (typeof code !== "string" || !FAILURE_CODES.includes(code as PackagePricingFailureCode))
    return "unexpected";
  return code as PackagePricingFailureCode;
}

/**
 * Save per-package child/senior pricing through the authoritative RPC.
 *
 * Requires menus.manage. Calls update_package_guest_pricing_atomic with the
 * verified actor user ID and exactly nine named arguments. All six pricing
 * fields are supplied explicitly, including nulls and zeros. The
 * expectedUpdatedAt string is forwarded verbatim.
 */
export async function serverSavePackagePricing(
  rawInput: unknown,
): Promise<PackagePricingSaveResult> {
  // 1. Resolve the authenticated actor — menus.manage — before any database access.
  let actor;
  try {
    actor = await resolveOrderingActor();
  } catch {
    return UNAUTHORIZED;
  }

  // 2. Strict input validation — no unknown keys, no browser-supplied actor.
  let parsed;
  try {
    parsed = updatePackageGuestPricingSchema.parse(rawInput);
  } catch {
    return {
      ok: false,
      code: "invalid_value",
      error: "Check the pricing fields before saving.",
    };
  }

  try {
    const admin = getAdminClient();
    const { data, error } = await admin.rpc("update_package_guest_pricing_atomic", {
      p_package_id: parsed.packageId,
      p_expected_updated_at: parsed.expectedUpdatedAt,
      p_actor: actor.userId,
      p_child_rule_type: parsed.childRuleType,
      p_child_fixed_price_cents: parsed.childFixedPriceCents,
      p_child_discount_basis_points: parsed.childDiscountBasisPoints,
      p_senior_rule_type: parsed.seniorRuleType,
      p_senior_fixed_price_cents: parsed.seniorFixedPriceCents,
      p_senior_discount_basis_points: parsed.seniorDiscountBasisPoints,
    });

    if (error) {
      // Transport/database failure — never expose raw error text, never retry.
      return { ok: false, code: "unexpected", error: CANNOT_VERIFY };
    }

    const success = parsePricingRpcSuccess(
      data,
      {
        packageId: parsed.packageId,
        childRuleType: parsed.childRuleType,
        childFixedPriceCents: parsed.childFixedPriceCents,
        childDiscountBasisPoints: parsed.childDiscountBasisPoints,
        seniorRuleType: parsed.seniorRuleType,
        seniorFixedPriceCents: parsed.seniorFixedPriceCents,
        seniorDiscountBasisPoints: parsed.seniorDiscountBasisPoints,
      },
      parsed.expectedUpdatedAt,
    );
    if (success) return success;

    const code = parseFailureCode(data);
    return { ok: false, code, error: messageForCode(code) };
  } catch {
    return { ok: false, code: "unexpected", error: CANNOT_VERIFY };
  }
}
