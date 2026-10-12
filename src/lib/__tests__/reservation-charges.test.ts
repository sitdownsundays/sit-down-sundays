/**
 * Focused tests for the pure reservation charge-calculation helper.
 * No database, no Supabase, no live pricing/payment wiring.
 */
import { describe, it, expect } from "vitest";
import {
  calculateReservationCharges,
  type ReservationChargeInput,
  type ReservationChargeResult,
} from "@/lib/reservation/charges";

function ok(input: ReservationChargeInput): Exclude<ReservationChargeResult, { ok: false }> {
  const r = calculateReservationCharges(input);
  if (!r.ok) throw new Error(`Expected success, got: ${r.error}`);
  return r;
}

const BASE: ReservationChargeInput = {
  foodSubtotalCents: 10000,
  gratuityBasisPoints: 1800,
  taxBasisPoints: 1000,
  depositBasisPoints: 5000,
  taxOnGratuity: true,
};

describe("calculateReservationCharges", () => {
  it("applies gratuity and taxes gratuity when taxOnGratuity=true", () => {
    const r = ok(BASE);
    expect(r.gratuityCents).toBe(1800);
    expect(r.taxableAmountCents).toBe(11800);
    expect(r.taxCents).toBe(1180);
    expect(r.grandTotalCents).toBe(12980);
    expect(r.requiredDepositCents).toBe(5000);
    expect(r.projectedBalanceAfterDepositCents).toBe(7980);
  });

  it("excludes gratuity from the taxable amount when taxOnGratuity=false", () => {
    const r = ok({ ...BASE, taxOnGratuity: false });
    expect(r.taxableAmountCents).toBe(10000);
    expect(r.taxCents).toBe(1000);
    expect(r.grandTotalCents).toBe(12800);
    expect(r.requiredDepositCents).toBe(5000);
    expect(r.projectedBalanceAfterDepositCents).toBe(7800);
  });

  it("rounds positive half-cents up and rounds down otherwise", () => {
    // gratuity: 5000 * 1801 / 10000 = 900.5 -> rounds UP to 901
    const a = ok({
      foodSubtotalCents: 5000,
      gratuityBasisPoints: 1801,
      taxBasisPoints: 1000,
      depositBasisPoints: 5000,
      taxOnGratuity: true,
    });
    expect(a.gratuityCents).toBe(901);
    expect(a.taxableAmountCents).toBe(5901);
    // tax: 5901 * 1000 / 10000 = 590.1 -> rounds DOWN to 590
    expect(a.taxCents).toBe(590);
    expect(a.grandTotalCents).toBe(5000 + 901 + 590);

    // tax half-up: 5000 * 1001 / 10000 = 500.5 -> rounds UP to 501
    const b = ok({
      foodSubtotalCents: 5000,
      gratuityBasisPoints: 0,
      taxBasisPoints: 1001,
      depositBasisPoints: 5000,
      taxOnGratuity: false,
    });
    expect(b.taxCents).toBe(501);
    expect(b.grandTotalCents).toBe(5000 + 0 + 501);
  });

  it("handles zero amounts", () => {
    const r = ok({
      foodSubtotalCents: 0,
      gratuityBasisPoints: 1800,
      taxBasisPoints: 1000,
      depositBasisPoints: 5000,
      taxOnGratuity: true,
    });
    expect(r.gratuityCents).toBe(0);
    expect(r.taxableAmountCents).toBe(0);
    expect(r.taxCents).toBe(0);
    expect(r.grandTotalCents).toBe(0);
    expect(r.requiredDepositCents).toBe(0);
    expect(r.projectedBalanceAfterDepositCents).toBe(0);
  });

  it("never includes tax or gratuity in the deposit base", () => {
    const r = ok(BASE);
    // Deposit is 50% of the 10000 food subtotal, NOT 50% of the 12980 grand total.
    expect(r.requiredDepositCents).toBe(5000);
    expect(r.requiredDepositCents).not.toBe(6490);
    expect(r.requiredDepositCents).not.toBe(Math.round(12980 * 0.5));
  });

  it("rejects invalid and out-of-range inputs", () => {
    expect(calculateReservationCharges({ ...BASE, foodSubtotalCents: -1 }).ok).toBe(false);
    expect(calculateReservationCharges({ ...BASE, foodSubtotalCents: 1.5 }).ok).toBe(false);
    expect(calculateReservationCharges({ ...BASE, foodSubtotalCents: NaN }).ok).toBe(false);
    expect(calculateReservationCharges({ ...BASE, foodSubtotalCents: Infinity }).ok).toBe(false);
    expect(calculateReservationCharges({ ...BASE, gratuityBasisPoints: -1 }).ok).toBe(false);
    expect(calculateReservationCharges({ ...BASE, gratuityBasisPoints: 10001 }).ok).toBe(false);
    expect(calculateReservationCharges({ ...BASE, gratuityBasisPoints: 1.5 }).ok).toBe(false);
    expect(calculateReservationCharges({ ...BASE, taxBasisPoints: 10001 }).ok).toBe(false);
    expect(calculateReservationCharges({ ...BASE, depositBasisPoints: 10001 }).ok).toBe(false);
    expect(calculateReservationCharges({ ...BASE, depositBasisPoints: -1 }).ok).toBe(false);
    // non-boolean taxOnGratuity
    expect(
      calculateReservationCharges({ ...BASE, taxOnGratuity: undefined as unknown as boolean }).ok,
    ).toBe(false);
    expect(
      calculateReservationCharges({ ...BASE, taxOnGratuity: "true" as unknown as boolean }).ok,
    ).toBe(false);
    expect(
      calculateReservationCharges({ ...BASE, taxOnGratuity: 1 as unknown as boolean }).ok,
    ).toBe(false);
  });

  it("requires an explicit taxOnGratuity boolean with no implicit default", () => {
    // taxOnGratuity intentionally omitted to exercise the runtime guard.
    const partial = {
      foodSubtotalCents: 10000,
      gratuityBasisPoints: 0,
      taxBasisPoints: 1000,
      depositBasisPoints: 0,
    } as ReservationChargeInput;
    expect(calculateReservationCharges(partial).ok).toBe(false);
  });

  it("rejects unsafe arithmetic that would lose precision", () => {
    // A food subtotal beyond the safe-integer range is rejected even when it
    // is an integer value, because percentage products would lose precision.
    const huge = Number.MAX_SAFE_INTEGER + 2; // not a safe integer
    expect(
      calculateReservationCharges({
        foodSubtotalCents: huge,
        gratuityBasisPoints: 0,
        taxBasisPoints: 0,
        depositBasisPoints: 0,
        taxOnGratuity: false,
      }).ok,
    ).toBe(false);
  });

  it("does not mutate the input", () => {
    const input: ReservationChargeInput = { ...BASE };
    const snapshot = { ...input };
    calculateReservationCharges(input);
    expect(input).toEqual(snapshot);
  });
});
