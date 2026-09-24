import { describe, it, expect } from "vitest";
import {
  MOCK_RESERVATIONS,
  MOCK_MENU_ITEMS,
  MOCK_USERS,
  MOCK_TABLES,
  MOCK_WAITLIST,
  MOCK_GUEST_REQUESTS,
  MOCK_SUNDAY_SERVICES,
  MOCK_SEATING_TIMES,
} from "@/lib/mock/data";
import { RESERVATION_STATUSES, PAYMENT_STATUSES } from "@/lib/domain/statuses";
import { ROLE_KEYS } from "@/lib/domain";
import type { RoleKey } from "@/lib/domain/types";

describe("mock data consistency", () => {
  it("reservations reference existing menu items", () => {
    const ids = new Set(MOCK_MENU_ITEMS.map((i) => i.id));
    for (const r of MOCK_RESERVATIONS) {
      for (const m of r.mealSelections) {
        expect(ids.has(m.menuItemId)).toBe(true);
      }
    }
  });

  it("reservations reference existing sunday services and seating times", () => {
    const sundays = new Set(MOCK_SUNDAY_SERVICES.map((s) => s.id));
    const seatings = new Set(MOCK_SEATING_TIMES.map((s) => s.id));
    for (const r of MOCK_RESERVATIONS) {
      expect(sundays.has(r.sundayServiceId)).toBe(true);
      expect(seatings.has(r.seatingTimeId)).toBe(true);
    }
  });

  it("reservations have valid statuses", () => {
    for (const r of MOCK_RESERVATIONS) {
      expect(RESERVATION_STATUSES).toContain(r.status);
      expect(PAYMENT_STATUSES).toContain(r.paymentStatus);
    }
  });

  it("reservations carry pricing and policy snapshots", () => {
    for (const r of MOCK_RESERVATIONS) {
      expect(r.pricing).toBeDefined();
      expect(r.policy).toBeDefined();
      expect(r.policy.capturedAt).toBeTruthy();
      for (const m of r.mealSelections) {
        expect(m.itemNameSnapshot).toBeTruthy();
        expect(m.priceCentsSnapshot).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("reservations have status history", () => {
    for (const r of MOCK_RESERVATIONS) {
      expect(r.statusHistory.length).toBeGreaterThan(0);
    }
  });

  it("users have valid roles", () => {
    for (const u of MOCK_USERS) {
      expect(ROLE_KEYS).toContain(u.roleKey as RoleKey);
    }
  });

  it("tables have unique labels", () => {
    const labels = MOCK_TABLES.map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("waitlist entries have required contact fields", () => {
    for (const w of MOCK_WAITLIST) {
      expect(w.fullName).toBeTruthy();
      expect(w.email).toContain("@");
    }
  });

  it("guest requests have valid categories", () => {
    const cats = ["general", "dietary", "transfer", "cancellation", "billing", "other"];
    for (const g of MOCK_GUEST_REQUESTS) {
      expect(cats).toContain(g.category);
    }
  });

  it("internal notes are present and typed separately from guest notes", () => {
    for (const r of MOCK_RESERVATIONS) {
      // internalNotes and guestNotes are distinct fields on the type
      expect("internalNotes" in r).toBe(true);
      expect("guestNotes" in r).toBe(true);
    }
  });
});
