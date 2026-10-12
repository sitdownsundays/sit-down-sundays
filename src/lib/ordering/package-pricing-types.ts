/**
 * Per-package child/senior pricing — result contract for
 * update_package_guest_pricing_atomic (migration 0025).
 *
 * Client-safe: no server-only imports. The server action returns a typed
 * discriminated result; the browser never sees a raw RPC payload.
 */
import type { ChildRuleType } from "./constants";

/** The six saved pricing fields, returned exactly as the RPC stored them. */
export interface PackagePricingFields {
  childRuleType: ChildRuleType | null;
  childFixedPriceCents: number | null;
  childDiscountBasisPoints: number | null;
  seniorRuleType: ChildRuleType | null;
  seniorFixedPriceCents: number | null;
  seniorDiscountBasisPoints: number | null;
}

/** Successful save — the returned package ID, saved fields, and exact updatedAt. */
export interface PackagePricingSaveSuccess {
  ok: true;
  packageId: string;
  updatedAt: string;
  pricing: PackagePricingFields;
  /** True when the RPC was a no-op (identical values, unchanged timestamp). */
  noOp: boolean;
}

/** Documented failure codes for update_package_guest_pricing_atomic. */
export type PackagePricingFailureCode =
  "unauthorized" | "invalid_value" | "not_found" | "conflict" | "unexpected";

export interface PackagePricingSaveFailure {
  ok: false;
  code: PackagePricingFailureCode;
  error: string;
}

export type PackagePricingSaveResult = PackagePricingSaveSuccess | PackagePricingSaveFailure;
