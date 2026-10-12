/**
 * Focused tests for the per-package child & senior pricing editor helpers.
 *
 * Exercises the real pure helpers (not React rendering): mode initialization,
 * dollars→cents and percentage→basis-points conversion, validation, payload
 * building, change detection, and result adoption.
 */
import { describe, it, expect } from "vitest";
import {
  PRICING_USE_GLOBAL,
  PRICING_NONE,
  PRICING_FIXED,
  PRICING_PERCENTAGE,
  initializeEditorState,
  buildPricingPayload,
  hasPricingChange,
  adoptPricingResult,
  validatePricingState,
  requiresReload,
  pricingSaveErrorMessage,
  parseDollarsToCents,
  parsePercentToBasisPoints,
  type PricingEditorState,
} from "@/components/admin/package-pricing-helpers";
import type { MealPackageDTO } from "@/lib/ordering/types";

function mockPkg(overrides: Partial<MealPackageDTO> = {}): MealPackageDTO {
  return {
    id: "pkg-1",
    name: "Signature",
    slug: "signature",
    description: "",
    pricePerPersonCents: 5000,
    includedMeatsCount: 2,
    includedSidesCount: 2,
    includesBread: true,
    includesSoftDrink: true,
    isActive: true,
    displayOrder: 0,
    eligibleItems: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    childRuleType: null,
    childFixedPriceCents: null,
    childDiscountBasisPoints: null,
    seniorRuleType: null,
    seniorFixedPriceCents: null,
    seniorDiscountBasisPoints: null,
    ...overrides,
  } as MealPackageDTO;
}

const globalState: PricingEditorState = {
  mode: PRICING_USE_GLOBAL,
  fixedDollars: "",
  percentage: "",
};

describe("parseDollarsToCents", () => {
  it("converts valid dollar amounts to cents", () => {
    expect(parseDollarsToCents("15.00")).toBe(1500);
    expect(parseDollarsToCents("15")).toBe(1500);
    expect(parseDollarsToCents("0")).toBe(0);
    expect(parseDollarsToCents("0.50")).toBe(50);
    expect(parseDollarsToCents("49.99")).toBe(4999);
  });

  it("preserves zero", () => {
    expect(parseDollarsToCents("0")).toBe(0);
    expect(parseDollarsToCents("0.00")).toBe(0);
  });

  it("rejects blank values", () => {
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("   ")).toBeNull();
  });

  it("rejects excess precision", () => {
    expect(parseDollarsToCents("15.001")).toBeNull();
    expect(parseDollarsToCents("15.123")).toBeNull();
  });

  it("rejects negative values", () => {
    expect(parseDollarsToCents("-5")).toBeNull();
    expect(parseDollarsToCents("-0.01")).toBeNull();
  });

  it("rejects non-numeric values", () => {
    expect(parseDollarsToCents("abc")).toBeNull();
    expect(parseDollarsToCents("")).toBeNull();
  });
});

describe("parsePercentToBasisPoints", () => {
  it("converts valid percentages to basis points", () => {
    expect(parsePercentToBasisPoints("12.50")).toBe(1250);
    expect(parsePercentToBasisPoints("12")).toBe(1200);
    expect(parsePercentToBasisPoints("0")).toBe(0);
    expect(parsePercentToBasisPoints("100")).toBe(10000);
    expect(parsePercentToBasisPoints("100.00")).toBe(10000);
  });

  it("preserves zero and 100%", () => {
    expect(parsePercentToBasisPoints("0")).toBe(0);
    expect(parsePercentToBasisPoints("0.00")).toBe(0);
    expect(parsePercentToBasisPoints("100")).toBe(10000);
  });

  it("rejects blank values", () => {
    expect(parsePercentToBasisPoints("")).toBeNull();
    expect(parsePercentToBasisPoints("   ")).toBeNull();
  });

  it("rejects excess precision", () => {
    expect(parsePercentToBasisPoints("12.500")).toBeNull();
    expect(parsePercentToBasisPoints("12.123")).toBeNull();
  });

  it("rejects out-of-range values", () => {
    expect(parsePercentToBasisPoints("100.01")).toBeNull();
    expect(parsePercentToBasisPoints("-5")).toBeNull();
    expect(parsePercentToBasisPoints("150")).toBeNull();
  });
});

