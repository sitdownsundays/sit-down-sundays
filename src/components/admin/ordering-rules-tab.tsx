/**
 * Guest pricing rules editor for the ordering configuration screen.
 * Senior discount (confirmed 5%) + child pricing rule (explicitly selected).
 */
import { useState } from "react";
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
import { EmptyState } from "@/components/layout/empty-state";
import { updateGuestPricingRules } from "@/lib/ordering.functions";
import type { OrderingConfigDTO } from "@/lib/ordering/types";
import { CHILD_RULE_TYPES, CHILD_RULE_TYPE_LABELS } from "@/lib/ordering/constants";
import { Field, centsToDollars, dollarsToCents } from "./ordering-helpers";

interface RulesTabProps {
  config: OrderingConfigDTO;
  actionLockRef: React.RefObject<boolean>;
  onReload: () => Promise<void>;
}

export function RulesTab({ config, actionLockRef, onReload }: RulesTabProps) {
  const updateFn = useServerFn(updateGuestPricingRules);
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

  if (!rules) {
    return (
      <EmptyState
        title="Guest pricing rules not initialized"
        description="The pricing rules row must be seeded before configuration. Apply the ordering migration to initialize it."
      />
    );
  }

  async function submit() {
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

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Senior discount is a confirmed 5%. Child pricing uses an explicitly selected rule — missing
        rules stay visibly unconfigured, never silently free or full-price. Discounts never apply to
        shared platters automatically.
      </p>

      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <h3 className="font-display text-lg font-semibold text-foreground">Senior discount</h3>
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
        <h3 className="font-display text-lg font-semibold text-foreground">Child pricing</h3>
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
  );
}
