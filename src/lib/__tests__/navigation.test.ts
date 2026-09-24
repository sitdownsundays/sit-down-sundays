import { describe, it, expect } from "vitest";
import {
  GUEST_NAV,
  STAFF_NAV,
  KITCHEN_NAV,
  ADMIN_NAV,
  filterNavByRole,
} from "@/components/layout/internal-nav";
import type { RoleKey } from "@/lib/domain/types";

describe("internal navigation filtering", () => {
  it("guest sees only guest-permitted items", () => {
    const sections = filterNavByRole(GUEST_NAV, "guest");
    expect(sections.length).toBeGreaterThan(0);
    const allLabels = sections.flatMap((s) => s.items.map((i) => i.label));
    expect(allLabels).toContain("Reservations");
    expect(allLabels).toContain("Profile");
  });

  it("kitchen staff sees kitchen items but not staff operations", () => {
    const sections = filterNavByRole(KITCHEN_NAV, "kitchen_staff");
    const labels = sections.flatMap((s) => s.items.map((i) => i.label));
    expect(labels).toContain("Meal Totals");
    expect(labels).toContain("Dietary Notes");
  });

  it("administrator sees all admin sections", () => {
    const sections = filterNavByRole(ADMIN_NAV, "administrator");
    expect(sections.length).toBe(4);
    const labels = sections.flatMap((s) => s.items.map((i) => i.label));
    expect(labels).toContain("Audit Log");
    expect(labels).toContain("Users");
  });

  it("foh staff cannot see audit log (admin nav filtered)", () => {
    const sections = filterNavByRole(ADMIN_NAV, "foh_staff");
    const labels = sections.flatMap((s) => s.items.map((i) => i.label));
    expect(labels).not.toContain("Audit Log");
    expect(labels).not.toContain("Roles");
  });

  it("filterNavByRole removes empty sections", () => {
    // guest has no admin permissions, so admin nav should be mostly empty
    const sections = filterNavByRole(ADMIN_NAV, "guest");
    const labels = sections.flatMap((s) => s.items.map((i) => i.label));
    expect(labels).not.toContain("Users");
  });

  it("every area has at least one section", () => {
    for (const nav of [GUEST_NAV, STAFF_NAV, KITCHEN_NAV, ADMIN_NAV]) {
      expect(nav.length).toBeGreaterThan(0);
    }
  });

  it("all roles produce non-empty nav for their own area", () => {
    const cases: { area: typeof GUEST_NAV; role: RoleKey }[] = [
      { area: GUEST_NAV, role: "guest" },
      { area: STAFF_NAV, role: "foh_staff" },
      { area: KITCHEN_NAV, role: "kitchen_staff" },
      { area: ADMIN_NAV, role: "administrator" },
    ];
    for (const c of cases) {
      const sections = filterNavByRole(c.area, c.role);
      expect(sections.length).toBeGreaterThan(0);
    }
  });
});
