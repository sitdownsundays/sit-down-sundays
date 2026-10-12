/**
 * Pure helpers for the per-package child & senior pricing editor.
 *
 * Client-safe: no server-only imports. The dialog imports these to convert
 * between editor state (dollars / percentages as strings) and the
 * savePackagePricing payload (integer cents / basis points).
 *
 * Mode sentinels are nonempty strings so the Select component never
 * confuses null (use global) with "none" (no discount).
 */
import type { MealPackageDTO } from "@/lib/ordering/types";
import type { ChildRuleType } from "@/lib/ordering/constants";
import type {
  PackagePricingSaveSuccess,
  PackagePricingSaveFailure,
} from "@/lib/ordering/package-pricing-types";

export const PRICING_USE_GLOBAL = "__use_global__";
export const PRICING_NONE = "__none__";
export const PRICING_FIXED = "__fixed__";
export const PRICING_PERCENTAGE = "__percentage__";

export const PRICING_MODE_LABELS: Record<string, string> = {
  [PRICING_USE_GLOBAL]: "Use global rule",
  [PRICING_NONE]: "No discount (regular price)",
  [PRICING_FIXED]: "Fixed package price",
  [PRICING_PERCENTAGE]: "Percentage discount",
};

export type PricingModeValue =
  | typeof PRICING_USE_GLOBAL
  | typeof PRICING_NONE
  | typeof PRICING_FIXED
  | typeof PRICING_PERCENTAGE;

export interface PricingEditorState {
  mode: PricingModeValue;
  fixedDollars: string;
  percentage: string;
}

/* ------------------------- Dollar / percentage parsing ------------------------- */

