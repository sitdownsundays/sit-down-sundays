/**
 * Payment policy form conversion helpers.
 *
 * Pure functions for converting between stored basis-point rates and
 * percentage display strings, and between the PaymentPolicyDTO and the
 * admin settings form state. No React, no server calls, no side effects.
 *
 * Conventions:
 * - Display percentages; store integer basis points (10% → 1000).
 * - Accept 0–100% with at most two decimal places.
 * - Blank rate fields → null (not configured), never zero.
 * - Not configured → null; Yes → true; No → false.
 * - Preserve zero and false when loading and saving.
 * - Do not prefill or automatically save the proposed rates.
 */
import type { PaymentPolicyDTO, UpdatePaymentPolicyInput } from "@/lib/sundays/types";

// ---------------------------------------------------------------------------
// Sentinel values for Radix Select (empty string is not a valid option value)
// ---------------------------------------------------------------------------
export const TIMEZONE_NOT_SET = "__none__";
export const TIMEZONE_CUSTOM = "__custom__";
export const TAX_ON_GRATUITY_NOT_CONFIGURED = "not_configured";
export const TAX_ON_GRATUITY_YES = "yes";
export const TAX_ON_GRATUITY_NO = "no";

export type TaxOnGratuitySelectValue =
  typeof TAX_ON_GRATUITY_NOT_CONFIGURED | typeof TAX_ON_GRATUITY_YES | typeof TAX_ON_GRATUITY_NO;

// ---------------------------------------------------------------------------
// Percentage ↔ basis points
// ---------------------------------------------------------------------------

/**
 * Convert stored basis points to a percentage display string.
 * null → "" (blank), 0 → "0", 1000 → "10", 1055 → "10.55".
 */
export function basisPointsToPercentString(basisPoints: number | null): string {
  if (basisPoints === null) return "";
  return (basisPoints / 100).toString();
}

/**
 * Parse a percentage display string into basis points.
 *
 * Blank → null (clear to "not configured", never zero).
 * "10" → 1000, "10.55" → 1055, "0" → 0 (valid).
 * Rejects non-numeric, out-of-range (0–100), and excess precision (>2 decimals)
 * rather than silently rounding.
 */
export function parsePercentString(
  value: string,
): { ok: true; basisPoints: number | null } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, basisPoints: null };
  // 1–3 digits, optional decimal with 1–2 decimal places.
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) {
    return {
      ok: false,
      error: "Enter a percentage from 0 to 100 with at most two decimal places.",
    };
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    return { ok: false, error: "Enter a percentage from 0 to 100." };
  }
  // At most 2 decimal places → num * 100 is an integer. Round defends against
  // floating-point artifacts (10.55 * 100 = 1054.9999…).
  return { ok: true, basisPoints: Math.round(num * 100) };
}

// ---------------------------------------------------------------------------
// TaxOnGratuity ↔ select value
// ---------------------------------------------------------------------------

export function taxOnGratuityToSelectValue(value: boolean | null): TaxOnGratuitySelectValue {
  if (value === null) return TAX_ON_GRATUITY_NOT_CONFIGURED;
  return value ? TAX_ON_GRATUITY_YES : TAX_ON_GRATUITY_NO;
}

export function selectValueToTaxOnGratuity(value: string): boolean | null {
  if (value === TAX_ON_GRATUITY_YES) return true;
  if (value === TAX_ON_GRATUITY_NO) return false;
  return null;
}

// ---------------------------------------------------------------------------
// Timezone ↔ select value
// ---------------------------------------------------------------------------

export function timezoneToSelectValue(
  timezone: string | null,
  commonTimezones: readonly string[],
): { selectValue: string; customTimezone: string } {
  if (timezone === null) {
    return { selectValue: TIMEZONE_NOT_SET, customTimezone: "" };
  }
  if (commonTimezones.includes(timezone)) {
    return { selectValue: timezone, customTimezone: "" };
  }
  return { selectValue: TIMEZONE_CUSTOM, customTimezone: timezone };
}

export function timezoneSelectValueToString(
  selectValue: string,
  customTimezone: string,
): string | null {
  if (selectValue === TIMEZONE_CUSTOM) {
    return customTimezone.trim() || null;
  }
  if (selectValue === TIMEZONE_NOT_SET) {
    return null;
  }
  return selectValue;
}

// ---------------------------------------------------------------------------
// Form ↔ policy
// ---------------------------------------------------------------------------

export interface PaymentPolicyFormValues {
  expectedUpdatedAt: string;
  depositPercent: string;
  deadlineHours: string;
  timezone: string;
  customTimezone: string;
  taxPercent: string;
  gratuityPercent: string;
  taxOnGratuity: string;
}

/**
 * Map a loaded PaymentPolicyDTO into form display values, using non-empty
 * sentinels for "not configured" selects and blank strings for unconfigured
 * rate fields.
 */
export function policyToFormValues(
  policy: PaymentPolicyDTO,
  commonTimezones: readonly string[],
): PaymentPolicyFormValues {
  const tz = timezoneToSelectValue(policy.restaurantTimezone, commonTimezones);
  return {
    expectedUpdatedAt: policy.updatedAt,
    depositPercent: String(policy.depositPercent),
    deadlineHours: String(policy.defaultBalanceDeadlineHours),
    timezone: tz.selectValue,
    customTimezone: tz.customTimezone,
    taxPercent: basisPointsToPercentString(policy.taxRateBasisPoints),
    gratuityPercent: basisPointsToPercentString(policy.gratuityRateBasisPoints),
    taxOnGratuity: taxOnGratuityToSelectValue(policy.taxOnGratuity),
  };
}

/**
 * Validate form values and build the UpdatePaymentPolicyInput payload.
 * Collects all validation errors rather than returning on the first.
 * Omitted (undefined) tax/gratuity fields are NOT produced here — the form
 * always supplies a concrete number|null or boolean|null.
 */
export function buildPaymentPolicyUpdatePayload(
  form: PaymentPolicyFormValues,
): { ok: true; payload: UpdatePaymentPolicyInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  const deposit = Number(form.depositPercent);
  if (!Number.isFinite(deposit) || deposit < 0 || deposit > 100) {
    errors.push("Deposit must be between 0 and 100.");
  }

  const hours = Number(form.deadlineHours);
  if (!Number.isFinite(hours) || !Number.isInteger(hours) || hours < 0 || hours > 720) {
    errors.push("Balance deadline must be a whole number of hours (0–720).");
  }

  const tz = timezoneSelectValueToString(form.timezone, form.customTimezone);

  const taxResult = parsePercentString(form.taxPercent);
  if (!taxResult.ok) errors.push(taxResult.error);

  const gratuityResult = parsePercentString(form.gratuityPercent);
  if (!gratuityResult.ok) errors.push(gratuityResult.error);

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    payload: {
      expectedUpdatedAt: form.expectedUpdatedAt,
      depositPercent: deposit,
      defaultBalanceDeadlineHours: hours,
      restaurantTimezone: tz,
      taxRateBasisPoints: taxResult.ok ? taxResult.basisPoints : null,
      gratuityRateBasisPoints: gratuityResult.ok ? gratuityResult.basisPoints : null,
      taxOnGratuity: selectValueToTaxOnGratuity(form.taxOnGratuity),
    },
  };
}