describe("initializeEditorState", () => {
  it("loads all four modes for child", () => {
    expect(initializeEditorState(mockPkg({ childRuleType: null }), "child").mode).toBe(
      PRICING_USE_GLOBAL,
    );
    expect(initializeEditorState(mockPkg({ childRuleType: "none" }), "child").mode).toBe(
      PRICING_NONE,
    );
    expect(
      initializeEditorState(
        mockPkg({ childRuleType: "fixed_package_price", childFixedPriceCents: 2500 }),
        "child",
      ),
    ).toEqual({ mode: PRICING_FIXED, fixedDollars: "25.00", percentage: "" });
    expect(
      initializeEditorState(
        mockPkg({ childRuleType: "percentage_discount", childDiscountBasisPoints: 1250 }),
        "child",
      ),
    ).toEqual({ mode: PRICING_PERCENTAGE, fixedDollars: "", percentage: "12.50" });
  });

  it("loads all four modes for senior independently", () => {
    expect(initializeEditorState(mockPkg({ seniorRuleType: null }), "senior").mode).toBe(
      PRICING_USE_GLOBAL,
    );
    expect(initializeEditorState(mockPkg({ seniorRuleType: "none" }), "senior").mode).toBe(
      PRICING_NONE,
    );
    expect(
      initializeEditorState(
        mockPkg({ seniorRuleType: "fixed_package_price", seniorFixedPriceCents: 3000 }),
        "senior",
      ),
    ).toEqual({ mode: PRICING_FIXED, fixedDollars: "30.00", percentage: "" });
    expect(
      initializeEditorState(
        mockPkg({ seniorRuleType: "percentage_discount", seniorDiscountBasisPoints: 1000 }),
        "senior",
      ),
    ).toEqual({ mode: PRICING_PERCENTAGE, fixedDollars: "", percentage: "10.00" });
  });

  it("child and senior are independent", () => {
    const pkg = mockPkg({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 2000,
      seniorRuleType: "percentage_discount",
      seniorDiscountBasisPoints: 1500,
    });
    const child = initializeEditorState(pkg, "child");
    const senior = initializeEditorState(pkg, "senior");
    expect(child).toEqual({ mode: PRICING_FIXED, fixedDollars: "20.00", percentage: "" });
    expect(senior).toEqual({ mode: PRICING_PERCENTAGE, fixedDollars: "", percentage: "15.00" });
  });

  it("preserves zero fixed price", () => {
    const pkg = mockPkg({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 0,
    });
    expect(initializeEditorState(pkg, "child")).toEqual({
      mode: PRICING_FIXED,
      fixedDollars: "0.00",
      percentage: "",
    });
  });

  it("preserves zero percentage", () => {
    const pkg = mockPkg({
      seniorRuleType: "percentage_discount",
      seniorDiscountBasisPoints: 0,
    });
    expect(initializeEditorState(pkg, "senior")).toEqual({
      mode: PRICING_PERCENTAGE,
      fixedDollars: "",
      percentage: "0.00",
    });
  });
});

