/**
 * Booking wizard helpers — client-safe, framework-independent.
 *
 * Pure functions for Step 1 (Sunday & guests): grouping availability options
 * by Sunday date, reconciling a selection after a refresh, validating party
 * composition, and formatting dates/times in the restaurant timezone (never
 * the browser timezone).
 *
 * No server-only imports, no env access, no Supabase.
 */
import type { PublicAvailabilityOption } from "@/lib/reservation/types";
import type { MealsWizardState } from "@/lib/booking/meals-helpers";

export type BookStep = "sunday" | "meals" | "info" | "review";

export const BOOK_STEPS: BookStep[] = ["sunday", "meals", "info", "review"];

export const STEP_LABELS: ReadonlyArray<{ id: BookStep; label: string }> = [
  { id: "sunday", label: "Sunday & guests" },
  { id: "meals", label: "Meals & extras" },
  { id: "info", label: "Your information" },
  { id: "review", label: "Review request" },
];

export interface BookWizardState {
  step: BookStep;
  sundayServiceId: string | null;
  seatingTimeId: string | null;
  /** The selected availability option snapshot (for display + ceiling). */
  selectedOption: PublicAvailabilityOption | null;
  adults: number;
  seniors: number;
  children: number;
  /** Step 2 meals state (guest allocations + shared platters). */
  meals: MealsWizardState;
  /** Step 3 contact + request information. */
  contact: ContactWizardState;
}

export interface ContactWizardState {
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone: string;
  dietaryNotes: string;
  accessibilityRequests: string;
  occasion: string;
  guestNotes: string;
}

export function initialWizardState(): BookWizardState {
  return {
    step: "sunday",
    sundayServiceId: null,
    seatingTimeId: null,
    selectedOption: null,
    adults: 0,
    seniors: 0,
    children: 0,
    meals: { allocations: [], platters: [] },
    contact: {
      contactFirstName: "",
      contactLastName: "",
      contactEmail: "",
      contactPhone: "",
      dietaryNotes: "",
      accessibilityRequests: "",
      occasion: "",
      guestNotes: "",
    },
  };
}

/** A Sunday date group with its seating options, ordered by date then start time. */
export interface SundayGroup {
  serviceId: string;
  date: string;
  serviceLabel: string;
  options: Array<PublicAvailabilityOption & { restaurantTimezone?: string }>;
}

/**
 * Group availability options by Sunday service date, ordered by date then
 * seating start time. Deterministic ordering regardless of API response order.
 */
export function groupOptionsBySunday(options: PublicAvailabilityOption[]): SundayGroup[] {
  const map = new Map<string, SundayGroup>();
  for (const opt of options) {
    const key = opt.sundayService.id;
    const existing = map.get(key);
    if (existing) {
      existing.options.push(opt);
    } else {
      map.set(key, {
        serviceId: opt.sundayService.id,
        date: opt.sundayService.date,
        serviceLabel: opt.sundayService.label,
        options: [opt],
      });
    }
  }
  const groups = Array.from(map.values());
  // Sort by date ascending, then by seating start time ascending.
  groups.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.options[0]?.seatingTime.startTime ?? "").localeCompare(
      b.options[0]?.seatingTime.startTime ?? "",
    );
  });
  // Sort options within each group by start time.
  for (const g of groups) {
    g.options.sort((a, b) => a.seatingTime.startTime.localeCompare(b.seatingTime.startTime));
  }
  return groups;
}

/** Find an option by service + seating IDs. */
export function findOption(
  options: PublicAvailabilityOption[],
  serviceId: string | null,
  seatingId: string | null,
): PublicAvailabilityOption | null {
  if (!serviceId || !seatingId) return null;
  return (
    options.find((o) => o.sundayService.id === serviceId && o.seatingTime.id === seatingId) ?? null
  );
}

/**
 * Apply a refreshed availability response to the current wizard state.
 *
 * Pure: returns the next state and an optional notice string. Does NOT mutate
 * inputs and does NOT trigger side effects. Reconciles the current selection
 * against the refreshed options:
 *  - A still-valid selection keeps its service/seating IDs and is updated with
 *    the latest ceiling snapshot.
 *  - A selection that disappeared is cleared, and a safe explanatory notice is
 *    returned.
 *  - Guest counts are always preserved (never silently reduced).
 *
 * This is the single state-transition used by the wizard's availability
 * refresh handler, extracted so it can be tested without rendering.
 */
export function applyRefresh(
  currentState: BookWizardState,
  options: PublicAvailabilityOption[],
): { state: BookWizardState; notice: string | null } {
  const rec = reconcileSelection(currentState, options);
  return {
    state: rec.state,
    notice: rec.cleared && rec.reason ? rec.reason : null,
  };
}

/**
 * Reconcile the current selection against refreshed options.
 * If the selected service/seating is no longer offered, clear it and return a
 * safe reason. Preserves party counts.
 */
