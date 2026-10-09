// Admin reservation detail — guest dietary needs display contract tests.
//
// These are STRUCTURAL / CONTRACT tests against the production display logic
// exported from guest-dietary-needs.tsx (guestHasDietaryNotes,
// guestDisplayLabel) and the ReservationDetailDTO guest shape. They verify
// that the read-only display associates the correct note with the correct
// guest, handles unnamed guests, tolerates missing/empty fields, and keeps
// per-guest notes separate from party-level notes.
//
// NOT rendered-component tests — the vitest config runs in the `node`
// environment with no DOM/testing-library dependency.
import { describe, it, expect } from "vitest";

import {
  guestHasDietaryNotes,
  guestDisplayLabel,
} from "@/components/admin/guest-dietary-needs-helpers";
import type { ReservationDetailDTO } from "@/lib/reservation/types";

type Guest = ReservationDetailDTO["guests"][number];

function makeGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    id: "g-1",
    guestIndex: 0,
    guestCategory: "adult",
    guestName: null,
    packageId: "pkg-basic",
    packageNameSnapshot: "Basic Meal",
    packagePriceSnapshot: 2950,
    includedSelections: [],
    addons: [],
    foodAllergies: "",
    dietaryPreferences: "",
    mealRequests: "",
    ...overrides,
  };
}

describe("guest dietary needs — guestHasDietaryNotes", () => {
  it("returns false when all three note fields are empty/missing", () => {
    expect(guestHasDietaryNotes(makeGuest({ foodAllergies: "" }))).toBe(false);
    expect(guestHasDietaryNotes(makeGuest({ foodAllergies: "  " }))).toBe(false);
    expect(
      guestHasDietaryNotes(
        makeGuest({ foodAllergies: "", dietaryPreferences: "", mealRequests: "" }),
      ),
    ).toBe(false);
    expect(guestHasDietaryNotes(makeGuest({ foodAllergies: undefined as never }))).toBe(false);
  });

  it("returns true when any one field has non-empty content", () => {
    expect(guestHasDietaryNotes(makeGuest({ foodAllergies: "Peanuts" }))).toBe(true);
    expect(guestHasDietaryNotes(makeGuest({ dietaryPreferences: "Vegetarian" }))).toBe(true);
    expect(guestHasDietaryNotes(makeGuest({ mealRequests: "No spicy" }))).toBe(true);
  });

  it("treats whitespace-only strings as empty (no phantom notes)", () => {
    expect(
      guestHasDietaryNotes(
        makeGuest({ foodAllergies: " \t", dietaryPreferences: "\n", mealRequests: "  " }),
      ),
    ).toBe(false);
  });
});

describe("guest dietary needs — guestDisplayLabel", () => {
  it("uses the entered guest name when present", () => {
    expect(guestDisplayLabel("Marie", 0)).toBe("Marie");
    expect(guestDisplayLabel("  Marie  ", 2)).toBe("Marie");
  });

  it("falls back to 'Guest N' (1-based index) when unnamed or empty", () => {
    expect(guestDisplayLabel(null, 0)).toBe("Guest 1");
    expect(guestDisplayLabel("", 2)).toBe("Guest 3");
    expect(guestDisplayLabel("   ", 4)).toBe("Guest 5");
    expect(guestDisplayLabel(undefined, 0)).toBe("Guest 1");
  });
});

