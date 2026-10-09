/**
 * Restaurant-timezone conversion — shared, client-safe, framework-independent.
 *
 * Converts a service date (YYYY-MM-DD) + seating start time (HH:MM or HH:MM:SS)
 * interpreted in the configured restaurant IANA timezone into the correct UTC
 * instant. Used by BOTH the public availability builder (server-only) and the
 * reservation submission path (server function) so seating instants and
 * balance deadlines are computed in the restaurant timezone — never the
 * server or browser host timezone.
 *
 * No server-only imports, no env access, no Supabase. Pure date/time math.
 */

/** Validate a timezone string via Intl.DateTimeFormat. */
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build an ISO (UTC) timestamp for a service date + HH:MM[:SS] start in the
 * restaurant timezone. Returns null if any input is malformed — never
 * silently normalizes invalid dates or defaults to the host timezone.
 *
 * Algorithm: treat the wall-clock components as a UTC instant, then use
 * Intl.DateTimeFormat (with the target tz) to discover what the tz's wall
 * clock reads for that instant. The difference is the tz offset; subtract it
 * to get the true UTC instant for the intended wall-clock time.
 *
 * Accepts HH:MM or HH:MM:SS start times. HH:MM and HH:MM:00 produce the same
 * instant. Correct across DST transitions (winter/summer) because the offset
 * is resolved for the specific instant.
 */
export function seatingStartISO(dateISO: string, startTime: string, tz: string): string | null {
  // dateISO is YYYY-MM-DD; startTime is HH:MM or HH:MM:SS (24h).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
  const timeMatch = startTime.match(/^([01][0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?$/);
  if (!timeMatch) return null;
  if (!isValidTimezone(tz)) return null;
  const parts = dateISO.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]) - 1; // 0-indexed month
  const d = Number(parts[2]);
  const hh = Number(timeMatch[1]);
  const mm = Number(timeMatch[2]);
  const ss = Number(timeMatch[3] ?? 0);
  // Validate the date is a REAL calendar date. Date.UTC silently rolls over
  // invalid values (month 13 → next January, day 32 → next month), so verify
  // the components round-trip exactly. Reject silently-normalized dates.
  const probe = new Date(Date.UTC(y, m, d, hh, mm, ss));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m ||
    probe.getUTCDate() !== d ||
    probe.getUTCHours() !== hh ||
    probe.getUTCMinutes() !== mm ||
    probe.getUTCSeconds() !== ss
  ) {
    return null;
  }
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const wallAsUTC = Date.UTC(y, m, d, hh, mm, ss);
  const asDate = new Date(wallAsUTC);
  const formatted = dtf.formatToParts(asDate);
  const map: Record<string, number> = {};
  for (const p of formatted) map[p.type] = Number(p.value);
  const tzWall = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    map.hour === 24 ? 0 : map.hour,
    map.minute,
    map.second,
  );
  const offset = tzWall - wallAsUTC;
  return new Date(wallAsUTC - offset).toISOString();
}

/**
 * Compute the balance deadline (ISO) by subtracting `deadlineHours` from the
 * seating start instant. Returns null if the seating instant or deadline is
 * invalid. The seating instant must already be computed in the restaurant
 * timezone via seatingStartISO.
 */
export function balanceDeadlineISO(
  seatingStartISOValue: string | null,
  deadlineHours: number,
): string | null {
  if (!seatingStartISOValue) return null;
  if (!Number.isFinite(deadlineHours) || deadlineHours < 0) return null;
  const start = new Date(seatingStartISOValue);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() - deadlineHours * 3600_000).toISOString();
}
