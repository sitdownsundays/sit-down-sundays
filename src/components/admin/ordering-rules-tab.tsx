/**
 * Guest pricing rules editor for the ordering configuration screen.
 * Senior discount (confirmed 5%) + child pricing rule (explicitly selected).
 * Package-specific child/senior overrides live on this same tab.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/layout/empty-state";
import { updateGuestPricingRules, savePackagePricing } from "@/lib/ordering.functions";
import type { OrderingConfigDTO, MealPackageDTO } from "@/lib/ordering/types";
import { CHILD_RULE_TYPES, CHILD_RULE_TYPE_LABELS } from "@/lib/ordering/constants";
import { Field, centsToDollars, dollarsToCents } from "./ordering-helpers";
import {
  PRICING_USE_GLOBAL,
  PRICING_NONE,
  PRICING_FIXED,
  PRICING_PERCENTAGE,
  type PricingEditorState,
  initializeEditorState,
  buildPricingPayload,
  hasPricingChange,
  adoptPricingResult,
  validatePricingState,
  pricingSaveErrorMessage,
  requiresReload,
  assessPricingSettlement,
  assessConfigSyncWithRecoveryGate,
  type PricingReloadResult,
} from "./package-pricing-helpers";
import { usePricingRecovery } from "./use-pricing-recovery";

interface RulesTabProps {
  config: OrderingConfigDTO;
  actionLockRef: React.RefObject<boolean>;
  onReload: () => Promise<void>;
  /** Fresh-read recovery for conflict/uncertain pricing saves. Must return
   *  the actual server-read result, not a stale/cached resolved promise. */
  onPricingReload: (packageId: string) => Promise<PricingReloadResult>;
}

const PKG_NONE_SENTINEL = "__none__";

