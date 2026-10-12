/**
 * Admin Settings — /admin/settings
 *
 * Payment policy configuration (singleton): deposit percentage, default
 * balance deadline hours, restaurant timezone, and optional tax/gratuity
 * rates. The confirmed defaults are a 50% deposit and a 72-hour balance
 * deadline. Per-reservation overrides (including pay-at-check-in) are not
 * implemented.
 *
 * Authorization is enforced server-side (resolveSundaysActor requires
 * settings.manage — administrator). This UI only gates presentation.
 *
 * Tax and gratuity settings are applied to new reservation pricing. Tax
 * treatment requires owner/accountant confirmation.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

import { getPaymentPolicy, updatePaymentPolicy } from "@/lib/sundays.functions";
import type { PaymentPolicyDTO, PaymentPolicyOperationResult } from "@/lib/sundays/types";
import { DEFAULT_DEPOSIT_PERCENT, DEFAULT_BALANCE_DEADLINE_HOURS } from "@/lib/sundays/constants";

import {
  policyToFormValues,
  buildPaymentPolicyUpdatePayload,
  type PaymentPolicyFormValues,
  TIMEZONE_NOT_SET,
  TIMEZONE_CUSTOM,
  TAX_ON_GRATUITY_NOT_CONFIGURED,
  TAX_ON_GRATUITY_YES,
  TAX_ON_GRATUITY_NO,
} from "@/components/admin/payment-policy-form-helpers";

import { PageHeader } from "@/components/layout/page-header";
import { ErrorState } from "@/components/layout/error-state";
import { LoadingState } from "@/components/layout/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type LoadState = "loading" | "loaded" | "error";

/** Common IANA timezones for a US-based Sunday dining experience. */
const COMMON_TIMEZONES = [
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "America/Detroit",
  "America/Indiana/Indianapolis",
];