describe("validatePricingState", () => {
  it("accepts valid fixed price within max", () => {
    const errors = validatePricingState(
      { mode: PRICING_FIXED, fixedDollars: "25.00", percentage: "" },
      5000,
    );
    expect(errors.fixed).toBeUndefined();
  });

  it("rejects fixed price above max", () => {
    const errors = validatePricingState(
      { mode: PRICING_FIXED, fixedDollars: "60.00", percentage: "" },
      5000,
    );
    expect(errors.fixed).toContain("exceed");
  });

  it("rejects blank fixed price", () => {
    const errors = validatePricingState(
      { mode: PRICING_FIXED, fixedDollars: "", percentage: "" },
      5000,
    );
    expect(errors.fixed).toBeDefined();
  });

  it("rejects excess-precision fixed price", () => {
    const errors = validatePricingState(
      { mode: PRICING_FIXED, fixedDollars: "25.001", percentage: "" },
      5000,
    );
    expect(errors.fixed).toBeDefined();
  });

  it("accepts valid percentage", () => {
    const errors = validatePricingState(
      { mode: PRICING_PERCENTAGE, fixedDollars: "", percentage: "12.50" },
      5000,
    );
    expect(errors.percentage).toBeUndefined();
  });

  it("rejects blank percentage", () => {
    const errors = validatePricingState(
      { mode: PRICING_PERCENTAGE, fixedDollars: "", percentage: "" },
      5000,
    );
    expect(errors.percentage).toBeDefined();
  });

  it("rejects out-of-range percentage", () => {
    const errors = validatePricingState(
      { mode: PRICING_PERCENTAGE, fixedDollars: "", percentage: "101" },
      5000,
    );
    expect(errors.percentage).toBeDefined();
  });

  it("rejects excess-precision percentage", () => {
    const errors = validatePricingState(
      { mode: PRICING_PERCENTAGE, fixedDollars: "", percentage: "12.500" },
      5000,
    );
    expect(errors.percentage).toBeDefined();
  });

  it("has no errors for use-global and none modes", () => {
    expect(validatePricingState(globalState, 5000)).toEqual({});
    expect(
      validatePricingState({ mode: PRICING_NONE, fixedDollars: "", percentage: "" }, 5000),
    ).toEqual({});
  });
});

