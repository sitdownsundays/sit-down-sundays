/**
 * Focused tests for capacity-backed Step 1 helpers.
 *
 * These exercise the REAL production helpers in
 * src/lib/booking/wizard-helpers.ts — not copied logic.
 * Helper-level tests, NOT rendered component tests.
 */
import { describe, it, expect } from "vitest";
import {
  capacityFromOption,
  validatePartyCapacity,
  SCHEMA_PARTY_LIMIT,
  initialWizardState,
} from "@/lib/booking/wizard-helpers";
import type { CapacityAvailabilityOption } from "@/lib/reservation/capacity-availability";
import type { PublicAvailabilityOption } from "@/lib/reservation/types";
import type { BookWizardState } from "@/lib/booking/wizard-helpers";

function opt(
  availableCapacity: number,
  maxBookablePartySize: number,
  ceiling: number = maxBookablePartySize,
): CapacityAvailabilityOption {
  return {
    sundayService: { id: "svc-a", date: "2099-11-07", label: "" },
    seatingTime: { id: "seat-1", label: "12:00", startTime: "12:00", endTime: "14:30" },
    spaceName: "Grand Ballroom",
    configuredRequestCeiling: ceiling,
    restaurantTimezone: "America/Chicago",
    availableCapacity,
    maxBookablePartySize,
  };
}

describe("capacityFromOption", () => {
  it("extracts capacity fields from a capacity-backed option", () => {
    expect(capacityFromOption(opt(934, 12))).toEqual({
      availableCapacity: 934,
      maxBookablePartySize: 12,
    });
  });

  it("returns null for a plain PublicAvailabilityOption without capacity fields", () => {
    const plain: PublicAvailabilityOption = {
      sundayService: { id: "svc-a", date: "2099-11-07", label: "" },
      seatingTime: { id: "seat-1", label: "12:00", startTime: "12:00", endTime: "14:30" },
      spaceName: "Grand Ballroom",
      configuredRequestCeiling: 12,
      restaurantTimezone: "America/Chicago",
    };
    expect(capacityFromOption(plain)).toBeNull();
  });

  it("returns null for null input", () => {
    expect(capacityFromOption(null)).toBeNull();
  });

  it("returns null for negative capacity values", () => {
    expect(capacityFromOption(opt(-1, -1))).toBeNull();
  });

  it("returns null for NaN capacity values", () => {
    expect(capacityFromOption(opt(NaN, 12))).toBeNull();
  });

  it("rejects fractional capacity values", () => {
    expect(capacityFromOption(opt(934.7, 12))).toBeNull();
    expect(capacityFromOption(opt(934, 12.9))).toBeNull();
  });

  it("rejects Infinity", () => {
    expect(capacityFromOption(opt(Infinity, 12))).toBeNull();
    expect(capacityFromOption(opt(934, Infinity))).toBeNull();
  });

  it("rejects numeric strings", () => {
    expect(capacityFromOption(opt("934" as unknown as number, 12))).toBeNull();
    expect(capacityFromOption(opt(934, "12" as unknown as number))).toBeNull();
  });

  it("rejects unsafe integers", () => {
    expect(capacityFromOption(opt(Number.MAX_SAFE_INTEGER + 1, 12))).toBeNull();
    expect(capacityFromOption(opt(934, Number.MAX_SAFE_INTEGER + 1))).toBeNull();
  });

  it("rejects maxBookablePartySize exceeding availableCapacity", () => {
    expect(capacityFromOption(opt(5, 12))).toBeNull();
  });

  it("rejects maxBookablePartySize exceeding configuredRequestCeiling", () => {
    expect(capacityFromOption(opt(934, 12, 10))).toBeNull();
  });

  it("accepts zero capacity (unavailable, not missing)", () => {
    expect(capacityFromOption(opt(0, 0, 12))).toEqual({
      availableCapacity: 0,
      maxBookablePartySize: 0,
    });
  });
});

describe("validatePartyCapacity", () => {
  function state(adults: number): BookWizardState {
    return { ...initialWizardState(), adults };
  }

  it("accepts a party within the max bookable party size", () => {
    expect(
      validatePartyCapacity(state(12), { availableCapacity: 934, maxBookablePartySize: 12 }).error,
    ).toBeNull();
  });

  it("rejects a party exceeding maxBookablePartySize but within availableCapacity", () => {
    const result = validatePartyCapacity(state(13), {
      availableCapacity: 934,
      maxBookablePartySize: 12,
    });
    expect(result.error).not.toBeNull();
    expect(result.error).toMatch(/up to 12/);
  });

  it("blocks when capacity is null (missing/invalid)", () => {
    expect(validatePartyCapacity(state(2), null).error).toMatch(/could not be confirmed/i);
  });

  it("blocks when maxBookablePartySize is zero (unavailable)", () => {
    expect(
      validatePartyCapacity(state(1), { availableCapacity: 0, maxBookablePartySize: 0 }).error,
    ).toMatch(/up to 0/);
  });

  it("preserves guest counts when capacity is insufficient (no silent shrink)", () => {
    const s = state(50);
    const result = validatePartyCapacity(s, { availableCapacity: 934, maxBookablePartySize: 12 });
    expect(result.error).not.toBeNull();
    expect(s.adults).toBe(50);
  });

  it("accepts a party above 200 when within both capacity and schema limit", () => {
    expect(
      validatePartyCapacity(state(250), { availableCapacity: 500, maxBookablePartySize: 300 })
        .error,
    ).toBeNull();
  });

  it("rejects a party above the 950 schema ceiling even when physical capacity allows", () => {
    expect(
      validatePartyCapacity(state(951), { availableCapacity: 1000, maxBookablePartySize: 960 })
        .error,
    ).toMatch(/cannot exceed/i);
  });

  it("rejects non-integer counts", () => {
    const s = { ...initialWizardState(), adults: 1.5 } as BookWizardState;
    expect(
      validatePartyCapacity(s, { availableCapacity: 100, maxBookablePartySize: 100 }).error,
    ).toMatch(/whole numbers/i);
  });

  it("rejects zero guests", () => {
    expect(
      validatePartyCapacity(state(0), { availableCapacity: 100, maxBookablePartySize: 100 }).error,
    ).toMatch(/at least one guest/i);
  });
});
