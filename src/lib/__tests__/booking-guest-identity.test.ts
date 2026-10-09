/**
 * Focused regression tests for stable client-side guest identity.
 *
 * Exercises the actual production helpers: buildAllocations,
 * reconcileAllocations, copyMealToGuests, and buildSubmissionPayload.
 * Does not mock the guestId generator — it uses the real Web Crypto path.
 */
import { describe, expect, it } from "vitest";
import {
  buildAllocations,
  copyMealToGuests,
  reconcileAllocations,
  type GuestAllocation,
} from "@/lib/booking/meals-helpers";
import { buildSubmissionPayload } from "@/lib/booking/submit-helpers";
import { initialWizardState } from "@/lib/booking/wizard-helpers";
import type { BookWizardState } from "@/lib/booking/wizard-helpers";

/** Build a wizard state with the given allocations for payload tests. */
function stateWithAllocations(allocations: GuestAllocation[]): BookWizardState {
  const s = initialWizardState();
  return {
    ...s,
    adults: 2,
    seniors: 0,
    children: 0,
    sundayServiceId: "svc-1",
    seatingTimeId: "seat-1",
    meals: { allocations, platters: [] },
    contact: {
      ...s.contact,
      contactFirstName: "Test",
      contactLastName: "User",
      contactEmail: "test@example.com",
      contactPhone: "555-0100",
    },
  };
}

describe("guest identity — buildAllocations", () => {
  it("generates a unique guestId per allocation", () => {
    const allocs = buildAllocations(3, 0, 0);
    expect(allocs).toHaveLength(3);
    const ids = allocs.map((a) => a.guestId);
    expect(new Set(ids).size).toBe(3);
    for (const a of allocs) {
      expect(a.guestId).toBeTruthy();
      expect(a.guestId).toHaveLength(18); // 9 bytes -> 18 hex chars
    }
  });
});

describe("guest identity — reconcileAllocations", () => {
  it("adding a guest preserves existing identifiers and names", () => {
    const initial = buildAllocations(2, 0, 0);
    // Edit the name of the first guest.
    const edited = initial.map((a, i) => (i === 0 ? { ...a, name: "Alice" } : a));
    const result = reconcileAllocations(edited, 3, 0, 0);

    expect(result.removed).toEqual([]);
    expect(result.allocations).toHaveLength(3);

    // First two guests keep their original guestId and edited name.
    expect(result.allocations[0]?.guestId).toBe(initial[0]?.guestId);
    expect(result.allocations[0]?.name).toBe("Alice");
    expect(result.allocations[1]?.guestId).toBe(initial[1]?.guestId);

    // Third guest is new with a fresh guestId.
    expect(result.allocations[2]?.guestId).not.toBe(initial[0]?.guestId);
    expect(result.allocations[2]?.guestId).not.toBe(initial[1]?.guestId);
  });

  it("reindexing retained guests preserves their identifiers", () => {
    const initial = buildAllocations(0, 2, 0);
    const ids = initial.map((a) => a.guestId);

    // Reduce seniors from 2 to 1 — the surviving guest keeps its id but
    // gets re-indexed from 1 to 0.
    const result = reconcileAllocations(initial, 0, 1, 0);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0]?.guestId).toBe(ids[0]);
    expect(result.allocations[0]?.guestIndex).toBe(0);
  });

  it("removed identifiers are not reassigned to new guests", () => {
    const initial = buildAllocations(2, 1, 0); // 2 adults, 1 senior
    const removedId = initial[2]?.guestId; // the senior's id

    // Remove all seniors, add a new adult — the new adult must NOT get the
    // removed senior's guestId.
    const result = reconcileAllocations(initial, 3, 0, 0);
    expect(result.removed).toHaveLength(1); // senior removed

    const newAdult = result.allocations.find((a) => a.category === "adult" && a.guestIndex === 2);
    expect(newAdult).toBeDefined();
    expect(newAdult?.guestId).not.toBe(removedId);
  });
});

describe("guest identity — copyMealToGuests", () => {
  it("preserves source and recipient identities", () => {
    const allocs = buildAllocations(2, 1, 0);
    // Give the source (guest 0) a package + selections.
    const withPackage: GuestAllocation[] = allocs.map((a, i) =>
      i === 0
        ? {
            ...a,
            packageId: "pkg-basic",
            included: [
              { menuItemId: "m1", selectionCategory: "meat" },
              { menuItemId: "m2", selectionCategory: "meat" },
              { menuItemId: "s1", selectionCategory: "side" },
              { menuItemId: "s2", selectionCategory: "side" },
            ],
          }
        : a,
    );

    const sourceId = withPackage[0]?.guestId;
    const targetId = withPackage[1]?.guestId;
    const untouchedId = withPackage[2]?.guestId;

    const result = copyMealToGuests(withPackage, 0, [1]);

    // Source unchanged.
    expect(result[0]?.guestId).toBe(sourceId);
    expect(result[0]?.guestIndex).toBe(0);
    // Target keeps its identity but gets the copied package + selections.
    expect(result[1]?.guestId).toBe(targetId);
    expect(result[1]?.guestIndex).toBe(1);
    expect(result[1]?.packageId).toBe("pkg-basic");
    expect(result[1]?.included).toHaveLength(4);
    // Untouched guest keeps its identity and selections.
    expect(result[2]?.guestId).toBe(untouchedId);
    expect(result[2]?.packageId).toBeNull();
  });
});

describe("guest identity — buildSubmissionPayload excludes guestId", () => {
  it("submission payload maps guests without the client-only guestId", () => {
    const allocs = buildAllocations(2, 0, 0);
    const state = stateWithAllocations(allocs);
    const payload = buildSubmissionPayload(state, "test-key", 5900);

    expect(payload.guests).toHaveLength(2);
    for (const g of payload.guests) {
      expect(g).not.toHaveProperty("guestId");
      expect(g).toHaveProperty("guestIndex");
      expect(g).toHaveProperty("category");
      expect(g).toHaveProperty("packageId");
      expect(g).toHaveProperty("included");
      expect(g).toHaveProperty("addons");
    }
  });
});