export function reconcileSelection(
  state: BookWizardState,
  options: PublicAvailabilityOption[],
): { state: BookWizardState; cleared: boolean; reason: string | null } {
  const found = findOption(options, state.sundayServiceId, state.seatingTimeId);
  if (found) {
    // Selection still valid; update the snapshot (ceiling/label may have changed).
    if (state.selectedOption !== found) {
      return { state: { ...state, selectedOption: found }, cleared: false, reason: null };
    }
    return { state, cleared: false, reason: null };
  }
  if (state.sundayServiceId === null && state.seatingTimeId === null) {
    return { state, cleared: false, reason: null };
  }
  return {
    state: {
      ...state,
      sundayServiceId: null,
      seatingTimeId: null,
      selectedOption: null,
    },
    cleared: true,
    reason:
      "Your previously selected Sunday or seating time is no longer available. Please choose another.",
  };
}

/** Total guests derived from the three category counts. */
export function totalGuests(state: BookWizardState): number {
  return state.adults + state.seniors + state.children;
}

export interface PartyValidation {
  error: string | null;
}

/**
 * Validate party composition for Step 1:
 *  - At least one guest.
 *  - Nonnegative whole numbers.
 *  - Within the selected seating's configured request ceiling (if any).
 *  - Within the schema-level party limit.
 *
 * Does NOT invent qualifying ages, discount values, or a minimum party size.
 * A lower ceiling after changing seating surfaces a validation error rather
 * than silently reducing guest counts.
 */
export function validateParty(state: BookWizardState, ceiling: number | null): PartyValidation {
  const { adults, seniors, children } = state;
  if (
    !Number.isInteger(adults) ||
    !Number.isInteger(seniors) ||
    !Number.isInteger(children) ||
    adults < 0 ||
    seniors < 0 ||
    children < 0
  ) {
    return { error: "Guest counts must be whole numbers." };
  }
  const total = adults + seniors + children;
  if (total < 1) {
    return { error: "Please enter at least one guest." };
  }
  if (ceiling !== null && total > ceiling) {
    return {
      error: `This seating allows up to ${ceiling} guests per request. Please choose a different seating or reduce your party size.`,
    };
  }
  if (total > SCHEMA_PARTY_LIMIT) {
    return {
      error: `Party size cannot exceed ${SCHEMA_PARTY_LIMIT} guests. Please contact us for larger groups.`,
    };
  }
  return { error: null };
}

/** Schema-level party limit (mirrors the submission schema). */
export const SCHEMA_PARTY_LIMIT = 200;

/**
 * Format a service date (YYYY-MM-DD) for display.
 *
 * The date is treated as a CALENDAR DATE, not an instant. Its exact
 * year/month/day is preserved regardless of the runtime/browser timezone —
 * no midnight-in-local-tz interpretation and no noon-UTC workaround. The
 * weekday is derived from the proleptic Gregorian calendar date itself.
 *
 * The `timezone` argument is accepted for API compatibility but is NOT used
 * to shift the displayed day; actual seating-instant/deadline conversion uses
 * the configured restaurant timezone separately (see reservation/timezone.ts).
 */
export function formatServiceDate(dateISO: string, _timezone?: string): string {
  const m = dateISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateISO;
  const year = Number(m[1]);
  const month = Number(m[2]); // 1-12
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return dateISO;

  // Weekday from the calendar date (Zeller's congruence), independent of tz.
  const weekday = weekdayName(year, month, day);
  const monthName = MONTH_NAMES[month - 1];
  if (!weekday || !monthName) return dateISO;
  return `${weekday}, ${monthName} ${day}, ${year}`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/**
 * Return the weekday name for a Gregorian calendar date (Zeller's
 * congruence). Returns null for out-of-range month/day. Pure and
 * timezone-independent.
 */
function weekdayName(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Zeller's congruence expects January & February as months 13 & 14 of the
  // previous year.
  let y = year;
  let m = month;
  if (m < 3) {
    m += 12;
    y -= 1;
  }
  const k = y % 100;
  const j = Math.floor(y / 100);
  const h =
    (day + Math.floor((13 * (m + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) + 5 * j) % 7;
  // h: 0 = Saturday, 1 = Sunday, ..., 6 = Friday
  const idx = (h + 6) % 7; // 0 = Sunday ... 6 = Saturday
  return WEEKDAY_NAMES[idx] ?? null;
}

/**
 * Format a seating time (HH:MM or HH:MM:SS) for display. Returns a friendly
 * 12-hour label. Seconds are ignored for display.
 */
export function formatSeatingTime(time: string): string {
  const match = time.match(/^([01][0-9]|2[0-3]):([0-5][0-9])/);
  if (!match) return time;
  let hh = Number(match[1]);
  const mm = match[2];
  const period = hh >= 12 ? "PM" : "AM";
  if (hh === 0) hh = 12;
  else if (hh > 12) hh -= 12;
  return `${hh}:${mm} ${period}`;
}
