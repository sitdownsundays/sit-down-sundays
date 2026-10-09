import { describe, it, expect } from "vitest";
import type { QuoteResult } from "@/lib/public-quote.functions";
import { isMealsStepReady, computeQuoteInputHash } from "@/lib/booking/use-booking-meals";

/**
 * Tests for the Step 2 Continue-readiness condition (canContinueFromMeals).
 *
 * These exercise the PRODUCTION functions isMealsStepReady() and
 * computeQuoteInputHash() — not a copied local replica. The production
 * readiness logic requires:
 *
 *   mealsComplete &&
 *   quote !== null && quote.ok &&
 *   !quoteLoading &&
 *   quoteError === null &&
 *   !quote.hasUnresolvedRules &&
 *   currentInputHash !== null &&
 *   quoteInputHash === currentInputHash
 *
 * The quoteInputHash fingerprint is set when a quote resolves ok and cleared on
 * retry, leaving both steps, incomplete inputs, and stale responses. This
 * guards the render window between a state change and the debounced quote
 * effect re-requesting — an OLD successful quote whose inputs no longer match
 * current state can never enable Continue.
 */

function makeQuote(overrides: Partial<QuoteResult> = {}): QuoteResult {
  return {
    ok: true,
    lines: [],
    subtotalCents: 2950,
    depositRequiredCents: 1475,
    grandTotalCents: 2950,
    remainingBalanceCents: 2950,
    hasUnresolvedRules: false,
    unresolvedNotes: [],
    ...overrides,
  };
}

const BASE_INPUT = {
  sundayServiceId: "svc-1",
  seatingTimeId: "seat-1",
  guests: [
    {
      guestIndex: 0,
      category: "adult",
      name: "Guest 1",
      packageId: "pkg-1",
      included: [],
      addons: [],
    },
  ],
  platters: [],
};

const CHANGED_INPUT = {
  ...BASE_INPUT,
  seatingTimeId: "seat-2",
};

describe("isMealsStepReady readiness (production function)", () => {
  it("passes with a current successful resolved quote matching inputs", () => {
    const hash = computeQuoteInputHash(BASE_INPUT);
    expect(isMealsStepReady(true, makeQuote(), false, null, hash, hash)).toBe(true);
  });

  it("blocks when quote is missing", () => {
    const hash = computeQuoteInputHash(BASE_INPUT);
    expect(isMealsStepReady(true, null, false, null, null, hash)).toBe(false);
  });

  it("blocks while quote is loading", () => {
    const hash = computeQuoteInputHash(BASE_INPUT);
    expect(isMealsStepReady(true, makeQuote(), true, null, hash, hash)).toBe(false);
  });

  it("blocks when quote errored (ok:false)", () => {
    const hash = computeQuoteInputHash(BASE_INPUT);
    const err = makeQuote({ ok: false, error: "couldn't calculate" });
    expect(isMealsStepReady(true, err, false, null, null, hash)).toBe(false);
  });

  it("blocks when quote has unresolved pricing rules", () => {
    const hash = computeQuoteInputHash(BASE_INPUT);
    const unresolved = makeQuote({
      hasUnresolvedRules: true,
      unresolvedNotes: ["Child pricing not configured"],
    });
    expect(isMealsStepReady(true, unresolved, false, null, hash, hash)).toBe(false);
  });

  it("blocks when meals are incomplete even with a good quote", () => {
    const hash = computeQuoteInputHash(BASE_INPUT);
    expect(isMealsStepReady(false, makeQuote(), false, null, hash, hash)).toBe(false);
  });

  it("blocks when quoteError is present even if quote.ok", () => {
    const hash = computeQuoteInputHash(BASE_INPUT);
    expect(isMealsStepReady(true, makeQuote(), false, "network error", null, hash)).toBe(false);
  });

  it("blocks a previous successful quote after inputs change (stale)", () => {
    // The old quote was obtained for BASE_INPUT but current inputs changed to
    // CHANGED_INPUT. The quoteInputHash (from the old quote) does NOT match
    // the currentInputHash — Continue must be blocked.
    const oldHash = computeQuoteInputHash(BASE_INPUT);
    const currentHash = computeQuoteInputHash(CHANGED_INPUT);
    expect(oldHash).not.toBe(currentHash);
    expect(isMealsStepReady(true, makeQuote(), false, null, oldHash, currentHash)).toBe(false);
  });

  it("passes when the fresh successful quote matches current inputs after change", () => {
    // After the quote effect re-requests for the changed inputs, both
    // quoteInputHash and currentInputHash match CHANGED_INPUT.
    const currentHash = computeQuoteInputHash(CHANGED_INPUT);
    expect(isMealsStepReady(true, makeQuote(), false, null, currentHash, currentHash)).toBe(true);
  });

  it("blocks when currentInputHash is null (incomplete inputs)", () => {
    const oldHash = computeQuoteInputHash(BASE_INPUT);
    expect(isMealsStepReady(true, makeQuote(), false, null, oldHash, null)).toBe(false);
  });

  it("blocks when quoteInputHash is null (retry cleared it, no fresh quote yet)", () => {
    const hash = computeQuoteInputHash(BASE_INPUT);
    expect(isMealsStepReady(true, makeQuote(), false, null, null, hash)).toBe(false);
  });

  it("0% and 100% deposit quotes still pass readiness with matching inputs", () => {
    const hash = computeQuoteInputHash(BASE_INPUT);
    expect(
      isMealsStepReady(
        true,
        makeQuote({ depositRequiredCents: 0, remainingBalanceCents: 2950 }),
        false,
        null,
        hash,
        hash,
      ),
    ).toBe(true);
    expect(
      isMealsStepReady(
        true,
        makeQuote({ depositRequiredCents: 2950, remainingBalanceCents: 2950 }),
        false,
        null,
        hash,
        hash,
      ),
    ).toBe(true);
  });
});

describe("computeQuoteInputHash", () => {
  it("is stable for the same inputs", () => {
    expect(computeQuoteInputHash(BASE_INPUT)).toBe(computeQuoteInputHash(BASE_INPUT));
  });

  it("differs when inputs change", () => {
    expect(computeQuoteInputHash(BASE_INPUT)).not.toBe(computeQuoteInputHash(CHANGED_INPUT));
  });

  it("is order-independent for top-level keys (canonical sort)", () => {
    const a = { sundayServiceId: "s1", seatingTimeId: "t1", guests: [], platters: [] };
    const b = { seatingTimeId: "t1", guests: [], platters: [], sundayServiceId: "s1" };
    expect(computeQuoteInputHash(a)).toBe(computeQuoteInputHash(b));
  });

  it("returns a string prefixed qih_", () => {
    expect(computeQuoteInputHash(BASE_INPUT).startsWith("qih_")).toBe(true);
  });
});