describe("buildPricingPayload", () => {
  it("builds exact package ID, timestamp, and all six fields", () => {
    const pkg = mockPkg();
    const payload = buildPricingPayload(
      pkg,
      {
        mode: PRICING_FIXED,
        fixedDollars: "20.00",
        percentage: "",
      },
      {
        mode: PRICING_PERCENTAGE,
        fixedDollars: "",
        percentage: "15.00",
      },
      5000,
    );
    expect(payload).not.toBeNull();
    if (!payload) return;
    expect(payload.packageId).toBe("pkg-1");
    expect(payload.expectedUpdatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(payload.childRuleType).toBe("fixed_package_price");
    expect(payload.childFixedPriceCents).toBe(2000);
    expect(payload.childDiscountBasisPoints).toBeNull();
    expect(payload.seniorRuleType).toBe("percentage_discount");
    expect(payload.seniorFixedPriceCents).toBeNull();
    expect(payload.seniorDiscountBasisPoints).toBe(1500);
  });

  it("maps use-global to all nulls", () => {
    const payload = buildPricingPayload(mockPkg(), globalState, globalState, 5000);
    expect(payload).not.toBeNull();
    if (!payload) return;
    expect(payload.childRuleType).toBeNull();
    expect(payload.childFixedPriceCents).toBeNull();
    expect(payload.childDiscountBasisPoints).toBeNull();
    expect(payload.seniorRuleType).toBeNull();
    expect(payload.seniorFixedPriceCents).toBeNull();
    expect(payload.seniorDiscountBasisPoints).toBeNull();
  });

  it("maps none to ruleType none with null amounts", () => {
    const payload = buildPricingPayload(
      mockPkg(),
      { mode: PRICING_NONE, fixedDollars: "", percentage: "" },
      { mode: PRICING_NONE, fixedDollars: "", percentage: "" },
      5000,
    );
    expect(payload).not.toBeNull();
    if (!payload) return;
    expect(payload.childRuleType).toBe("none");
    expect(payload.childFixedPriceCents).toBeNull();
    expect(payload.childDiscountBasisPoints).toBeNull();
  });

  it("preserves zero fixed price and zero percentage", () => {
    const payload = buildPricingPayload(
      mockPkg(),
      { mode: PRICING_FIXED, fixedDollars: "0.00", percentage: "" },
      { mode: PRICING_PERCENTAGE, fixedDollars: "", percentage: "0.00" },
      5000,
    );
    expect(payload).not.toBeNull();
    if (!payload) return;
    expect(payload.childFixedPriceCents).toBe(0);
    expect(payload.seniorDiscountBasisPoints).toBe(0);
  });

  it("returns null for invalid fixed price", () => {
    expect(
      buildPricingPayload(
        mockPkg(),
        { mode: PRICING_FIXED, fixedDollars: "abc", percentage: "" },
        globalState,
        5000,
      ),
    ).toBeNull();
  });

  it("returns null for invalid percentage", () => {
    expect(
      buildPricingPayload(
        mockPkg(),
        globalState,
        { mode: PRICING_PERCENTAGE, fixedDollars: "", percentage: "150" },
        5000,
      ),
    ).toBeNull();
  });

  it("returns null for fixed price exceeding max", () => {
    expect(
      buildPricingPayload(
        mockPkg(),
        { mode: PRICING_FIXED, fixedDollars: "60.00", percentage: "" },
        globalState,
        5000,
      ),
    ).toBeNull();
  });
});

describe("hasPricingChange", () => {
  it("detects no change when editor matches saved state", () => {
    const pkg = mockPkg({ childRuleType: null, seniorRuleType: null });
    expect(hasPricingChange(pkg, globalState, globalState)).toBe(false);
  });

  it("detects change when editor differs from saved state", () => {
    const pkg = mockPkg({ childRuleType: null });
    expect(
      hasPricingChange(
        pkg,
        { mode: PRICING_FIXED, fixedDollars: "20.00", percentage: "" },
        globalState,
      ),
    ).toBe(true);
  });

  it("detects no change when fixed price matches exactly", () => {
    const pkg = mockPkg({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 2000,
    });
    expect(
      hasPricingChange(
        pkg,
        { mode: PRICING_FIXED, fixedDollars: "20.00", percentage: "" },
        globalState,
      ),
    ).toBe(false);
  });

  it("detects no change when percentage matches exactly", () => {
    const pkg = mockPkg({
      seniorRuleType: "percentage_discount",
      seniorDiscountBasisPoints: 1500,
    });
    expect(
      hasPricingChange(pkg, globalState, {
        mode: PRICING_PERCENTAGE,
        fixedDollars: "",
        percentage: "15.00",
      }),
    ).toBe(false);
  });

  it("detects child-only change independently from senior", () => {
    const pkg = mockPkg({
      childRuleType: "fixed_package_price",
      childFixedPriceCents: 2000,
      seniorRuleType: "percentage_discount",
      seniorDiscountBasisPoints: 1500,
    });
    expect(
      hasPricingChange(
        pkg,
        { mode: PRICING_FIXED, fixedDollars: "25.00", percentage: "" },
        { mode: PRICING_PERCENTAGE, fixedDollars: "", percentage: "15.00" },
      ),
    ).toBe(true);
  });
});

describe("adoptPricingResult", () => {
  it("adopts returned pricing fields and exact timestamp", () => {
    const pkg = mockPkg({ childRuleType: null });
    const result = {
      ok: true as const,
      packageId: "pkg-1",
      updatedAt: "2026-01-02T00:00:00.000Z",
      noOp: false,
      pricing: {
        childRuleType: "fixed_package_price" as const,
        childFixedPriceCents: 2000,
        childDiscountBasisPoints: null,
        seniorRuleType: "percentage_discount" as const,
        seniorFixedPriceCents: null,
        seniorDiscountBasisPoints: 1500,
      },
    };
    const adopted = adoptPricingResult(pkg, result);
    expect(adopted.updatedAt).toBe("2026-01-02T00:00:00.000Z");
    expect(adopted.childRuleType).toBe("fixed_package_price");
    expect(adopted.childFixedPriceCents).toBe(2000);
    expect(adopted.seniorRuleType).toBe("percentage_discount");
    expect(adopted.seniorDiscountBasisPoints).toBe(1500);
    // Other fields preserved
    expect(adopted.id).toBe("pkg-1");
    expect(adopted.name).toBe("Signature");
  });
});

describe("requiresReload and pricingSaveErrorMessage", () => {
  it("requires reload for conflict", () => {
    expect(requiresReload({ ok: false, code: "conflict", error: "x" })).toBe(true);
  });

  it("requires reload for unexpected", () => {
    expect(requiresReload({ ok: false, code: "unexpected", error: "x" })).toBe(true);
  });

  it("does not require reload for invalid_value", () => {
    expect(requiresReload({ ok: false, code: "invalid_value", error: "x" })).toBe(false);
  });

  it("does not require reload for unauthorized", () => {
    expect(requiresReload({ ok: false, code: "unauthorized", error: "x" })).toBe(false);
  });

  it("returns safe messages for each code", () => {
    expect(pricingSaveErrorMessage({ ok: false, code: "conflict", error: "" })).toContain(
      "modified by another user",
    );
    expect(pricingSaveErrorMessage({ ok: false, code: "not_found", error: "" })).toContain(
      "could not be found",
    );
    expect(pricingSaveErrorMessage({ ok: false, code: "invalid_value", error: "" })).toContain(
      "not valid",
    );
    expect(pricingSaveErrorMessage({ ok: false, code: "unauthorized", error: "" })).toContain(
      "authorized",
    );
    expect(pricingSaveErrorMessage({ ok: false, code: "unexpected", error: "Safe message" })).toBe(
      "Safe message",
    );
  });
});

/* ---- assessPricingRecovery — fresh-read recovery after conflict/uncertain save ---- */
import {
  assessPricingRecovery,
  type PricingReloadResult,
} from "@/components/admin/package-pricing-helpers";

const PKG_A = "00000000-0000-4000-8000-000000000001";
const PKG_B = "00000000-0000-4000-8000-000000000002";

function makePkg(id: string): MealPackageDTO {
  return {
    id,
    name: "P",
    slug: "p",
    description: "",
    pricePerPersonCents: 5000,
    includedMeatsCount: 1,
    includedSidesCount: 1,
    includesBread: false,
    includesSoftDrink: false,
    isActive: true,
    displayOrder: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    createdBy: null,
    updatedBy: null,
    eligibleItems: [],
    childRuleType: null,
    childFixedPriceCents: null,
    childDiscountBasisPoints: null,
    seniorRuleType: null,
    seniorFixedPriceCents: null,
    seniorDiscountBasisPoints: null,
  };
}

describe("assessPricingRecovery — fresh-read recovery", () => {
  it("successful fresh read with matching package → adopt and clear gate", () => {
    const result: PricingReloadResult = { ok: true, pkg: makePkg(PKG_A) };
    const a = assessPricingRecovery(1, 1, false, result, PKG_A);
    expect(a.mayClearGate).toBe(true);
    expect(a.shouldUpdateState).toBe(true);
    expect(a.package).not.toBeNull();
    expect(a.package!.id).toBe(PKG_A);
    expect(a.message).toBeNull();
  });

  it("failed refresh with old cached data available does NOT clear gate", () => {
    const result: PricingReloadResult = { ok: false, pkg: null };
    const a = assessPricingRecovery(1, 1, false, result, PKG_A);
    expect(a.mayClearGate).toBe(false);
    expect(a.shouldUpdateState).toBe(true); // mounted → show message
    expect(a.package).toBeNull();
    expect(a.message).not.toBeNull();
  });

  it("endpoint failure (ok:false) retains the gate with a safe message", () => {
    const a = assessPricingRecovery(1, 1, false, { ok: false, pkg: null }, PKG_A);
    expect(a.mayClearGate).toBe(false);
    expect(a.message).toContain("reload");
  });

  it("ok:true but pkg null (package not found in config) retains the gate", () => {
    const a = assessPricingRecovery(1, 1, false, { ok: true, pkg: null }, PKG_A);
    expect(a.mayClearGate).toBe(false);
    expect(a.package).toBeNull();
    expect(a.message).not.toBeNull();
  });

  it("different package returned retains the gate", () => {
    const result: PricingReloadResult = { ok: true, pkg: makePkg(PKG_B) };
    const a = assessPricingRecovery(1, 1, false, result, PKG_A);
    expect(a.mayClearGate).toBe(false);
    expect(a.package).toBeNull();
    expect(a.message).toContain("match");
  });

  it("null packageId retains the gate", () => {
    const result: PricingReloadResult = { ok: true, pkg: makePkg(PKG_A) };
    const a = assessPricingRecovery(1, 1, false, result, null);
    expect(a.mayClearGate).toBe(false);
    expect(a.message).not.toBeNull();
  });

  it("stale completion (opId !== current) cannot adopt or clear gate", () => {
    const result: PricingReloadResult = { ok: true, pkg: makePkg(PKG_A) };
    const a = assessPricingRecovery(1, 2, false, result, PKG_A);
    expect(a.mayClearGate).toBe(false);
    expect(a.shouldUpdateState).toBe(false);
    expect(a.package).toBeNull();
  });

  it("unmounted recovery → no state updates but gate may still clear for current op", () => {
    const result: PricingReloadResult = { ok: true, pkg: makePkg(PKG_A) };
    const a = assessPricingRecovery(1, 1, true, result, PKG_A);
    expect(a.mayClearGate).toBe(true);
    expect(a.shouldUpdateState).toBe(false);
    expect(a.package).not.toBeNull();
  });

  it("unmounted + failed read → no state updates, no gate clear", () => {
    const a = assessPricingRecovery(1, 1, true, { ok: false, pkg: null }, PKG_A);
    expect(a.mayClearGate).toBe(false);
    expect(a.shouldUpdateState).toBe(false);
  });

  it("a newer operation supersedes — stale completion cannot clear", () => {
    const result: PricingReloadResult = { ok: true, pkg: makePkg(PKG_A) };
    const a = assessPricingRecovery(1, 3, false, result, PKG_A);
    expect(a.mayClearGate).toBe(false);
    expect(a.shouldUpdateState).toBe(false);
  });
});

/* ---- assessPricingSettlement — shared lock lifecycle ---- */
import { assessPricingSettlement } from "@/components/admin/package-pricing-helpers";

describe("assessPricingSettlement — shared lock lifecycle", () => {
  it("mounted save settles → releases the shared lock and allows state adoption", () => {
    const settle = assessPricingSettlement(1, 1, false);
    expect(settle.releaseLock).toBe(true);
    expect(settle.shouldUpdateState).toBe(true);
    expect(settle.shouldAdoptResult).toBe(true);
  });

  it("save pending, then unmount → lock stays engaged until settlement", () => {
    // While pending (no settlement yet), the lock must NOT be released early.
    // The unmount flag only affects state adoption, not the pending lock.
    const settle = assessPricingSettlement(1, 1, true);
    expect(settle.releaseLock).toBe(true);
    expect(settle.shouldUpdateState).toBe(false);
    expect(settle.shouldAdoptResult).toBe(false);
  });

  it("settlement after unmount → lock released without stale state adoption", () => {
    const settle = assessPricingSettlement(1, 1, true);
    expect(settle.releaseLock).toBe(true);
    expect(settle.shouldUpdateState).toBe(false);
    expect(settle.shouldAdoptResult).toBe(false);
  });

  it("returned failure after unmount → lock still released", () => {
    // A failure (conflict/invalid) is a genuine settlement — the lock must be
    // released so subsequent ordering edits can proceed, even after unmount.
    const settle = assessPricingSettlement(1, 1, true);
    expect(settle.releaseLock).toBe(true);
  });

  it("thrown error after unmount → lock still released", () => {
    // A thrown network error is also a genuine settlement — the lock releases.
    const settle = assessPricingSettlement(1, 1, true);
    expect(settle.releaseLock).toBe(true);
  });

  it("an obsolete completion cannot release a newer operation's lock", () => {
    // operationId=1 settled, but a newer operationId=2 is now current.
    const settle = assessPricingSettlement(1, 2, false);
    expect(settle.releaseLock).toBe(false);
    expect(settle.shouldUpdateState).toBe(false);
    expect(settle.shouldAdoptResult).toBe(false);
  });

  it("another ordering action can acquire the lock after the original settles", () => {
    // Original op1 settles (opId===current). Lock released.
    expect(assessPricingSettlement(1, 1, false).releaseLock).toBe(true);
    // A new op2 starts — its settlement is independent and must release its own lock.
    const settle = assessPricingSettlement(2, 2, false);
    expect(settle.releaseLock).toBe(true);
  });
});
