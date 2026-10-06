/**
 * Admin Menus — publication schedule field.
 *
 * A single publication boundary (publish or unpublish) rendered as a
 * calendar date picker + a separate time selector, with a Clear action and a
 * timezone label. Replaces the cramped datetime-local input.
 *
 * Framework-independent presentation only. The parent owns the value and
 * validation. A boundary may be fully unset (no date, no time). When a date
 * is present, a time is required; the parent surfaces that as an inline
 * error rather than silently discarding the partial value.
 */
import { useState } from "react";
import { CalendarIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ScheduleBoundaryValue {
  /** ISO date string `YYYY-MM-DD`, or "" when unset. */
  date: string;
  /** `HH:MM` (24h), or "" when unset. */
  time: string;
}

export interface ScheduleFieldProps {
  id: string;
  label: string;
  value: ScheduleBoundaryValue;
  onChange: (value: ScheduleBoundaryValue) => void;
  error?: string;
  description?: string;
  disabled?: boolean;
  /** Display label for the timezone the entered values are interpreted in. */
  timezoneLabel: string;
}

/** Generate a stable list of 15-minute time options for the selector. */
const TIME_OPTIONS: { value: string; label: string }[] = (() => {
  const out: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      const value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const label = value;
      out.push({ value, label });
    }
  }
  return out;
})();

export function ScheduleField({
  id,
  label,
  value,
  onChange,
  error,
  description,
  disabled,
  timezoneLabel,
}: ScheduleFieldProps) {
  const [open, setOpen] = useState(false);
  const dateId = `${id}-date`;
  const timeId = `${id}-time`;
  const errorId = `${id}-error`;
  const descId = `${id}-desc`;

  const selectedDate = value.date ? new Date(`${value.date}T00:00:00`) : undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={dateId}>{label}</Label>
        <span
          className="text-xs text-muted-foreground"
          aria-label={`Times are interpreted in ${timezoneLabel}`}
        >
          {timezoneLabel}
        </span>
      </div>

      {description && (
        <p id={descId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* Date picker */}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id={dateId}
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              aria-invalid={!!error}
              aria-describedby={error ? errorId : descId}
              className="h-9 min-w-[10rem] justify-start font-normal"
            >
              <CalendarIcon className="size-4 opacity-60" aria-hidden />
              {value.date
                ? new Date(`${value.date}T00:00:00`).toLocaleDateString(undefined, {
                    dateStyle: "medium",
                  })
                : "Pick a date"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(d) => {
                if (!d) return;
                const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
                  2,
                  "0",
                )}-${String(d.getDate()).padStart(2, "0")}`;
                onChange({ ...value, date: iso });
                setOpen(false);
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>

        {/* Time selector */}
        <Input
          id={timeId}
          type="time"
          value={value.time}
          onChange={(e) => onChange({ ...value, time: e.target.value })}
          disabled={disabled || !value.date}
          aria-label={`${label} time`}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          list={`${id}-time-options`}
          className="h-9 w-[7rem]"
        />
        <datalist id={`${id}-time-options`}>
          {TIME_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </datalist>

        {/* Clear */}
        {(value.date || value.time) && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 px-2 text-muted-foreground"
            onClick={() => onChange({ date: "", time: "" })}
            aria-label={`Clear ${label}`}
          >
            <XIcon className="size-4" aria-hidden />
            <span className="sr-only">Clear</span>
          </Button>
        )}
      </div>

      {error && (
        <p id={errorId} className={cn("text-xs text-destructive")} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
