/**
 * Admin Settings — /admin/settings
 *
 * Payment policy configuration (singleton): deposit percentage, default
 * balance deadline hours, and restaurant timezone. The confirmed defaults
 * are a 50% deposit and a 72-hour balance deadline. Per-reservation overrides
 * (including pay-at-check-in) are a future phase and will be audited.
 *
 * Authorization is enforced server-side (resolveSundaysActor requires
 * settings.manage — administrator). This UI only gates presentation.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

import { getPaymentPolicy, updatePaymentPolicy } from "@/lib/sundays.functions";
import type { PaymentPolicyDTO, PaymentPolicyOperationResult } from "@/lib/sundays/types";
import { DEFAULT_DEPOSIT_PERCENT, DEFAULT_BALANCE_DEADLINE_HOURS } from "@/lib/sundays/constants";

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
  const [timezone, setTimezone] = useState<string>("");
  const [customTimezone, setCustomTimezone] = useState("");

  const actionLockRef = useRef(false);

  const loadPolicy = useCallback(async () => {
    setLoadState("loading");
    setLoadError("");
    try {
      const result = await getPolicyFn();
      setPolicy(result);
      setDepositPercent(String(result.depositPercent));
      setDeadlineHours(String(result.defaultBalanceDeadlineHours));
      const tz = result.restaurantTimezone ?? "";
      if (COMMON_TIMEZONES.includes(tz) || tz === "") {
        setTimezone(tz);
        setCustomTimezone("");
      } else {
        setTimezone("__custom__");
        setCustomTimezone(tz);
      }
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
    actionLockRef.current = true;
    try {
      const deposit = Number(depositPercent);
      const hours = Number(deadlineHours);
      const tz =
        timezone === "__custom__"
          ? customTimezone.trim() || null
          : timezone === ""
            ? null
            : timezone;

      if (!Number.isFinite(deposit) || deposit < 0 || deposit > 100) {
        toast.error("Deposit must be between 0 and 100.");
        return;
      }
      if (!Number.isFinite(hours) || !Number.isInteger(hours) || hours < 0 || hours > 720) {
        toast.error("Balance deadline must be a whole number of hours (0–720).");
        return;
      }

      const result: PaymentPolicyOperationResult = await updatePolicyFn({
        data: {
          expectedUpdatedAt: policy.updatedAt,
          depositPercent: deposit,
          defaultBalanceDeadlineHours: hours,
          restaurantTimezone: tz,
        },
      });
      if (result.success) {
        toast.success("Payment settings saved.");
        await loadPolicy();
      } else if (result.conflict) {
        toast.error("These settings were modified by another user. Reload and try again.");
      } else {
        toast.error(result.error ?? "Could not save payment settings.");
      }
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      actionLockRef.current = false;
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
        description="Configure the default deposit and balance deadline applied to new reservations. Existing reservations keep the terms agreed at booking."
      />

      <div className="rounded-lg border border-gold/30 bg-gold/5 p-4">
        <p className="text-sm text-foreground">
          <strong className="font-semibold">Confirmed defaults:</strong> 50% deposit at reservation,
          balance due 72 hours before the seating. These defaults apply to future reservations only.
          Authorized staff can override a specific reservation's deadline or set pay-at-check-in
          (audited). Recording an external payment at the door never initiates a Stripe charge, and
          check-in never marks a reservation paid.
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="max-w-xl space-y-6 rounded-lg border border-border bg-card p-6"
      >
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
            aria-describedby="deposit-help"
          />
          <p id="deposit-help" className="text-xs text-muted-foreground">
            Portion of the total due at reservation. Confirmed default is 50.
          </p>
        </div>

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
            aria-describedby="deadline-help"
          />
          <p id="deadline-help" className="text-xs text-muted-foreground">
            Confirmed default is 72 hours. Applies to future reservations only.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="timezone">Restaurant timezone</Label>
          <Select value={timezone} onValueChange={setTimezone}>
            <SelectTrigger id="timezone">
              <SelectValue placeholder="Select a timezone" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Not set</SelectItem>
              {COMMON_TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
              <SelectItem value="__custom__">Custom…</SelectItem>
            </SelectContent>
          </Select>
          {timezone === "__custom__" && (
            <Input
              className="mt-2"
              value={customTimezone}
              onChange={(e) => setCustomTimezone(e.target.value)}
              placeholder="e.g. America/Chicago"
              aria-label="Custom IANA timezone"
              maxLength={120}
            />
          )}
          <p className="text-xs text-muted-foreground">
            Required for scheduling Sunday services and seating times. Use an IANA timezone (e.g.
            America/Chicago).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!policy}>
            Save settings
          </Button>
          <Button type="button" variant="outline" onClick={loadPolicy}>
            <RefreshCw className="mr-2 size-4" aria-hidden />
            Reload
          </Button>
        </div>
      </form>
    </div>
  );
}
