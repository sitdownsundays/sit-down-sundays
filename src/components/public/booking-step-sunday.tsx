/**
 * Booking wizard Step 1 — Sunday & guests.
 * Extracted from the wizard so the main component stays focused.
 */
import { ArrowLeft, CalendarDays, Clock, Minus, Plus, Users } from "lucide-react";

import type { PublicAvailabilityOption } from "@/lib/reservation/types";
import { ButtonLink } from "@/components/layout/button-link";
import { EmptyState } from "@/components/layout/empty-state";
import { ErrorState } from "@/components/layout/error-state";
import { LoadingState } from "@/components/layout/loading-state";
import { Button } from "@/components/ui/button";
import {
  type BookWizardState,
  type SundayGroup,
  formatServiceDate,
  formatSeatingTime,
  totalGuests,
  validateParty,
} from "@/lib/booking/wizard-helpers";

interface Props {
  state: BookWizardState;
  groups: SundayGroup[];
  loadStatus: "loading" | "success" | "error";
  loadError: string | null;
  notice: string | null;
  onSelectOption: (opt: PublicAvailabilityOption) => void;
  onAdjustCount: (field: "adults" | "seniors" | "children", delta: number) => void;
  onSetCount: (field: "adults" | "seniors" | "children", value: number) => void;
  onRetry: () => void;
  onContinue: () => void;
}

export function BookingStepSunday({
  state,
  groups,
  loadStatus,
  loadError,
  notice,
  onSelectOption,
  onAdjustCount,
  onSetCount,
  onRetry,
  onContinue,
}: Props) {
  const selectedCeiling = state.selectedOption?.configuredRequestCeiling ?? null;
  const party = validateParty(state, selectedCeiling);
  const guestCount = totalGuests(state);
  const canContinue =
    state.sundayServiceId !== null &&
    state.seatingTimeId !== null &&
    party.error === null &&
    guestCount >= 1;

  return (
    <section aria-labelledby="step-sunday-heading">
      <h2 id="step-sunday-heading" className="font-display text-xl font-semibold text-foreground">
        1. Sunday &amp; guests
      </h2>

      {loadStatus === "loading" && (
        <div className="mt-6">
          <LoadingState label="Loading available Sundays…" />
        </div>
      )}

      {loadStatus === "error" && (
        <div className="mt-6">
          <ErrorState
            title="Couldn't load availability"
            message={loadError ?? undefined}
            action={
              <Button variant="outline" onClick={onRetry}>
                Try again
              </Button>
            }
          />
        </div>
      )}

      {loadStatus === "success" && groups.length === 0 && (
        <div className="mt-6">
          <EmptyState
            title="No Sundays available right now"
            description="Booking isn't open yet. Please check back soon or join the waitlist to be notified."
            action={
              <ButtonLink to="/waitlist" variant="outline">
                Join the waitlist
              </ButtonLink>
            }
          />
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="mt-4 rounded-md border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-foreground"
        >
          {notice}
        </div>
      )}

      {loadStatus === "success" && groups.length > 0 && (
        <div className="mt-6 space-y-6">
          {groups.map((group) => {
            const tz = group.options[0]?.restaurantTimezone || "America/Chicago";
            return (
              <div key={group.serviceId} className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-start gap-3">
                  <CalendarDays className="mt-0.5 size-5 text-primary" aria-hidden />
                  <div>
                    <h3 className="font-display text-lg font-semibold text-foreground">
                      {formatServiceDate(group.date, tz)}
                    </h3>
                    {group.serviceLabel && (
                      <p className="text-sm text-muted-foreground">{group.serviceLabel}</p>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {group.options.map((opt) => {
                    const selected =
                      state.sundayServiceId === opt.sundayService.id &&
                      state.seatingTimeId === opt.seatingTime.id;
                    return (
                      <button
                        key={opt.seatingTime.id}
                        type="button"
                        onClick={() => onSelectOption(opt)}
                        aria-pressed={selected}
                        className={[
                          "flex flex-col gap-1 rounded-md border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                          selected
                            ? "border-primary bg-primary/10"
                            : "border-border bg-background hover:border-primary/40 hover:bg-accent/40",
                        ].join(" ")}
                      >
                        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <Clock className="size-4 text-primary" aria-hidden />
                          {formatSeatingTime(opt.seatingTime.startTime)} –{" "}
                          {formatSeatingTime(opt.seatingTime.endTime)}
                        </span>
                        <span className="text-xs text-muted-foreground">{opt.spaceName}</span>
                        <span className="mt-1 text-xs text-muted-foreground">
                          Up to {opt.configuredRequestCeiling} guests per request
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Party composition */}
      <div className="mt-8 rounded-lg border border-border bg-card p-5">
        <h3 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
          <Users className="size-5 text-primary" aria-hidden />
          Your party
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell us how many guests are in your party. We'll keep your whole group together in one
          request.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <PartyCounter
            label="Adults"
            value={state.adults}
            onDecrement={() => onAdjustCount("adults", -1)}
            onIncrement={() => onAdjustCount("adults", 1)}
            onChange={(v) => onSetCount("adults", v)}
          />
          <PartyCounter
            label="Seniors"
            value={state.seniors}
            onDecrement={() => onAdjustCount("seniors", -1)}
            onIncrement={() => onAdjustCount("seniors", 1)}
            onChange={(v) => onSetCount("seniors", v)}
          />
          <PartyCounter
            label="Children"
            value={state.children}
            onDecrement={() => onAdjustCount("children", -1)}
            onIncrement={() => onAdjustCount("children", 1)}
            onChange={(v) => onSetCount("children", v)}
          />
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total guests</span>
          <span className="font-medium text-foreground" aria-live="polite">
            {guestCount}
          </span>
        </div>

        {party.error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {party.error}
          </p>
        )}

        {selectedCeiling !== null && guestCount > 0 && guestCount <= selectedCeiling && (
          <p className="mt-3 text-xs text-muted-foreground">
            Within the {selectedCeiling}-guest request limit for this seating.
          </p>
        )}
      </div>

      {/* Navigation */}
      <div className="mt-8 flex items-center justify-between">
        <ButtonLink to="/" variant="ghost">
          <ArrowLeft className="size-4" aria-hidden />
          Back to website
        </ButtonLink>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Step 1 of 4</span>
          <Button type="button" onClick={onContinue} disabled={!canContinue}>
            Continue
          </Button>
        </div>
      </div>
    </section>
  );
}

function PartyCounter({
  label,
  value,
  onDecrement,
  onIncrement,
  onChange,
}: {
  label: string;
  value: number;
  onDecrement: () => void;
  onIncrement: () => void;
  onChange: (v: number) => void;
}) {
  const id = `party-${label.toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Fewer ${label.toLowerCase()}`}
          onClick={onDecrement}
          disabled={value <= 0}
        >
          <Minus className="size-4" aria-hidden />
        </Button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-9 w-16 rounded-md border border-input bg-background text-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`More ${label.toLowerCase()}`}
          onClick={onIncrement}
        >
          <Plus className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
