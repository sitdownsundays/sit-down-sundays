/**
 * Recovery hook for conflict / uncertain pricing saves.
 *
 * Extracted from ordering-rules-tab.tsx so the component stays focused.
 * Calls the parent-provided fresh-read endpoint (`onPricingReload`) and
 * uses `assessPricingRecovery` to decide whether the returned package
 * genuinely matches the requested package before adopting it and
 * clearing the conflict/uncertainty gate.
 */
import { useRef } from "react";
import {
  assessPricingRecovery,
  mayUpdateRecoveryError,
  initializeEditorState,
  type PricingEditorState,
  type PricingReloadResult,
} from "./package-pricing-helpers";
import type { MealPackageDTO } from "@/lib/ordering/types";

export interface UsePricingRecoveryOptions {
  onPricingReload: (packageId: string) => Promise<PricingReloadResult>;
  selectedPkgId: string | null;
  pricingUnmountedRef: React.RefObject<boolean>;
  setPricingPkg: (pkg: MealPackageDTO | null) => void;
  setChildPricing: (state: PricingEditorState) => void;
  setSeniorPricing: (state: PricingEditorState) => void;
  setPricingSaving: (v: boolean) => void;
  setPricingConflict: (v: boolean) => void;
  setPricingNeedsReload: (v: boolean) => void;
  setPricingError: (v: string) => void;
  setNeedsResync: (v: boolean) => void;
  recoveryReloadingRef: React.RefObject<boolean>;
}

export function usePricingRecovery(opts: UsePricingRecoveryOptions) {
  const recoveryOpIdRef = useRef(0);

  async function handlePricingRecovery() {
    if (opts.recoveryReloadingRef.current) return; // prevent overlapping reloads
    if (!opts.selectedPkgId) return;
    recoveryOpIdRef.current++;
    const opId = recoveryOpIdRef.current;
    opts.recoveryReloadingRef.current = true;
    if (!opts.pricingUnmountedRef.current) opts.setPricingSaving(true);
    try {
      const reloadResult = await opts.onPricingReload(opts.selectedPkgId);
      const assessment = assessPricingRecovery(
        opId,
        recoveryOpIdRef.current,
        opts.pricingUnmountedRef.current,
        reloadResult,
        opts.selectedPkgId,
      );
      if (assessment.shouldUpdateState) {
        if (assessment.mayClearGate && assessment.package) {
          opts.setPricingPkg(assessment.package);
          opts.setChildPricing(initializeEditorState(assessment.package, "child"));
          opts.setSeniorPricing(initializeEditorState(assessment.package, "senior"));
          opts.setPricingConflict(false);
          opts.setPricingNeedsReload(false);
          opts.setPricingError("");
          opts.setNeedsResync(false);
        } else if (assessment.message) {
          opts.setPricingError(assessment.message);
        }
      }
    } catch {
      // An obsolete failed operation must not overwrite newer state.
      if (mayUpdateRecoveryError(opId, recoveryOpIdRef.current, opts.pricingUnmountedRef.current)) {
        opts.setPricingError("Reload failed. Try again.");
      }
    } finally {
      if (opId === recoveryOpIdRef.current) {
        opts.recoveryReloadingRef.current = false;
        if (!opts.pricingUnmountedRef.current) opts.setPricingSaving(false);
      }
    }
  }

  return handlePricingRecovery;
}
