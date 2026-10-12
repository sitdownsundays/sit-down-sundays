import { describe, it, expect } from "vitest";
import {
  basisPointsToPercentString,
  parsePercentString,
  taxOnGratuityToSelectValue,
  selectValueToTaxOnGratuity,
  timezoneToSelectValue,
  timezoneSelectValueToString,
  policyToFormValues,
  buildPaymentPolicyUpdatePayload,
  type PaymentPolicyFormValues,
  TIMEZONE_NOT_SET,
  TIMEZONE_CUSTOM,
  TAX_ON_GRATUITY_NOT_CONFIGURED,
  TAX_ON_GRATUITY_YES,
  TAX_ON_GRATUITY_NO,
} from "@/components/admin/payment-policy-form-helpers";
import type { PaymentPolicyDTO } from "@/lib/sundays/types";

const COMMON_TZ = ["America/Chicago", "America/New_York"];

/** A complete, valid base policy DTO with all new fields null. */
function basePolicy(overrides: Partial<PaymentPolicyDTO> = {}): PaymentPolicyDTO {
  return {
    depositPercent: 50,
    defaultBalanceDeadlineHours: 72,
    restaurantTimezone: null,
    taxRateBasisPoints: null,
    gratuityRateBasisPoints: null,
    taxOnGratuity: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

/** A complete, valid base form with all tax/gratuity fields blank. */
function baseForm(overrides: Partial<PaymentPolicyFormValues> = {}): PaymentPolicyFormValues {
  return {
    expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
    depositPercent: "50",
    deadlineHours: "72",
    timezone: TIMEZONE_NOT_SET,
    customTimezone: "",
    taxPercent: "",
    gratuityPercent: "",
    taxOnGratuity: TAX_ON_GRATUITY_NOT_CONFIGURED,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// basisPointsToPercentString
// ---------------------------------------------------------------------------
describe("basisPointsToPercentString", () => {
  it("null → blank", () => {
    expect(basisPointsToPercentString(null)).toBe("");
  });

  it("0 → '0' (preserves zero)", () => {
    expect(basisPointsToPercentString(0)).toBe("0");
  });

  it("1000 → '10'", () => {
    expect(basisPointsToPercentString(1000)).toBe("10");
  });

  it("1800 → '18'", () => {
    expect(basisPointsToPercentString(1800)).toBe("18");
  });

  it("1050 → '10.5'", () => {
    expect(basisPointsToPercentString(1050)).toBe("10.5");
  });

  it("1055 → '10.55'", () => {
    expect(basisPointsToPercentString(1055)).toBe("10.55");
  });

  it("1 → '0.01'", () => {
    expect(basisPointsToPercentString(1)).toBe("0.01");
  });

  it("10000 → '100'", () => {
    expect(basisPointsToPercentString(10000)).toBe("100");
  });
});

// ---------------------------------------------------------------------------
// parsePercentString
// ---------------------------------------------------------------------------
describe("parsePercentString", () => {
  it("blank → null (not zero)", () => {
    expect(parsePercentString("")).toEqual({ ok: true, basisPoints: null });
  });

  it("whitespace-only → null", () => {
    expect(parsePercentString("   ")).toEqual({ ok: true, basisPoints: null });
  });

  it("'10' → 1000", () => {
    expect(parsePercentString("10")).toEqual({ ok: true, basisPoints: 1000 });
  });

  it("'18' → 1800", () => {
    expect(parsePercentString("18")).toEqual({ ok: true, basisPoints: 1800 });
  });

  it("'10.5' → 1050", () => {
    expect(parsePercentString("10.5")).toEqual({ ok: true, basisPoints: 1050 });
  });

  it("'10.55' → 1055", () => {
    expect(parsePercentString("10.55")).toEqual({ ok: true, basisPoints: 1055 });
  });

  it("'0' → 0 (preserves zero)", () => {
    expect(parsePercentString("0")).toEqual({ ok: true, basisPoints: 0 });
  });

  it("'0.01' → 1", () => {
    expect(parsePercentString("0.01")).toEqual({ ok: true, basisPoints: 1 });
  });

  it("'100' → 10000", () => {
    expect(parsePercentString("100")).toEqual({ ok: true, basisPoints: 10000 });
  });

  it("'100.00' → 10000", () => {
    expect(parsePercentString("100.00")).toEqual({ ok: true, basisPoints: 10000 });
  });

  it("trims surrounding whitespace", () => {
    expect(parsePercentString("  10  ")).toEqual({ ok: true, basisPoints: 1000 });
  });

  it("rejects excess precision (3 decimal places)", () => {
    const result = parsePercentString("10.555");
    expect(result.ok).toBe(false);
  });

  it("rejects out-of-range (> 100)", () => {
    const result = parsePercentString("100.01");
    expect(result.ok).toBe(false);
  });

  it("rejects negative values", () => {
    const result = parsePercentString("-1");
    expect(result.ok).toBe(false);
  });

  it("rejects non-numeric input", () => {
    const result = parsePercentString("abc");
    expect(result.ok).toBe(false);
  });

  it("rejects incomplete decimal ('10.')", () => {
    const result = parsePercentString("10.");
    expect(result.ok).toBe(false);
  });

  it("rejects leading-dot without integer ('.5')", () => {
    const result = parsePercentString(".5");
    expect(result.ok).toBe(false);
  });

  it("does not round excess precision silently", () => {
    // 10.555 would round to 1056 if silently rounded; instead rejected.
    const result = parsePercentString("10.555");
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// taxOnGratuityToSelectValue / selectValueToTaxOnGratuity
// ---------------------------------------------------------------------------
describe("taxOnGratuity select conversion", () => {
  it("null → not_configured", () => {
    expect(taxOnGratuityToSelectValue(null)).toBe(TAX_ON_GRATUITY_NOT_CONFIGURED);
  });

  it("true → yes", () => {
    expect(taxOnGratuityToSelectValue(true)).toBe(TAX_ON_GRATUITY_YES);
  });

  it("false → no (preserves false)", () => {
    expect(taxOnGratuityToSelectValue(false)).toBe(TAX_ON_GRATUITY_NO);
  });

  it("not_configured → null", () => {
    expect(selectValueToTaxOnGratuity(TAX_ON_GRATUITY_NOT_CONFIGURED)).toBeNull();
  });

  it("yes → true", () => {
    expect(selectValueToTaxOnGratuity(TAX_ON_GRATUITY_YES)).toBe(true);
  });

  it("no → false", () => {
    expect(selectValueToTaxOnGratuity(TAX_ON_GRATUITY_NO)).toBe(false);
  });

  it("unknown value → null (safe default)", () => {
    expect(selectValueToTaxOnGratuity("something_else")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Timezone sentinel conversion
// ---------------------------------------------------------------------------
describe("timezone sentinel conversion", () => {
  it("null → not-set sentinel", () => {
    expect(timezoneToSelectValue(null, COMMON_TZ)).toEqual({
      selectValue: TIMEZONE_NOT_SET,
      customTimezone: "",
    });
  });

  it("common timezone → direct select value", () => {
    expect(timezoneToSelectValue("America/Chicago", COMMON_TZ)).toEqual({
      selectValue: "America/Chicago",
      customTimezone: "",
    });
  });

  it("uncommon timezone → custom sentinel + customTimezone", () => {
    expect(timezoneToSelectValue("Europe/London", COMMON_TZ)).toEqual({
      selectValue: TIMEZONE_CUSTOM,
      customTimezone: "Europe/London",
    });
  });

  it("not-set sentinel → null", () => {
    expect(timezoneSelectValueToString(TIMEZONE_NOT_SET, "")).toBeNull();
  });

  it("direct timezone → string", () => {
    expect(timezoneSelectValueToString("America/Chicago", "")).toBe("America/Chicago");
  });

  it("custom + non-empty → string", () => {
    expect(timezoneSelectValueToString(TIMEZONE_CUSTOM, "Europe/London")).toBe("Europe/London");
  });

  it("custom + whitespace-only → null", () => {
    expect(timezoneSelectValueToString(TIMEZONE_CUSTOM, "   ")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// policyToFormValues
// ---------------------------------------------------------------------------
describe("policyToFormValues", () => {
  it("all-null policy → blank/sentinel form values", () => {
    const form = policyToFormValues(basePolicy(), COMMON_TZ);
    expect(form.depositPercent).toBe("50");
    expect(form.deadlineHours).toBe("72");
    expect(form.timezone).toBe(TIMEZONE_NOT_SET);
    expect(form.customTimezone).toBe("");
    expect(form.taxPercent).toBe("");
    expect(form.gratuityPercent).toBe("");
    expect(form.taxOnGratuity).toBe(TAX_ON_GRATUITY_NOT_CONFIGURED);
    expect(form.expectedUpdatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("configured policy → correct percentage strings", () => {
    const form = policyToFormValues(
      basePolicy({
        taxRateBasisPoints: 1000,
        gratuityRateBasisPoints: 1800,
        taxOnGratuity: true,
        restaurantTimezone: "America/Chicago",
      }),
      COMMON_TZ,
    );
    expect(form.taxPercent).toBe("10");
    expect(form.gratuityPercent).toBe("18");
    expect(form.taxOnGratuity).toBe(TAX_ON_GRATUITY_YES);
    expect(form.timezone).toBe("America/Chicago");
  });

  it("preserves zero and false", () => {
    const form = policyToFormValues(
      basePolicy({
        taxRateBasisPoints: 0,
        gratuityRateBasisPoints: 0,
        taxOnGratuity: false,
      }),
      COMMON_TZ,
    );
    expect(form.taxPercent).toBe("0");
    expect(form.gratuityPercent).toBe("0");
    expect(form.taxOnGratuity).toBe(TAX_ON_GRATUITY_NO);
  });

  it("custom timezone → custom sentinel", () => {
    const form = policyToFormValues(basePolicy({ restaurantTimezone: "Europe/London" }), COMMON_TZ);
    expect(form.timezone).toBe(TIMEZONE_CUSTOM);
    expect(form.customTimezone).toBe("Europe/London");
  });
});

// ---------------------------------------------------------------------------
// buildPaymentPolicyUpdatePayload
// ---------------------------------------------------------------------------
describe("buildPaymentPolicyUpdatePayload", () => {
  it("valid complete input → correct payload", () => {
    const result = buildPaymentPolicyUpdatePayload(
      baseForm({
        depositPercent: "50",
        deadlineHours: "72",
        timezone: "America/Chicago",
        taxPercent: "10",
        gratuityPercent: "18",
        taxOnGratuity: TAX_ON_GRATUITY_YES,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.expectedUpdatedAt).toBe("2026-01-01T00:00:00.000Z");
      expect(result.payload.depositPercent).toBe(50);
      expect(result.payload.defaultBalanceDeadlineHours).toBe(72);
      expect(result.payload.restaurantTimezone).toBe("America/Chicago");
      expect(result.payload.taxRateBasisPoints).toBe(1000);
      expect(result.payload.gratuityRateBasisPoints).toBe(1800);
      expect(result.payload.taxOnGratuity).toBe(true);
    }
  });

  it("blank tax/gratuity → null in payload (never zero)", () => {
    const result = buildPaymentPolicyUpdatePayload(
      baseForm({
        timezone: TIMEZONE_NOT_SET,
        taxPercent: "",
        gratuityPercent: "",
        taxOnGratuity: TAX_ON_GRATUITY_NOT_CONFIGURED,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.taxRateBasisPoints).toBeNull();
      expect(result.payload.gratuityRateBasisPoints).toBeNull();
      expect(result.payload.taxOnGratuity).toBeNull();
      expect(result.payload.restaurantTimezone).toBeNull();
    }
  });

  it("preserves zero and false exactly", () => {
    const result = buildPaymentPolicyUpdatePayload(
      baseForm({
        taxPercent: "0",
        gratuityPercent: "0",
        taxOnGratuity: TAX_ON_GRATUITY_NO,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.taxRateBasisPoints).toBe(0);
      expect(result.payload.gratuityRateBasisPoints).toBe(0);
      expect(result.payload.taxOnGratuity).toBe(false);
    }
  });

  it("custom timezone forwarded correctly", () => {
    const result = buildPaymentPolicyUpdatePayload(
      baseForm({
        timezone: TIMEZONE_CUSTOM,
        customTimezone: "Europe/London",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.restaurantTimezone).toBe("Europe/London");
    }
  });

  it("decimal percentages converted to basis points", () => {
    const result = buildPaymentPolicyUpdatePayload(
      baseForm({
        taxPercent: "8.25",
        gratuityPercent: "18.5",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.taxRateBasisPoints).toBe(825);
      expect(result.payload.gratuityRateBasisPoints).toBe(1850);
    }
  });

  it("rejects invalid deposit", () => {
    const result = buildPaymentPolicyUpdatePayload(baseForm({ depositPercent: "abc" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("Deposit must be between 0 and 100.");
    }
  });

  it("rejects invalid deadline hours", () => {
    const result = buildPaymentPolicyUpdatePayload(baseForm({ deadlineHours: "xyz" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("Balance deadline must be a whole number of hours (0–720).");
    }
  });

  it("rejects excess-precision tax percentage", () => {
    const result = buildPaymentPolicyUpdatePayload(baseForm({ taxPercent: "10.555" }));
    expect(result.ok).toBe(false);
  });

  it("rejects out-of-range gratuity percentage", () => {
    const result = buildPaymentPolicyUpdatePayload(baseForm({ gratuityPercent: "200" }));
    expect(result.ok).toBe(false);
  });

  it("collects multiple errors", () => {
    const result = buildPaymentPolicyUpdatePayload(
      baseForm({
        depositPercent: "abc",
        deadlineHours: "xyz",
        taxPercent: "10.555",
        gratuityPercent: "200",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBe(4);
    }
  });

  it("preserves original expectedUpdatedAt string", () => {
    const result = buildPaymentPolicyUpdatePayload(
      baseForm({ expectedUpdatedAt: "2026-10-10T12:30:45.123Z" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.expectedUpdatedAt).toBe("2026-10-10T12:30:45.123Z");
    }
  });
});