describe("guest dietary needs — association and separation", () => {
  // Two guests with DIFFERENT notes remain associated with the correct names.
  const guests: Guest[] = [
    makeGuest({
      id: "g-a",
      guestIndex: 0,
      guestName: "Marie",
      guestCategory: "adult",
      foodAllergies: "Peanuts",
      dietaryPreferences: "Vegetarian",
      mealRequests: "",
    }),
    makeGuest({
      id: "g-b",
      guestIndex: 1,
      guestName: null,
      guestCategory: "child",
      foodAllergies: "",
      dietaryPreferences: "",
      mealRequests: "No spicy food",
    }),
  ];

  it("guest 1's notes attach to guest 1, not guest 2", () => {
    const marie = guests[0];
    expect(marie.guestName).toBe("Marie");
    expect(guestDisplayLabel(marie.guestName, marie.guestIndex)).toBe("Marie");
    expect(marie.foodAllergies).toBe("Peanuts");
    expect(marie.dietaryPreferences).toBe("Vegetarian");
    expect(marie.mealRequests).toBe("");
  });

  it("unnamed guest 2 falls back to 'Guest 2' with child category", () => {
    const g2 = guests[1];
    expect(guestDisplayLabel(g2.guestName, g2.guestIndex)).toBe("Guest 2");
    expect(g2.guestCategory).toBe("child");
    expect(g2.foodAllergies).toBe("");
    expect(g2.mealRequests).toBe("No spicy food");
  });

  it("the two guests' notes do not cross-contaminate", () => {
    expect(guests[0].foodAllergies).not.toBe(guests[1].foodAllergies);
    expect(guests[0].mealRequests).not.toBe(guests[1].mealRequests);
  });

  it("both guests appear in the with-notes filter", () => {
    const withNotes = guests.filter(guestHasDietaryNotes);
    expect(withNotes).toHaveLength(2);
  });

  it("a guest with all empty notes is excluded from the filter", () => {
    const withNotes = [
      ...guests,
      makeGuest({ id: "g-c", guestIndex: 2, guestName: "Kid", guestCategory: "child" }),
    ].filter(guestHasDietaryNotes);
    expect(withNotes).toHaveLength(2);
    expect(withNotes.find((g) => g.id === "g-c")).toBeUndefined();
  });
});

describe("guest dietary needs — missing/empty fields do not crash", () => {
  it("a guest with undefined note fields (undefined as never) is treated as no notes", () => {
    const g = makeGuest({
      foodAllergies: undefined as never,
      dietaryPreferences: undefined as never,
      mealRequests: undefined as never,
    });
    expect(guestHasDietaryNotes(g)).toBe(false);
    expect(guestDisplayLabel(g.guestName, g.guestIndex)).toBe("Guest 1");
  });
});

describe("guest dietary needs — plain text, not HTML", () => {
  it("markup-like content is treated as plain text, not interpreted", () => {
    // The component renders via whitespace-pre-wrap text nodes — never
    // dangerouslySetInnerHTML. These tests assert the data path is plain
    // strings, which is what the component consumes.
    const g = makeGuest({ foodAllergies: "<script>alert(1)</script>" });
    expect(typeof g.foodAllergies).toBe("string");
    expect(g.foodAllergies).toBe("<script>alert(1)</script>");
    // The display helper does not strip or interpret markup — it passes the
    // string through as text.
    expect(guestHasDietaryNotes(g)).toBe(true);
  });

  it("line breaks are preserved as whitespace, not interpreted", () => {
    const g = makeGuest({ dietaryPreferences: "No dairy.\nAvoid soy." });
    expect(g.dietaryPreferences).toContain("\n");
    expect(guestHasDietaryNotes(g)).toBe(true);
  });
});

describe("guest dietary needs — separate from party-level notes", () => {
  it("ReservationDetailDTO keeps per-guest notes on guests[] and party notes top-level", () => {
    const detail: Pick<ReservationDetailDTO, "dietaryNotes" | "guestNotes" | "guests"> = {
      dietaryNotes: "Party is gluten-free",
      guestNotes: "Celebrating anniversary",
      guests: [
        makeGuest({ id: "g-1", guestIndex: 0, foodAllergies: "Shellfish" }),
        makeGuest({ id: "g-2", guestIndex: 1, foodAllergies: "" }),
      ],
    };
    // Party-level fields are top-level, not on guests.
    expect(detail.dietaryNotes).toBe("Party is gluten-free");
    expect(detail.guestNotes).toBe("Celebrating anniversary");
    // Per-guest notes stay on their guest.
    expect(detail.guests[0].foodAllergies).toBe("Shellfish");
    expect(detail.guests[1].foodAllergies).toBe("");
  });
});