/** "15.00" → 1500 cents. Rejects blank, negative, or >2 decimal places. */
export function parseDollarsToCents(dollars: string): number | null {
  const trimmed = dollars.trim();
  if (trimmed === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

/** "12.50" → 1250 basis points (1% = 100 bp). Rejects blank, >100%, >2 decimals. */
export function parsePercentToBasisPoints(percent: string): number | null {
  const trimmed = percent.trim();
  if (trimmed === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

/* --------------------------- Editor state initialization --------------------------- */

export function initializeEditorState(
  pkg: MealPackageDTO,
  category: "child" | "senior",
): PricingEditorState {
  const ruleType = category === "child" ? pkg.childRuleType : pkg.seniorRuleType;
  const fixedCents = category === "child" ? pkg.childFixedPriceCents : pkg.seniorFixedPriceCents;
  const bp = category === "child" ? pkg.childDiscountBasisPoints : pkg.seniorDiscountBasisPoints;

  if (ruleType === null) return { mode: PRICING_USE_GLOBAL, fixedDollars: "", percentage: "" };
  if (ruleType === "none") return { mode: PRICING_NONE, fixedDollars: "", percentage: "" };
  if (ruleType === "fixed_package_price") {
    return {
      mode: PRICING_FIXED,
      fixedDollars: fixedCents !== null ? (fixedCents / 100).toFixed(2) : "",
      percentage: "",
    };
  }
  if (ruleType === "percentage_discount") {
    return {
      mode: PRICING_PERCENTAGE,
      fixedDollars: "",
      percentage: bp !== null ? (bp / 100).toFixed(2) : "",
    };
  }
  return { mode: PRICING_USE_GLOBAL, fixedDollars: "", percentage: "" };
}

/* ----------------------------------- Validation ----------------------------------- */

export function validatePricingState(
  state: PricingEditorState,
  maxPriceCents: number,
): { fixed?: string; percentage?: string } {
  const errors: { fixed?: string; percentage?: string } = {};
  if (state.mode === PRICING_FIXED) {
    const cents = parseDollarsToCents(state.fixedDollars);
    if (cents === null) {
      errors.fixed = "Enter a valid dollar amount (e.g., 15.00).";
    } else if (maxPriceCents > 0 && cents > maxPriceCents) {
      errors.fixed = "Fixed price cannot exceed the regular package price.";
    }
  }
  if (state.mode === PRICING_PERCENTAGE) {
    const bp = parsePercentToBasisPoints(state.percentage);
    if (bp === null) {
      errors.percentage = "Enter a valid percentage (0–100, up to 2 decimals).";
    }
  }
  return errors;
}

/* --------------------------------- Payload building --------------------------------- */

interface CategoryFields {
  ruleType: ChildRuleType | null;
  fixedPriceCents: number | null;
  discountBasisPoints: number | null;
}

function categoryFields(state: PricingEditorState): CategoryFields {
  switch (state.mode) {
    case PRICING_USE_GLOBAL:
      return { ruleType: null, fixedPriceCents: null, discountBasisPoints: null };
    case PRICING_NONE:
      return { ruleType: "none", fixedPriceCents: null, discountBasisPoints: null };
    case PRICING_FIXED:
      return {
        ruleType: "fixed_package_price",
        fixedPriceCents: parseDollarsToCents(state.fixedDollars),
        discountBasisPoints: null,
      };
    case PRICING_PERCENTAGE:
      return {
        ruleType: "percentage_discount",
        fixedPriceCents: null,
        discountBasisPoints: parsePercentToBasisPoints(state.percentage),
      };
    default:
      return { ruleType: null, fixedPriceCents: null, discountBasisPoints: null };
  }
}

export interface PackagePricingPayload {
  packageId: string;
  expectedUpdatedAt: string;
  childRuleType: ChildRuleType | null;
  childFixedPriceCents: number | null;
  childDiscountBasisPoints: number | null;
  seniorRuleType: ChildRuleType | null;
  seniorFixedPriceCents: number | null;
  seniorDiscountBasisPoints: number | null;
}

export function buildPricingPayload(
  pkg: MealPackageDTO,
  child: PricingEditorState,
  senior: PricingEditorState,
  maxPriceCents: number,
): PackagePricingPayload | null {
  const childErrors = validatePricingState(child, maxPriceCents);
  if (childErrors.fixed || childErrors.percentage) return null;
  const seniorErrors = validatePricingState(senior, maxPriceCents);
  if (seniorErrors.fixed || seniorErrors.percentage) return null;

  const c = categoryFields(child);
  const s = categoryFields(senior);

  return {
    packageId: pkg.id,
    expectedUpdatedAt: pkg.updatedAt,
    childRuleType: c.ruleType,
    childFixedPriceCents: c.fixedPriceCents,
    childDiscountBasisPoints: c.discountBasisPoints,
    seniorRuleType: s.ruleType,
    seniorFixedPriceCents: s.fixedPriceCents,
    seniorDiscountBasisPoints: s.discountBasisPoints,
  };
}

/* ---------------------------------- Change detection ---------------------------------- */

export function hasPricingChange(
  pkg: MealPackageDTO,
  child: PricingEditorState,
  senior: PricingEditorState,
): boolean {
  const c = categoryFields(child);
  const s = categoryFields(senior);
  return (
    pkg.childRuleType !== c.ruleType ||
    pkg.childFixedPriceCents !== c.fixedPriceCents ||
    pkg.childDiscountBasisPoints !== c.discountBasisPoints ||
    pkg.seniorRuleType !== s.ruleType ||
    pkg.seniorFixedPriceCents !== s.fixedPriceCents ||
    pkg.seniorDiscountBasisPoints !== s.discountBasisPoints
  );
}

/* ------------------------------------ Success adoption ----------------------------------- */

export function adoptPricingResult(
  pkg: MealPackageDTO,
  result: PackagePricingSaveSuccess,
): MealPackageDTO {
  return {
    ...pkg,
    updatedAt: result.updatedAt,
    childRuleType: result.pricing.childRuleType,
    childFixedPriceCents: result.pricing.childFixedPriceCents,
    childDiscountBasisPoints: result.pricing.childDiscountBasisPoints,
    seniorRuleType: result.pricing.seniorRuleType,
    seniorFixedPriceCents: result.pricing.seniorFixedPriceCents,
    seniorDiscountBasisPoints: result.pricing.seniorDiscountBasisPoints,
  };
}

/* ----------------------------------- Failure handling ----------------------------------- */

export function pricingSaveErrorMessage(result: PackagePricingSaveFailure): string | null {
  switch (result.code) {
    case "conflict":
      return "This package was modified by another user. Reload the latest data and try again.";
    case "not_found":
      return "This package could not be found. It may have been removed.";
    case "invalid_value":
      return "One of the pricing values is not valid for this package.";
    case "unauthorized":
      return "You are not authorized to manage ordering configuration.";
    case "unexpected":
      return result.error;
    default:
      return null;
  }
}

export function requiresReload(result: PackagePricingSaveFailure): boolean {
  return result.code === "conflict" || result.code === "unexpected";
}

/* --------------------------- Shared lock lifecycle --------------------------- */

/**
 * Result of assessing whether a settled pricing operation may release the
 * shared ordering action lock and update React state.
 *
 * - `releaseLock`: whether to release the parent-owned `actionLockRef`.
 *   The lock MUST be released when the *current* operation settles, even if
 *   the tab has unmounted — otherwise the lock stays engaged forever and
 *   blocks all subsequent ordering edits.
 * - `shouldUpdateState`: whether it is safe to call React state setters.
 *   False after unmount to avoid stale-state warnings; the lock is still
 *   released because the operation genuinely settled.
 * - `shouldAdoptResult`: whether returned data / notifications may be
 *   applied. False after unmount or when the completion is stale.
 */
export interface PricingSettlementAssessment {
  releaseLock: boolean;
  shouldUpdateState: boolean;
  shouldAdoptResult: boolean;
}

/**
 * Assess a settled pricing save operation.
 *
 * @param operationId — the id captured at the start of this save attempt.
 * @param currentOperationId — the latest operation id (ref value).
 * @param unmounted — whether the component has unmounted.
 *
 * Rules:
 * - A stale completion (operationId !== currentOperationId) belongs to an
 *   older operation and must NOT release a newer operation's lock.
 * - The current operation's lock is released on settlement regardless of
 *   unmount — the request genuinely finished.
 * - React state updates and result adoption are skipped after unmount.
 */
export function assessPricingSettlement(
  operationId: number,
  currentOperationId: number,
  unmounted: boolean,
): PricingSettlementAssessment {
  if (operationId !== currentOperationId) {
    return { releaseLock: false, shouldUpdateState: false, shouldAdoptResult: false };
  }
  return {
    releaseLock: true,
    shouldUpdateState: !unmounted,
    shouldAdoptResult: !unmounted,
  };
}

/* --------------------------- Pricing reload recovery --------------------------- */

/**
 * Result of a fresh server read for pricing-recovery after a conflict or
 * uncertain save. The caller must return the ACTUAL read result, not a
 * cached/resolved promise. `ok:false` or `pkg:null` must NOT clear the gate.
 */
export interface PricingReloadResult {
  ok: boolean;
  pkg: MealPackageDTO | null;
}

export interface PricingRecoveryAssessment {
  /** The matching fresh package, or null when the recovery must remain blocked. */
  package: MealPackageDTO | null;
  /** Whether the recovery gate may be cleared. */
  mayClearGate: boolean;
  /** Whether React state may be updated (mounted, matching operation). */
  shouldUpdateState: boolean;
  /** Safe message when the gate must stay. */
  message: string | null;
}

/**
 * Assess a recovery (reload) after a conflict or uncertain pricing save.
 *
 * `reloadResult` is the explicit result of an awaited fresh server read —
 * never a resolved promise whose body was a stale/cached value. The caller
 * must verify the returned package actually matches the requested package
 * before adopting it and clearing the recovery gate.
 *
 * Rules:
 * - A stale completion (operationId !== current) cannot adopt or clear.
 * - After unmount, no state updates (no stale-set warnings), but the gate
 *   may still be cleared for the current operation so a later mount is not stuck.
 * - Only a successful fresh read that contains the matching package clears
 *   the gate and adopts its values. A failed read, or a missing/different
 *   package, keeps saving blocked with a safe retryable message.
 */
export function assessPricingRecovery(
  operationId: number,
  currentOperationId: number,
  unmounted: boolean,
  reloadResult: PricingReloadResult,
  packageId: string | null,
): PricingRecoveryAssessment {
  if (operationId !== currentOperationId) {
    return {
      package: null,
      mayClearGate: false,
      shouldUpdateState: false,
      message: null,
    };
  }
  if (!reloadResult.ok) {
    return {
      package: null,
      mayClearGate: false,
      shouldUpdateState: !unmounted,
      message: "Could not reload this package. Please try again.",
    };
  }
  if (!packageId) {
    return {
      package: null,
      mayClearGate: false,
      shouldUpdateState: !unmounted,
      message: "Reload failed. Try again.",
    };
  }
  if (!reloadResult.pkg) {
    return {
      package: null,
      mayClearGate: false,
      shouldUpdateState: !unmounted,
      message: "This package could not be found after reload.",
    };
  }
  if (reloadResult.pkg.id !== packageId) {
    return {
      package: null,
      mayClearGate: false,
      shouldUpdateState: !unmounted,
      message: "Reloaded data does not match this package.",
    };
  }
  return {
    package: reloadResult.pkg,
    mayClearGate: true,
    shouldUpdateState: !unmounted,
    message: null,
  };
}

/* --------------------------- Recovery error / config-sync guards --------------------------- */

/**
 * Whether a thrown recovery failure may update the error state. An obsolete
 * failed operation must not overwrite newer state.
 */
export function mayUpdateRecoveryError(
  operationId: number,
  currentOperationId: number,
  unmounted: boolean,
): boolean {
  return operationId === currentOperationId && !unmounted;
}

export interface ConfigSyncRecoveryGuardResult {
  /** Whether to adopt the fresh config into the editor (set editor state). */
  shouldAdopt: boolean;
  /** Whether to clear recovery gate state (conflict/needsReload/error). */
  shouldClearGate: boolean;
  /** Whether to clear the needsResync flag. */
  shouldClearResync: boolean;
}

/**
 * Decide whether background config synchronization may adopt fresh config and
 * clear the recovery gate.
 *
 * While `recoveryGateActive` (pricingConflict OR pricingNeedsReload) is true,
 * config sync must NOT overwrite the editor or clear recovery state — even
 * when there are no dirty edits or `needsResync` is true. Only verified
 * recovery (the recovery hook) may clear that gate.
 *
 * Preserves:
 * - Normal initial loading and package selection when no recovery gate active.
 * - Unsaved edits (dirty edits with no resync request).
 */
export function assessConfigSyncWithRecoveryGate(args: {
  recoveryGateActive: boolean;
  hasDirtyEdits: boolean;
  needsResync: boolean;
  hasFoundPackage: boolean;
}): ConfigSyncRecoveryGuardResult {
  const { recoveryGateActive, hasDirtyEdits, needsResync, hasFoundPackage } = args;
  // No package found → cannot adopt. Clear resync only if no recovery gate.
  if (!hasFoundPackage) {
    return { shouldAdopt: false, shouldClearGate: false, shouldClearResync: !recoveryGateActive };
  }
  // Recovery gate active → do NOT touch editor or gate. Keep needsResync as-is.
  if (recoveryGateActive) {
    return { shouldAdopt: false, shouldClearGate: false, shouldClearResync: false };
  }
  // Dirty edits with no explicit resync request → preserve unsaved edits.
  if (hasDirtyEdits && !needsResync) {
    return { shouldAdopt: false, shouldClearGate: false, shouldClearResync: false };
  }
  // Normal flow: adopt fresh config, clear gate (already false), clear resync.
  return { shouldAdopt: true, shouldClearGate: true, shouldClearResync: true };
}
