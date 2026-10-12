/**
 * Reservation charge calculation — pure, side-effect-free helper.
 *
 * Computes gratuity, tax, grand total, required deposit, and a projected
 * balance after deposit from an authoritative food subtotal and configured
 * basis-point rates. Nothing here is marked paid or confirmed.
 *
 * Tax treatment (whether mandatory gratuity is taxable) is an EXPLICIT
 * configuration choice supplied via taxOnGratuity; it has no implicit default.
 * Pending owner/accountant confirmation — not a claim that mandatory gratuity
 * is always taxable.
 *
 * NOT WIRED into live pricing or payment collection yet.
 */

/** Inputs for charge calculation. All monetary values are integer cents. */
export interface ReservationChargeInput {
  /** Authoritative food subtotal in integer cents, after discounts. */
  foodSubtotalCents: number;
  /** Gratuity rate in basis points (1800 = 18%). */
  gratuityBasisPoints: number;
  /** Tax rate in basis points (1000 = 10%). */
  taxBasisPoints: number;
  /** Required deposit rate in basis points (5000 = 50%). */
  depositBasisPoints: number;
  /** When true, gratuity is included in the taxable amount. Explicit; no default. */
  taxOnGratuity: boolean;
}

/** Per-component charge breakdown. */
export interface ReservationChargeBreakdown {
  foodSubtotalCents: number;
  /** Gratuity = foodSubtotalCents × gratuityBasisPoints, rounded once. */
  gratuityCents: number;
  /** Food subtotal plus gratuity when taxOnGratuity is true; otherwise food subtotal alone. */
  taxableAmountCents: number;
  /** Tax = taxableAmountCents × taxBasisPoints, rounded once. */
  taxCents: number;
  /** Food subtotal + gratuity + tax. */
  grandTotalCents: number;
  /** foodSubtotalCents × depositBasisPoints, rounded once. Tax and gratuity are never in the deposit base. */
  requiredDepositCents: number;
  /**
   * Projected balance AFTER applying the required deposit (grandTotal − deposit).
   * This is a PROJECTION, not the actual outstanding balance before payment is
   * received. Nothing here is marked paid or confirmed.
   */
  projectedBalanceAfterDepositCents: number;
  taxOnGratuity: boolean;
}

export type ReservationChargeResult =
  ({ ok: true } & ReservationChargeBreakdown) | { ok: false; error: string };

const BPS_DENOMINATOR = 10_000;
const MAX_BASIS_POINTS = 10_000;

function isBasisPoints(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_BASIS_POINTS
  );
}

/**
 * Round numerator/denominator to the nearest integer cent, with positive
 * half-cents rounding up. BigInt arithmetic avoids floating-point error.
 * Both operands must be validated non-negative integers.
 */
function roundHalfUpCents(numerator: number, denominator: number): number {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  return Number((2n * n + d) / (2n * d));
}

function fail(error: string): ReservationChargeResult {
  return { ok: false, error };
}

/**
 * Calculate reservation charges from an authoritative food subtotal and
 * configured basis-point rates. Returns a discriminated result; invalid or
 * unsafe inputs produce { ok: false } rather than misleading totals.
 */
export function calculateReservationCharges(
  input: ReservationChargeInput,
): ReservationChargeResult {
  if (input === null || typeof input !== "object") {
    return fail("Input is required.");
  }

  const {
    foodSubtotalCents,
    gratuityBasisPoints,
    taxBasisPoints,
    depositBasisPoints,
    taxOnGratuity,
  } = input;

  // taxOnGratuity is explicit — no implicit default.
  if (typeof taxOnGratuity !== "boolean") {
    return fail("taxOnGratuity must be an explicit boolean.");
  }
  // foodSubtotalCents must be a non-negative safe integer (rejects NaN,
  // Infinity, non-integers, and values beyond the safe-integer range).
  if (!Number.isSafeInteger(foodSubtotalCents) || foodSubtotalCents < 0) {
    return fail("foodSubtotalCents must be a non-negative safe integer.");
  }
  if (!isBasisPoints(gratuityBasisPoints)) {
    return fail("gratuityBasisPoints must be an integer in [0, 10000].");
  }
  if (!isBasisPoints(taxBasisPoints)) {
    return fail("taxBasisPoints must be an integer in [0, 10000].");
  }
  if (!isBasisPoints(depositBasisPoints)) {
    return fail("depositBasisPoints must be an integer in [0, 10000].");
  }

  // Guard against unsafe arithmetic: reject products that exceed the safe
  // integer range rather than returning totals that lost precision.
  const gratuityNumerator = foodSubtotalCents * gratuityBasisPoints;
  if (!Number.isSafeInteger(gratuityNumerator)) {
    return fail("Unsafe arithmetic: foodSubtotalCents too large for gratuity.");
  }
  const depositNumerator = foodSubtotalCents * depositBasisPoints;
  if (!Number.isSafeInteger(depositNumerator)) {
    return fail("Unsafe arithmetic: foodSubtotalCents too large for deposit.");
  }

  const gratuityCents = roundHalfUpCents(gratuityNumerator, BPS_DENOMINATOR);

  const taxableAmountCents = taxOnGratuity ? foodSubtotalCents + gratuityCents : foodSubtotalCents;

  const taxNumerator = taxableAmountCents * taxBasisPoints;
  if (!Number.isSafeInteger(taxNumerator)) {
    return fail("Unsafe arithmetic: taxable amount too large for tax.");
  }
  const taxCents = roundHalfUpCents(taxNumerator, BPS_DENOMINATOR);

  const grandTotalCents = foodSubtotalCents + gratuityCents + taxCents;
  if (!Number.isSafeInteger(grandTotalCents)) {
    return fail("Unsafe arithmetic: grand total exceeds safe integer range.");
  }

  const requiredDepositCents = roundHalfUpCents(depositNumerator, BPS_DENOMINATOR);

  const projectedBalanceAfterDepositCents = grandTotalCents - requiredDepositCents;
  if (!Number.isSafeInteger(projectedBalanceAfterDepositCents)) {
    return fail("Unsafe arithmetic: projected balance exceeds safe integer range.");
  }

  return {
    ok: true,
    foodSubtotalCents,
    gratuityCents,
    taxableAmountCents,
    taxCents,
    grandTotalCents,
    requiredDepositCents,
    projectedBalanceAfterDepositCents,
    taxOnGratuity,
  };
}
