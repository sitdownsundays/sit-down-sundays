/**
 * Capacity-aware availability option card for booking Step 1.
 *
 * Client-safe, presentation-only. Reads capacity fields from the option via a
 * checked narrowing helper — never an unchecked cast. A zero maxBookablePartySize
 * marks the option as unavailable and disables new selection.
 */
import { Clock } from "lucide-react";
import { capacityFromOption, formatSeatingTime } from "@/lib/booking/wizard-helpers";
import type { PublicAvailabilityOption } from "@/lib/reservation/types";

export function OptionCard({
  option,
  selected,
  onSelect,
}: {
  option: PublicAvailabilityOption;
  selected: boolean;
  onSelect: (opt: PublicAvailabilityOption) => void;
}) {
  const cap = capacityFromOption(option);
  const isUnavailable = cap !== null && cap.maxBookablePartySize <= 0;
  return (
    <button
      key={option.seatingTime.id}
      type="button"
      onClick={() => {
        if (!isUnavailable) onSelect(option);
      }}
      aria-pressed={selected}
      disabled={isUnavailable && !selected}
      className={[
        "flex flex-col gap-1 rounded-md border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected
          ? "border-primary bg-primary/10"
          : isUnavailable
            ? "border-border bg-muted/30 opacity-60"
            : "border-border bg-background hover:border-primary/40 hover:bg-accent/40",
      ].join(" ")}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Clock className="size-4 text-primary" aria-hidden />
        {formatSeatingTime(option.seatingTime.startTime)} –{" "}
        {formatSeatingTime(option.seatingTime.endTime)}
      </span>
      <span className="text-xs text-muted-foreground">{option.spaceName}</span>
      {cap && (
        <>
          <span className="mt-1 text-xs text-muted-foreground">
            Estimated seats available: {cap.availableCapacity}
          </span>
          <span className="text-xs text-muted-foreground">
            Maximum party for this seating: {cap.maxBookablePartySize}
          </span>
        </>
      )}
      <span className="mt-1 text-xs text-muted-foreground">
        Availability is checked again when you submit.
      </span>
    </button>
  );
}
