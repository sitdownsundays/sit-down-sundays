/**
 * Restaurant-timezone conversion — behavioral tests against the real
 * production helpers in src/lib/reservation/timezone.ts.
 *
 * These exercise the actual seatingStartISO / balanceDeadlineISO / isValidTimezone
 * functions. No database or Supabase. The runtime (host) timezone is irrelevant
 * to the results because the helpers interpret wall-clock time in the supplied
 * restaurant IANA timezone, never the host timezone.
 */
import { describe, it, expect } from "vitest";
import { isValidTimezone, seatingStartISO, balanceDeadlineISO } from "@/lib/reservation/timezone";

describe("isValidTimezone", () => {
  it("accepts valid IANA timezones", () => {
    expect(isValidTimezone("America/Chicago")).toBe(true);
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("Europe/London")).toBe(true);
    expect(isValidTimezone("Australia/Sydney")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
  });

  it("rejects invalid timezones", () => {
    expect(isValidTimezone("Not/A/Zone")).toBe(false);
    expect(isValidTimezone("Chicago")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});

describe("seatingStartISO — restaurant timezone, not host timezone", () => {
  it("converts a Chicago noon seating to the correct UTC instant", () => {
    // America/Chicago is UTC-6 in winter (CST). Noon Chicago = 18:00 UTC.
    const iso = seatingStartISO("2026-01-04", "12:00", "America/Chicago");
    expect(iso).toBe("2026-01-04T18:00:00.000Z");
  });

  it("converts a New York noon seating to a different UTC instant than Chicago", () => {
    // America/New_York is UTC-5 in winter (EST). Noon NY = 17:00 UTC.
    const ny = seatingStartISO("2026-01-04", "12:00", "America/New_York");
    expect(ny).toBe("2026-01-04T17:00:00.000Z");
    // Chicago noon is one hour earlier in UTC than NY noon.
    const chi = seatingStartISO("2026-01-04", "12:00", "America/Chicago");
    expect(chi).toBe("2026-01-04T18:00:00.000Z");
    expect(ny).not.toBe(chi);
  });

  it("produces the same instant for HH:MM and HH:MM:SS when seconds are zero", () => {
    const noSeconds = seatingStartISO("2026-07-05", "16:30", "America/Chicago");
    const withSeconds = seatingStartISO("2026-07-05", "16:30:00", "America/Chicago");
    expect(noSeconds).toBe(withSeconds);
  });

  it("respects seconds when provided", () => {
    const iso = seatingStartISO("2026-01-04", "12:00:30", "America/Chicago");
    expect(iso).toBe("2026-01-04T18:00:30.000Z");
  });

  it("applies daylight saving: winter vs summer in America/Chicago", () => {
    // Winter (CST, UTC-6): 2026-01-04 noon Chicago = 18:00 UTC.
    const winter = seatingStartISO("2026-01-04", "12:00", "America/Chicago");
    expect(winter).toBe("2026-01-04T18:00:00.000Z");
    // Summer (CDT, UTC-5): 2026-07-05 noon Chicago = 17:00 UTC.
    const summer = seatingStartISO("2026-07-05", "12:00", "America/Chicago");
    expect(summer).toBe("2026-07-05T17:00:00.000Z");
    // Same wall-clock time, different UTC instant due to DST.
    expect(winter).not.toBe(summer);
  });

  it("applies daylight saving: winter vs summer in Australia/Sydney (southern hemisphere)", () => {
    // Sydney is UTC+11 in summer (AEDT) and UTC+10 in winter (AEST).
    // Sydney summer ~ Jan: noon = 01:00 UTC (previous day).
    const jan = seatingStartISO("2026-01-04", "12:00", "Australia/Sydney");
    expect(jan).toBe("2026-01-04T01:00:00.000Z");
    // Sydney winter ~ Jul: noon = 02:00 UTC.
    const jul = seatingStartISO("2026-07-05", "12:00", "Australia/Sydney");
    expect(jul).toBe("2026-07-05T02:00:00.000Z");
    expect(jan).not.toBe(jul);
  });

  it("handles the latest permitted start (16:30) within the noon–7 PM window", () => {
    const iso = seatingStartISO("2026-07-05", "16:30", "America/Chicago");
    // Summer CDT UTC-5: 16:30 Chicago = 21:30 UTC.
    expect(iso).toBe("2026-07-05T21:30:00.000Z");
  });

  it("rejects invalid dates", () => {
    expect(seatingStartISO("2026-13-04", "12:00", "America/Chicago")).toBeNull();
    expect(seatingStartISO("not-a-date", "12:00", "America/Chicago")).toBeNull();
    expect(seatingStartISO("2026-1-4", "12:00", "America/Chicago")).toBeNull();
  });

  it("rejects invalid times", () => {
    expect(seatingStartISO("2026-01-04", "25:00", "America/Chicago")).toBeNull();
    expect(seatingStartISO("2026-01-04", "12:60", "America/Chicago")).toBeNull();
    expect(seatingStartISO("2026-01-04", "noon", "America/Chicago")).toBeNull();
    expect(seatingStartISO("2026-01-04", "", "America/Chicago")).toBeNull();
  });

  it("rejects invalid or missing timezones", () => {
    expect(seatingStartISO("2026-01-04", "12:00", "Not/A/Zone")).toBeNull();
    expect(seatingStartISO("2026-01-04", "12:00", "")).toBeNull();
  });
});

describe("balanceDeadlineISO — configured hours before seating", () => {
  it("a 72-hour deadline is exactly 72 hours before the seating instant", () => {
    const seating = seatingStartISO("2026-07-05", "12:00", "America/Chicago");
    expect(seating).toBe("2026-07-05T17:00:00.000Z");
    const deadline = balanceDeadlineISO(seating, 72);
    // 72 hours before 2026-07-05T17:00:00Z = 2026-07-02T17:00:00Z.
    expect(deadline).toBe("2026-07-02T17:00:00.000Z");
    const diffMs = new Date(seating!).getTime() - new Date(deadline!).getTime();
    expect(diffMs).toBe(72 * 3600_000);
  });

  it("preserves the restaurant timezone offset across the deadline (winter)", () => {
    const seating = seatingStartISO("2026-01-04", "12:00", "America/Chicago");
    expect(seating).toBe("2026-01-04T18:00:00.000Z");
    const deadline = balanceDeadlineISO(seating, 72);
    expect(deadline).toBe("2026-01-01T18:00:00.000Z");
  });

  it("a 0-hour deadline equals the seating instant", () => {
    const seating = seatingStartISO("2026-07-05", "12:00", "America/Chicago");
    const deadline = balanceDeadlineISO(seating, 0);
    expect(deadline).toBe(seating);
  });

  it("returns null for a null seating instant", () => {
    expect(balanceDeadlineISO(null, 72)).toBeNull();
  });

  it("returns null for invalid deadline hours", () => {
    const seating = seatingStartISO("2026-07-05", "12:00", "America/Chicago");
    expect(balanceDeadlineISO(seating, -1)).toBeNull();
    expect(balanceDeadlineISO(seating, Number.NaN)).toBeNull();
    expect(balanceDeadlineISO(seating, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("returns null for an invalid seating instant string", () => {
    expect(balanceDeadlineISO("not-a-date", 72)).toBeNull();
  });
});