export function RulesTab({ config, actionLockRef, onReload, onPricingReload }: RulesTabProps) {
  const rules = config.guestPricingRules;
  const [seniorDiscountPercent, setSeniorDiscountPercent] = useState(
    rules?.seniorDiscountPercent != null ? String(rules.seniorDiscountPercent) : "",
  );
  const [seniorMinAge, setSeniorMinAge] = useState(
    rules?.seniorMinAge != null ? String(rules.seniorMinAge) : "",
  );
  const [seniorAppliesToPackages, setSeniorAppliesToPackages] = useState(
    rules?.seniorAppliesToPackages ?? true,
  );
  const [seniorAppliesToAddons, setSeniorAppliesToAddons] = useState(
    rules?.seniorAppliesToAddons ?? false,
  );
  const [childRuleType, setChildRuleType] = useState<string>(rules?.childRuleType ?? "none");
  const [childDiscountPercent, setChildDiscountPercent] = useState(
    rules?.childDiscountPercent != null ? String(rules.childDiscountPercent) : "",
  );
  const [childFixedPackagePrice, setChildFixedPackagePrice] = useState(
    rules?.childFixedPackagePriceCents != null
      ? centsToDollars(rules.childFixedPackagePriceCents)
      : "",
  );
  const [childMaxAge, setChildMaxAge] = useState(
    rules?.childMaxAge != null ? String(rules.childMaxAge) : "",
  );
  const [childAppliesToPackages, setChildAppliesToPackages] = useState(
    rules?.childAppliesToPackages ?? true,
  );
  const [childAppliesToAddons, setChildAppliesToAddons] = useState(
    rules?.childAppliesToAddons ?? false,
  );
  const [serverError, setServerError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const updateFn = useServerFn(updateGuestPricingRules);

  async function submit() {
    if (!rules) {
      setServerError("Configuration unavailable. Reload to try again.");
      return;
    }
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setSubmitting(true);
    setServerError("");
    setConflict(false);
    try {
      const result = await updateFn({
        data: {
          expectedUpdatedAt: rules.updatedAt,
          seniorDiscountPercent:
            seniorDiscountPercent.trim() === "" ? null : Number(seniorDiscountPercent),
          seniorMinAge: seniorMinAge.trim() === "" ? null : Number(seniorMinAge),
          seniorAppliesToPackages,
          seniorAppliesToAddons,
          seniorAppliesToPlatters: false,
          childRuleType: childRuleType as "none" | "fixed_package_price" | "percentage_discount",
          childDiscountPercent:
            childDiscountPercent.trim() === "" ? null : Number(childDiscountPercent),
          childFixedPackagePriceCents:
            childFixedPackagePrice.trim() === "" ? null : dollarsToCents(childFixedPackagePrice),
          childMaxAge: childMaxAge.trim() === "" ? null : Number(childMaxAge),
          childAppliesToPackages,
          childAppliesToAddons,
          childAppliesToPlatters: false,
        },
      });
      if (!result.success) {
        if (result.conflict) setConflict(true);
        else setServerError(result.error ?? "Something went wrong.");
        return;
      }
      toast.success("Guest pricing rules updated.");
      await onReload();
    } catch {
      setServerError("Something went wrong. Please try again.");
    } finally {
      actionLockRef.current = false;
      setSubmitting(false);
    }
  }

  /* -------------------- Package-specific pricing -------------------- */

  const savePricingFn = useServerFn(savePackagePricing);
  const [selectedPkgId, setSelectedPkgId] = useState<string | null>(null);
  const [pricingPkg, setPricingPkg] = useState<MealPackageDTO | null>(null);
  const [childPricing, setChildPricing] = useState<PricingEditorState>({
    mode: PRICING_USE_GLOBAL,
    fixedDollars: "",
    percentage: "",
  });
  const [seniorPricing, setSeniorPricing] = useState<PricingEditorState>({
    mode: PRICING_USE_GLOBAL,
    fixedDollars: "",
    percentage: "",
  });
  const [pricingSaving, setPricingSaving] = useState(false);
  const [pricingError, setPricingError] = useState("");
  const [pricingConflict, setPricingConflict] = useState(false);
  const [pricingNeedsReload, setPricingNeedsReload] = useState(false);
  const [needsResync, setNeedsResync] = useState(false);
  const pricingOpIdRef = useRef(0);
  const pricingUnmountedRef = useRef(false);
  const recoveryReloadingRef = useRef(false);

  const handlePricingRecovery = usePricingRecovery({
    onPricingReload,
    selectedPkgId,
    pricingUnmountedRef,
    setPricingPkg,
    setChildPricing,
    setSeniorPricing,
    setPricingSaving,
    setPricingConflict,
    setPricingNeedsReload,
    setPricingError,
    setNeedsResync,
    recoveryReloadingRef,
  });

  useEffect(() => {
    pricingUnmountedRef.current = false;
    return () => {
      pricingUnmountedRef.current = true;
    };
  }, []);

  // Latest pricing/editor state for the effect guard (avoids stale closures).
  const pricingStateRef = useRef({ pricingPkg, childPricing, seniorPricing });
  pricingStateRef.current = { pricingPkg, childPricing, seniorPricing };

  useEffect(() => {
    if (selectedPkgId === null) {
      setPricingPkg(null);
      setNeedsResync(false);
      return;
    }
    const found = config.packages.find((p) => p.id === selectedPkgId) ?? null;
    const { pricingPkg: pp, childPricing: cp, seniorPricing: sp } = pricingStateRef.current;
    const guard = assessConfigSyncWithRecoveryGate({
      recoveryGateActive: pricingConflict || pricingNeedsReload,
      hasDirtyEdits: !!pp && hasPricingChange(pp, cp, sp),
      needsResync,
      hasFoundPackage: !!found,
    });
    if (!found) {
      if (guard.shouldClearResync) setNeedsResync(false);
      return;
    }
    if (!guard.shouldAdopt) {
      if (guard.shouldClearResync) setNeedsResync(false);
      return; // recovery gate active or dirty edits — do not overwrite
    }
    setPricingPkg(found);
    setChildPricing(initializeEditorState(found, "child"));
    setSeniorPricing(initializeEditorState(found, "senior"));
    setNeedsResync(false);
    if (guard.shouldClearGate) {
      setPricingConflict(false);
      setPricingNeedsReload(false);
      setPricingError("");
    }
  }, [selectedPkgId, config.packages, needsResync, pricingConflict, pricingNeedsReload]);

  const childErrors = useMemo(
    () => (pricingPkg ? validatePricingState(childPricing, pricingPkg.pricePerPersonCents) : {}),
    [childPricing, pricingPkg],
  );
  const seniorErrors = useMemo(
    () => (pricingPkg ? validatePricingState(seniorPricing, pricingPkg.pricePerPersonCents) : {}),
    [seniorPricing, pricingPkg],
  );
  const hasPricingChangeVal = useMemo(
    () => (pricingPkg ? hasPricingChange(pricingPkg, childPricing, seniorPricing) : false),
    [pricingPkg, childPricing, seniorPricing],
  );

  function selectPackage(id: string | null) {
    if (pricingSaving) return;
    if (pricingNeedsReload || pricingConflict) {
      setPricingError("Reload the latest data before switching packages.");
      return;
    }
    if (id === selectedPkgId) return;
    if (pricingPkg && hasPricingChangeVal) {
      setPricingError("Save or reset your changes before switching to another package.");
      return;
    }
    setSelectedPkgId(id);
    setPricingError("");
  }

  function resetPricingEdits() {
    if (!pricingPkg) return;
    setChildPricing(initializeEditorState(pricingPkg, "child"));
    setSeniorPricing(initializeEditorState(pricingPkg, "senior"));
    setPricingError("");
  }

  async function savePricing() {
    if (actionLockRef.current || pricingSaving || pricingNeedsReload || pricingConflict) return;
    if (!pricingPkg) return;
    const payload = buildPricingPayload(
      pricingPkg,
      childPricing,
      seniorPricing,
      pricingPkg.pricePerPersonCents,
    );
    if (!payload) {
      setPricingError("Check the pricing fields before saving.");
      return;
    }
    if (!hasPricingChangeVal) {
      setPricingError("No changes to save.");
      return;
    }
    pricingOpIdRef.current++;
    const opId = pricingOpIdRef.current;
    actionLockRef.current = true;
    setPricingSaving(true);
    setPricingError("");
    setPricingConflict(false);
    setPricingNeedsReload(false);
    try {
      const result = await savePricingFn({ data: payload });
      const settle = assessPricingSettlement(
        opId,
        pricingOpIdRef.current,
        pricingUnmountedRef.current,
      );
      if (!settle.shouldAdoptResult) return;
      if (!result.ok) {
        const msg = pricingSaveErrorMessage(result);
        setPricingError(
          msg ?? "Saving could not be verified. Reload this package before trying again.",
        );
        if (requiresReload(result)) {
          if (result.code === "conflict") setPricingConflict(true);
          else setPricingNeedsReload(true);
        }
        return;
      }
      const adopted = adoptPricingResult(pricingPkg, result);
      setPricingPkg(adopted);
      setChildPricing(initializeEditorState(adopted, "child"));
      setSeniorPricing(initializeEditorState(adopted, "senior"));
      toast.success("Package pricing saved.");
      try {
        await onReload();
      } catch {
        // List refresh failed — pricing save still succeeded.
      }
    } catch {
      const settle = assessPricingSettlement(
        opId,
        pricingOpIdRef.current,
        pricingUnmountedRef.current,
      );
      if (settle.shouldUpdateState) {
        setPricingError("Saving could not be verified. Reload this package before trying again.");
        setPricingNeedsReload(true);
      }
    } finally {
      const settle = assessPricingSettlement(
        opId,
        pricingOpIdRef.current,
        pricingUnmountedRef.current,
      );
      if (settle.releaseLock) {
        actionLockRef.current = false;
      }
      if (settle.shouldUpdateState) {
        setPricingSaving(false);
      }
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Global package discounts apply only when a package is set to <em>Use global rule</em>.
        Package-specific rules replace — not stack with — the global package discount.
      </p>

      {/* Global defaults */}
      <div className="space-y-4">
        <h3 className="font-display text-lg font-semibold text-foreground">Global defaults</h3>

        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          <h4 className="font-medium text-foreground">Senior discount</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Senior discount (%)" id="sr-percent">
              <Input
                id="sr-percent"
                type="number"
                min="0"
                max="100"
                value={seniorDiscountPercent}
                onChange={(e) => setSeniorDiscountPercent(e.target.value)}
                placeholder="5"
              />
            </Field>
            <Field label="Qualifying minimum age" id="sr-age">
              <Input
                id="sr-age"
                type="number"
                min="0"
                value={seniorMinAge}
                onChange={(e) => setSeniorMinAge(e.target.value)}
                placeholder="Not configured"
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={seniorAppliesToPackages}
                onCheckedChange={(v) => setSeniorAppliesToPackages(!!v)}
              />
              Applies to packages
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={seniorAppliesToAddons}
                onCheckedChange={(v) => setSeniorAppliesToAddons(!!v)}
              />
              Applies to add-ons
            </label>
          </div>
          {seniorDiscountPercent.trim() !== "" && seniorMinAge.trim() === "" && (
            <p className="text-sm text-destructive">
              A qualifying age is required when a senior discount is configured.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          <h4 className="font-medium text-foreground">Child pricing</h4>
          <Field label="Child pricing rule" id="child-rule">
            <Select value={childRuleType} onValueChange={setChildRuleType}>
              <SelectTrigger id="child-rule">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHILD_RULE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {CHILD_RULE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Maximum child age" id="child-age">
            <Input
              id="child-age"
              type="number"
              min="0"
              value={childMaxAge}
              onChange={(e) => setChildMaxAge(e.target.value)}
              placeholder="Not configured"
            />
          </Field>
          {childRuleType === "fixed_package_price" && (
            <Field label="Fixed child package price (USD)" id="child-fixed">
              <Input
                id="child-fixed"
                type="number"
                step="0.01"
                min="0"
                value={childFixedPackagePrice}
                onChange={(e) => setChildFixedPackagePrice(e.target.value)}
                placeholder="Not configured"
              />
            </Field>
          )}
          {childRuleType === "percentage_discount" && (
            <Field label="Child discount (%)" id="child-percent">
              <Input
                id="child-percent"
                type="number"
                min="0"
                max="100"
                value={childDiscountPercent}
                onChange={(e) => setChildDiscountPercent(e.target.value)}
                placeholder="Not configured"
              />
            </Field>
          )}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={childAppliesToPackages}
                onCheckedChange={(v) => setChildAppliesToPackages(!!v)}
              />
              Applies to packages
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={childAppliesToAddons}
                onCheckedChange={(v) => setChildAppliesToAddons(!!v)}
              />
              Applies to add-ons
            </label>
          </div>
          {childRuleType === "none" && (
            <p className="text-sm text-muted-foreground">
              Child pricing is not configured. Children will be charged full package price until a
              rule is selected.
            </p>
          )}
        </div>

        {serverError && <p className="text-sm text-destructive">{serverError}</p>}
        {conflict && (
          <p className="text-sm text-destructive">
            These rules were modified by another user.{" "}
            <button className="underline" onClick={onReload}>
              Reload latest
            </button>
          </p>
        )}
        <Button onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : "Save pricing rules"}
        </Button>
      </div>

      {/* Package-specific pricing */}
      <div className="space-y-4 border-t border-border pt-6">
        <div>
          <h3 className="font-display text-lg font-semibold text-foreground">
            Package-specific pricing
          </h3>
          <p className="text-sm text-muted-foreground">
            Select a package to configure its child and senior pricing independently of the global
            defaults.
          </p>
        </div>

        <Field label="Package" id="pkg-pricing-select">
          <Select
            value={selectedPkgId ?? PKG_NONE_SENTINEL}
            onValueChange={(v) => selectPackage(v === PKG_NONE_SENTINEL ? null : v)}
            disabled={pricingSaving || pricingNeedsReload || pricingConflict}
          >
            <SelectTrigger id="pkg-pricing-select">
              <SelectValue placeholder="Select a package…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PKG_NONE_SENTINEL}>— None —</SelectItem>
              {config.packages.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} — ${centsToDollars(p.pricePerPersonCents)}/person
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {pricingPkg && (
          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">
              Regular package price: ${centsToDollars(pricingPkg.pricePerPersonCents)}/person
            </p>

            {/* Child category */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Child pricing</Label>
              <Select
                value={childPricing.mode}
                onValueChange={(v) =>
                  setChildPricing((prev) => ({
                    ...prev,
                    mode: v as PricingEditorState["mode"],
                  }))
                }
                disabled={pricingSaving || pricingNeedsReload || pricingConflict}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PRICING_USE_GLOBAL}>Use global rule</SelectItem>
                  <SelectItem value={PRICING_NONE}>No discount (regular price)</SelectItem>
                  <SelectItem value={PRICING_FIXED}>Fixed package price</SelectItem>
                  <SelectItem value={PRICING_PERCENTAGE}>Percentage discount</SelectItem>
                </SelectContent>
              </Select>
              {childPricing.mode === PRICING_FIXED && (
                <Field
                  label="Final package price ($)"
                  error={childErrors.fixed}
                  id="pkg-child-fixed"
                >
                  <Input
                    id="pkg-child-fixed"
                    type="number"
                    min="0"
                    step="0.01"
                    value={childPricing.fixedDollars}
                    onChange={(e) =>
                      setChildPricing((prev) => ({ ...prev, fixedDollars: e.target.value }))
                    }
                    disabled={pricingSaving || pricingNeedsReload || pricingConflict}
                  />
                </Field>
              )}
              {childPricing.mode === PRICING_PERCENTAGE && (
                <Field label="Discount (%)" error={childErrors.percentage} id="pkg-child-pct">
                  <Input
                    id="pkg-child-pct"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={childPricing.percentage}
                    onChange={(e) =>
                      setChildPricing((prev) => ({ ...prev, percentage: e.target.value }))
                    }
                    disabled={pricingSaving || pricingNeedsReload || pricingConflict}
                  />
                </Field>
              )}
            </div>

            {/* Senior category */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Senior pricing</Label>
              <Select
                value={seniorPricing.mode}
                onValueChange={(v) =>
                  setSeniorPricing((prev) => ({
                    ...prev,
                    mode: v as PricingEditorState["mode"],
                  }))
                }
                disabled={pricingSaving || pricingNeedsReload || pricingConflict}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PRICING_USE_GLOBAL}>Use global rule</SelectItem>
                  <SelectItem value={PRICING_NONE}>No discount (regular price)</SelectItem>
                  <SelectItem value={PRICING_FIXED}>Fixed package price</SelectItem>
                  <SelectItem value={PRICING_PERCENTAGE}>Percentage discount</SelectItem>
                </SelectContent>
              </Select>
              {seniorPricing.mode === PRICING_FIXED && (
                <Field
                  label="Final package price ($)"
                  error={seniorErrors.fixed}
                  id="pkg-senior-fixed"
                >
                  <Input
                    id="pkg-senior-fixed"
                    type="number"
                    min="0"
                    step="0.01"
                    value={seniorPricing.fixedDollars}
                    onChange={(e) =>
                      setSeniorPricing((prev) => ({ ...prev, fixedDollars: e.target.value }))
                    }
                    disabled={pricingSaving || pricingNeedsReload || pricingConflict}
                  />
                </Field>
              )}
              {seniorPricing.mode === PRICING_PERCENTAGE && (
                <Field label="Discount (%)" error={seniorErrors.percentage} id="pkg-senior-pct">
                  <Input
                    id="pkg-senior-pct"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={seniorPricing.percentage}
                    onChange={(e) =>
                      setSeniorPricing((prev) => ({ ...prev, percentage: e.target.value }))
                    }
                    disabled={pricingSaving || pricingNeedsReload || pricingConflict}
                  />
                </Field>
              )}
            </div>

            {pricingError && <p className="text-sm text-destructive">{pricingError}</p>}
            {pricingConflict && (
              <p className="text-sm text-destructive">
                This package was modified by another user.{" "}
                <button
                  className="underline"
                  onClick={handlePricingRecovery}
                  disabled={pricingSaving}
                >
                  {pricingSaving ? "Reloading…" : "Reload latest"}
                </button>
              </p>
            )}
            {pricingNeedsReload && !pricingConflict && (
              <p className="text-sm text-destructive">
                Saving could not be verified.{" "}
                <button
                  className="underline"
                  onClick={handlePricingRecovery}
                  disabled={pricingSaving}
                >
                  {pricingSaving ? "Reloading…" : "Reload this package"}
                </button>{" "}
                before trying again.
              </p>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={savePricing}
                disabled={
                  pricingSaving ||
                  pricingNeedsReload ||
                  pricingConflict ||
                  !hasPricingChangeVal ||
                  !!childErrors.fixed ||
                  !!childErrors.percentage ||
                  !!seniorErrors.fixed ||
                  !!seniorErrors.percentage
                }
              >
                {pricingSaving ? "Saving pricing…" : "Save child & senior pricing"}
              </Button>
              {hasPricingChangeVal && !pricingSaving && !pricingNeedsReload && !pricingConflict && (
                <Button variant="ghost" size="sm" onClick={resetPricingEdits}>
                  Reset to saved
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