export function AdminSettingsPage() {
  const getPolicyFn = useServerFn(getPaymentPolicy);
  const updatePolicyFn = useServerFn(updatePaymentPolicy);

  const [policy, setPolicy] = useState<PaymentPolicyDTO | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");

  const [depositPercent, setDepositPercent] = useState(String(DEFAULT_DEPOSIT_PERCENT));
  const [deadlineHours, setDeadlineHours] = useState(String(DEFAULT_BALANCE_DEADLINE_HOURS));
  const [timezone, setTimezone] = useState<string>(TIMEZONE_NOT_SET);
  const [customTimezone, setCustomTimezone] = useState("");
  const [taxPercent, setTaxPercent] = useState("");
  const [gratuityPercent, setGratuityPercent] = useState("");
  const [taxOnGratuity, setTaxOnGratuity] = useState<string>(TAX_ON_GRATUITY_NOT_CONFIGURED);

  const [saving, setSaving] = useState(false);
  const actionLockRef = useRef(false);

  const loadPolicy = useCallback(async () => {
    setLoadState("loading");
    setLoadError("");
    try {
      const result = await getPolicyFn();
      setPolicy(result);
      const form = policyToFormValues(result, COMMON_TIMEZONES);
      setDepositPercent(form.depositPercent);
      setDeadlineHours(form.deadlineHours);
      setTimezone(form.timezone);
      setCustomTimezone(form.customTimezone);
      setTaxPercent(form.taxPercent);
      setGratuityPercent(form.gratuityPercent);
      setTaxOnGratuity(form.taxOnGratuity);
      setLoadState("loaded");
    } catch {
      setLoadError("We couldn't load payment settings. Please try again.");
      setLoadState("error");
    }
  }, [getPolicyFn]);

  useEffect(() => {
    loadPolicy();
  }, [loadPolicy]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!policy || actionLockRef.current) return;

    const form: PaymentPolicyFormValues = {
      expectedUpdatedAt: policy.updatedAt,
      depositPercent,
      deadlineHours,
      timezone,
      customTimezone,
      taxPercent,
      gratuityPercent,
      taxOnGratuity,
    };

    const buildResult = buildPaymentPolicyUpdatePayload(form);
    if (!buildResult.ok) {
      buildResult.errors.forEach((err) => toast.error(err));
      return;
    }

    actionLockRef.current = true;
    setSaving(true);
    try {
      const result: PaymentPolicyOperationResult = await updatePolicyFn({
        data: buildResult.payload,
      });
      if (result.success && result.data) {
        // Adopt the returned policy and timestamp directly — no second fetch
        // that could misreport a successful save as failed.
        const updated = policyToFormValues(result.data, COMMON_TIMEZONES);
        setPolicy(result.data);
        setDepositPercent(updated.depositPercent);
        setDeadlineHours(updated.deadlineHours);
        setTimezone(updated.timezone);
        setCustomTimezone(updated.customTimezone);
        setTaxPercent(updated.taxPercent);
        setGratuityPercent(updated.gratuityPercent);
        setTaxOnGratuity(updated.taxOnGratuity);
        toast.success("Payment settings saved.");
      } else if (result.conflict) {
        toast.error("These settings were modified by another user. Reload and try again.");
      } else {
        toast.error(result.error ?? "Could not save payment settings.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      actionLockRef.current = false;
      setSaving(false);
    }
  }

  if (loadState === "loading") return <LoadingState label="Loading payment settings…" />;
  if (loadState === "error")
    return (
      <ErrorState
        message={loadError || "We couldn't load payment settings."}
        action={
          <Button variant="outline" onClick={loadPolicy}>
            Try again
          </Button>
        }
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Payment & Operating Settings"
        description="Configure the deposit, balance deadline, and optional tax and gratuity rates applied to new reservations. Existing reservations keep the terms agreed at booking."
      />

      <div className="rounded-lg border border-gold/30 bg-gold/5 p-4">
        <p className="text-sm text-foreground">
          <strong className="font-semibold">Confirmed defaults:</strong> 50% deposit at reservation,
          balance due 72 hours before the seating. These defaults apply to future reservations only.
          The deposit applies to discounted food only, excluding tax and gratuity. Tax treatment
          requires owner/accountant confirmation.
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="max-w-xl space-y-6 rounded-lg border border-border bg-card p-6"
      >
        {/* Deposit */}
        <div className="space-y-1.5">
          <Label htmlFor="deposit">Deposit percentage (%)</Label>
          <Input
            id="deposit"
            type="number"
            min={0}
            max={100}
            step={1}
            value={depositPercent}
            onChange={(e) => setDepositPercent(e.target.value)}
            disabled={saving}
            aria-describedby="deposit-help"
          />
          <p id="deposit-help" className="text-xs text-muted-foreground">
            Portion of the total due at reservation. Confirmed default is 50. Applies to discounted
            food only, excluding tax and gratuity.
          </p>
        </div>

        {/* Balance deadline */}
        <div className="space-y-1.5">
          <Label htmlFor="deadline">Default balance deadline (hours before seating)</Label>
          <Input
            id="deadline"
            type="number"
            min={0}
            max={720}
            step={1}
            value={deadlineHours}
            onChange={(e) => setDeadlineHours(e.target.value)}
            disabled={saving}
            aria-describedby="deadline-help"
          />
          <p id="deadline-help" className="text-xs text-muted-foreground">
            Confirmed default is 72 hours. Applies to future reservations only.
          </p>
        </div>

        {/* Timezone */}
        <div className="space-y-1.5">
          <Label htmlFor="timezone">Restaurant timezone</Label>
          <Select value={timezone} onValueChange={setTimezone} disabled={saving}>
            <SelectTrigger id="timezone">
              <SelectValue placeholder="Select a timezone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TIMEZONE_NOT_SET}>Not set</SelectItem>
              {COMMON_TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
              <SelectItem value={TIMEZONE_CUSTOM}>Custom…</SelectItem>
            </SelectContent>
          </Select>
          {timezone === TIMEZONE_CUSTOM && (
            <Input
              className="mt-2"
              value={customTimezone}
              onChange={(e) => setCustomTimezone(e.target.value)}
              placeholder="e.g. America/Chicago"
              aria-label="Custom IANA timezone"
              maxLength={120}
              disabled={saving}
            />
          )}
          <p className="text-xs text-muted-foreground">
            Required for scheduling Sunday services and seating times. Use an IANA timezone (e.g.
            America/Chicago).
          </p>
        </div>

        {/* Tax & Gratuity */}
        <div className="space-y-4 border-t border-border pt-4">
          <h3 className="text-sm font-semibold text-foreground">Tax &amp; Gratuity (optional)</h3>

          <div className="space-y-1.5">
            <Label htmlFor="tax">Tax percentage (%)</Label>
            <Input
              id="tax"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={taxPercent}
              onChange={(e) => setTaxPercent(e.target.value)}
              disabled={saving}
              placeholder="Not configured"
              aria-describedby="tax-help"
            />
            <p id="tax-help" className="text-xs text-muted-foreground">
              Sales tax rate as a percentage (0–100, up to two decimal places). Leave blank if not
              configured.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gratuity">Mandatory gratuity percentage (%)</Label>
            <Input
              id="gratuity"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={gratuityPercent}
              onChange={(e) => setGratuityPercent(e.target.value)}
              disabled={saving}
              placeholder="Not configured"
              aria-describedby="gratuity-help"
            />
            <p id="gratuity-help" className="text-xs text-muted-foreground">
              Mandatory gratuity rate as a percentage (0–100, up to two decimal places). Leave blank
              if not configured.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tax-on-gratuity">Include gratuity in taxable amount</Label>
            <Select value={taxOnGratuity} onValueChange={setTaxOnGratuity} disabled={saving}>
              <SelectTrigger id="tax-on-gratuity">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TAX_ON_GRATUITY_NOT_CONFIGURED}>Not configured</SelectItem>
                <SelectItem value={TAX_ON_GRATUITY_YES}>Yes</SelectItem>
                <SelectItem value={TAX_ON_GRATUITY_NO}>No</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              When “Yes”, gratuity is included in the amount subject to tax. Tax treatment requires
              owner/accountant confirmation.
            </p>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              The deposit applies to discounted food only, excluding tax and gratuity. These rates
              are applied to new reservation pricing and saved to each reservation at booking.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!policy || saving}>
            {saving ? "Saving…" : "Save settings"}
          </Button>
          <Button type="button" variant="outline" onClick={loadPolicy} disabled={saving}>
            <RefreshCw className="mr-2 size-4" aria-hidden />
            Reload
          </Button>
        </div>
      </form>
    </div>
  );
}
