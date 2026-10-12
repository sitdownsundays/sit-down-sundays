import { describe, expect, it } from "vitest";
import {
  availableCapacity,
  computeHoldDeadline,
  HOLD_DEADLINE_HOURS,
  intervalsOverlap,
  isCapacityEligibleStatus,
  isHierarchyValid,
  isHoldActive,
  isReleased,
  mayoralFamilyLockSet,
  peakOccupancy,
  type CapacityHoldInput,
  type CapacityResourceInput,
} from "@/lib/server/capacity-helpers.server";

// Fixed test clock
const NOW = 1_700_000_000_000; // arbitrary epoch ms
const SEATING_START = NOW;
const SEATING_END = NOW + 3 * 60 * 60 * 1000; // 3h seating

// --- Resources (mirror the 0019 slug-based seed) -------------------------
const ballroom: CapacityResourceInput = {
  id: "ballroom",
  totalCapacity: 950,
  parentId: null,
};
const mayoral: CapacityResourceInput = {
  id: "mayoral",
  totalCapacity: 120,
  parentId: null,
};
const mayoral1: CapacityResourceInput = {
  id: "mayoral-1",
  totalCapacity: 60,
  parentId: "mayoral",
};
const mayoral2: CapacityResourceInput = {
  id: "mayoral-2",
  totalCapacity: 60,
  parentId: "mayoral",
};

const allResources = new Map<string, CapacityResourceInput>([
  [ballroom.id, ballroom],
  [mayoral.id, mayoral],
  [mayoral1.id, mayoral1],
  [mayoral2.id, mayoral2],
]);

// Helper: make a hold
function hold(
  resourceId: string,
  partySize: number,
  start: number,
  end: number,
  opts: {
    state?: "held" | "allocated" | "released";
    deadline?: number | null;
  } = {},
): CapacityHoldInput {
  return {
    capacityResourceId: resourceId,
    partySize,
    seatingStart: start,
    seatingEnd: end,
    state: opts.state ?? "allocated",
    holdDeadline: opts.deadline ?? null,
  };
}

describe("intervalsOverlap", () => {
  it("detects overlap", () => {
    expect(intervalsOverlap(0, 100, 50, 150)).toBe(true);
  });
  it("back-to-back does not overlap", () => {
    expect(intervalsOverlap(0, 100, 100, 200)).toBe(false);
  });
  it("disjoint does not overlap", () => {
    expect(intervalsOverlap(0, 100, 200, 300)).toBe(false);
  });
  it("identical intervals overlap", () => {
    expect(intervalsOverlap(0, 100, 0, 100)).toBe(true);
  });
});

describe("isReleased / isHoldActive — safe expiration", () => {
  it("released is not active", () => {
    expect(isReleased(hold("r", 10, 0, 100, { state: "released" }))).toBe(true);
    expect(isHoldActive(hold("r", 10, 0, 100, { state: "released" }), NOW)).toBe(false);
  });
  it("allocated is active even past any deadline", () => {
    expect(isHoldActive(hold("r", 10, 0, 100, { state: "allocated" }), NOW)).toBe(true);
  });
  it("held with unexpired deadline is active", () => {
    expect(isHoldActive(hold("r", 10, 0, 100, { state: "held", deadline: NOW + 1000 }), NOW)).toBe(
      true,
    );
  });
  it("held with EXPIRED deadline is STILL active — expiration is not a release", () => {
    expect(isHoldActive(hold("r", 10, 0, 100, { state: "held", deadline: NOW - 1000 }), NOW)).toBe(
      true,
    );
  });
});

describe("mayoralFamilyLockSet", () => {
  it("standalone locks only itself", () => {
    expect(mayoralFamilyLockSet(ballroom, allResources)).toEqual(["ballroom"]);
  });
  it("whole locks parent + all sections", () => {
    expect(mayoralFamilyLockSet(mayoral, allResources)).toEqual([
      "mayoral",
      "mayoral-1",
      "mayoral-2",
    ]);
  });
  it("section locks parent + self", () => {
    expect(mayoralFamilyLockSet(mayoral1, allResources)).toEqual(["mayoral", "mayoral-1"]);
    expect(mayoralFamilyLockSet(mayoral2, allResources)).toEqual(["mayoral", "mayoral-2"]);
  });
});

describe("isHierarchyValid", () => {
  it("valid standalone", () => {
    expect(isHierarchyValid(ballroom, allResources)).toBe(true);
  });
  it("valid whole (no parent)", () => {
    expect(isHierarchyValid(mayoral, allResources)).toBe(true);
  });
  it("valid section (references whole parent)", () => {
    expect(isHierarchyValid(mayoral1, allResources)).toBe(true);
  });
  it("rejects self-reference", () => {
    const self: CapacityResourceInput = {
      id: "x",
      totalCapacity: 10,
      parentId: "x",
    };
    expect(isHierarchyValid(self, new Map([["x", self]]))).toBe(false);
  });
  it("rejects missing parent", () => {
    const orphan: CapacityResourceInput = {
      id: "o",
      totalCapacity: 10,
      parentId: "missing",
    };
    expect(isHierarchyValid(orphan, new Map([["o", orphan]]))).toBe(false);
  });
});

describe("availableCapacity — Ballroom (standalone)", () => {
  it("full capacity with no holds", () => {
    expect(availableCapacity(ballroom, allResources, [], SEATING_START, SEATING_END, NOW)).toBe(
      950,
    );
  });
  it("subtracts an overlapping allocated hold", () => {
    const holds = [hold("ballroom", 100, SEATING_START, SEATING_END)];
    expect(availableCapacity(ballroom, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      850,
    );
  });
  it("ignores non-overlapping holds (back-to-back)", () => {
    const holds = [hold("ballroom", 100, SEATING_END, SEATING_END + 3 * 60 * 60 * 1000)];
    expect(availableCapacity(ballroom, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      950,
    );
  });
  it("ignores released holds", () => {
    const holds = [hold("ballroom", 100, SEATING_START, SEATING_END, { state: "released" })];
    expect(availableCapacity(ballroom, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      950,
    );
  });
});

describe("availableCapacity — Mayoral exclusivity", () => {
  it("each section starts at 60, whole at 120", () => {
    expect(availableCapacity(mayoral1, allResources, [], SEATING_START, SEATING_END, NOW)).toBe(60);
    expect(availableCapacity(mayoral2, allResources, [], SEATING_START, SEATING_END, NOW)).toBe(60);
    expect(availableCapacity(mayoral, allResources, [], SEATING_START, SEATING_END, NOW)).toBe(120);
  });

  it("a whole-room hold of ANY size blocks both sections regardless of party size", () => {
    // Even a 1-person whole-room hold blocks BOTH sections for the same interval.
    const holds = [hold("mayoral", 1, SEATING_START, SEATING_END)];
    expect(availableCapacity(mayoral1, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
    expect(availableCapacity(mayoral2, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
    expect(availableCapacity(mayoral, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      119,
    );
  });

  it("a full 120-person whole-room hold blocks both sections and the whole", () => {
    const holds = [hold("mayoral", 120, SEATING_START, SEATING_END)];
    expect(availableCapacity(mayoral, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
    expect(availableCapacity(mayoral1, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
    expect(availableCapacity(mayoral2, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
  });

  it("any overlapping section booking blocks the whole-room booking", () => {
    const holds = [hold("mayoral-1", 60, SEATING_START, SEATING_END)];
    // EXCLUSIVITY: a section hold (section MODE) blocks whole-room MODE → 0.
    // It is not 120 − 60 = 60; whole and section modes cannot coexist.
    expect(availableCapacity(mayoral, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
  });

  it("separate sections can be used concurrently (60 + 60 <= 120)", () => {
    const holds = [hold("mayoral-1", 60, SEATING_START, SEATING_END)];
    expect(availableCapacity(mayoral1, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
    expect(availableCapacity(mayoral2, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      60,
    );
  });

  it("both sections full (60 each) leaves 0 for the whole and both sections", () => {
    const holds = [
      hold("mayoral-1", 60, SEATING_START, SEATING_END),
      hold("mayoral-2", 60, SEATING_START, SEATING_END),
    ];
    expect(availableCapacity(mayoral, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
    expect(availableCapacity(mayoral1, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
    expect(availableCapacity(mayoral2, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
  });

  it("partial whole-room + section: 60 whole + 60 section-1 leaves 0 for both", () => {
    const holds = [
      hold("mayoral", 60, SEATING_START, SEATING_END),
      hold("mayoral-1", 60, SEATING_START, SEATING_END),
    ];
    // whole: 120 - (60 + 60) = 0
    expect(availableCapacity(mayoral, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
    // section-1: min(60-60, 120-(60+60)) = min(0,0) = 0
    expect(availableCapacity(mayoral1, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
    // section-2: min(60-0, 120-(60+60)) = min(60,0) = 0
    expect(availableCapacity(mayoral2, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
  });

  it("partial whole-room (60) leaves 60 for the whole — and BLOCKS both sections (exclusivity)", () => {
    // A whole-room hold of ANY size blocks both sections regardless of party size.
    const holds = [hold("mayoral", 60, SEATING_START, SEATING_END)];
    // whole: 120 - 60 = 60
    expect(availableCapacity(mayoral, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      60,
    );
    // EXCLUSIVITY: a whole-room hold (any size) blocks both sections → 0.
    expect(availableCapacity(mayoral1, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
    expect(availableCapacity(mayoral2, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
  });

  it("whole-room hold of 1 (any size) still blocks both sections (exclusivity, not a count)", () => {
    // Even a 1-person whole-room booking blocks both sections — it is not
    // `120 - partySize`; it is a whole-room exclusivity lock.
    const holds = [hold("mayoral", 1, SEATING_START, SEATING_END)];
    expect(availableCapacity(mayoral1, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
    expect(availableCapacity(mayoral2, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
    expect(availableCapacity(mayoral, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      119,
    );
  });

  it("partial section-1 (30) leaves 30 for section-1, 60 for section-2, 0 for whole (exclusivity)", () => {
    const holds = [hold("mayoral-1", 30, SEATING_START, SEATING_END)];
    expect(availableCapacity(mayoral1, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      30,
    );
    expect(availableCapacity(mayoral2, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      60,
    );
    // EXCLUSIVITY: any section hold blocks whole-room MODE → 0.
    expect(availableCapacity(mayoral, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
  });

  it("back-to-back whole-room holds do not block each other", () => {
    const holds = [hold("mayoral", 120, SEATING_END, SEATING_END + 3 * 60 * 60 * 1000)];
    // The back-to-back whole-room hold is outside the query interval, so the
    // queried interval still has full capacity.
    expect(availableCapacity(mayoral, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      120,
    );
    expect(availableCapacity(mayoral1, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      60,
    );
    expect(availableCapacity(mayoral2, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      60,
    );
  });

  it("back-to-back section intervals do not block each other", () => {
    const holds = [hold("mayoral-1", 60, SEATING_END, SEATING_END + 3 * 60 * 60 * 1000)];
    expect(availableCapacity(mayoral1, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      60,
    );
  });
});

describe("availableCapacity — safe expiration (not a release)", () => {
  it("an expired-but-unreconciled held hold STILL consumes capacity", () => {
    const holds = [
      hold("ballroom", 100, SEATING_START, SEATING_END, {
        state: "held",
        deadline: NOW - 1,
      }),
    ];
    expect(availableCapacity(ballroom, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      850,
    );
  });
  it("a released hold does NOT consume capacity", () => {
    const holds = [
      hold("ballroom", 100, SEATING_START, SEATING_END, {
        state: "released",
        deadline: NOW - 1,
      }),
    ];
    expect(availableCapacity(ballroom, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      950,
    );
  });
});

describe("computeHoldDeadline", () => {
  it("is 2 hours from now", () => {
    expect(computeHoldDeadline(NOW)).toBe(NOW + HOLD_DEADLINE_HOURS * 60 * 60 * 1000);
  });
  it("is fixed at 2 hours", () => {
    expect(HOLD_DEADLINE_HOURS).toBe(2);
  });
});

describe("isCapacityEligibleStatus", () => {
  it("allows pre-arrival statuses", () => {
    expect(isCapacityEligibleStatus("pending_review")).toBe(true);
    expect(isCapacityEligibleStatus("confirmed")).toBe(true);
    expect(isCapacityEligibleStatus("balance_due")).toBe(true);
    expect(isCapacityEligibleStatus("paid_in_full")).toBe(true);
    expect(isCapacityEligibleStatus("ready_for_service")).toBe(true);
    expect(isCapacityEligibleStatus("cancellation_requested")).toBe(true);
    expect(isCapacityEligibleStatus("transfer_requested")).toBe(true);
  });
  it("rejects terminal/checked-in/cancelled", () => {
    expect(isCapacityEligibleStatus("checked_in")).toBe(false);
    expect(isCapacityEligibleStatus("seated")).toBe(false);
    expect(isCapacityEligibleStatus("completed")).toBe(false);
    expect(isCapacityEligibleStatus("no_show")).toBe(false);
    expect(isCapacityEligibleStatus("refund_review")).toBe(false);
    expect(isCapacityEligibleStatus("cancelled")).toBe(false);
  });
  it("rejects null/undefined", () => {
    expect(isCapacityEligibleStatus(null)).toBe(false);
    expect(isCapacityEligibleStatus(undefined)).toBe(false);
  });
});

describe("availableCapacity — concurrent acquisition design", () => {
  it("two 475-person allocations on ballroom leave 0 (no oversell)", () => {
    const holds = [
      hold("ballroom", 475, SEATING_START, SEATING_END),
      hold("ballroom", 475, SEATING_START, SEATING_END),
    ];
    expect(availableCapacity(ballroom, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
  });
  it("a third guest after 475+475 is rejected (0 remaining)", () => {
    const holds = [
      hold("ballroom", 475, SEATING_START, SEATING_END),
      hold("ballroom", 475, SEATING_START, SEATING_END),
    ];
    expect(availableCapacity(ballroom, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
  });
  it("a second acquisition after partial fill respects remaining", () => {
    const holds = [hold("ballroom", 900, SEATING_START, SEATING_END)];
    expect(availableCapacity(ballroom, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      50,
    );
  });
});

describe("availableCapacity — missing parent fails safe", () => {
  it("returns 0 for a section whose parent is absent from the map", () => {
    const orphanSection: CapacityResourceInput = {
      id: "orphan-section",
      totalCapacity: 60,
      parentId: "missing-parent",
    };
    const partialMap = new Map<string, CapacityResourceInput>([["orphan-section", orphanSection]]);
    expect(availableCapacity(orphanSection, partialMap, [], SEATING_START, SEATING_END, NOW)).toBe(
      0,
    );
  });
});

describe("peakOccupancy — peak simultaneous usage (mirrors SQL capacity_peak_0019)", () => {
  it("sums concurrent holds, not all touching holds (no double-count)", () => {
    // Two back-to-back 475-person ballroom holds within a longer query
    // interval: peak is 475, not 950.
    const holds = [
      hold("ballroom", 475, SEATING_START, SEATING_END),
      hold("ballroom", 475, SEATING_END, SEATING_END + 3 * 60 * 60 * 1000),
    ];
    // Query the FULL span that touches both; peak must be 475 (the max at any
    // single moment), NOT 950 (the sum).
    expect(
      peakOccupancy(
        holds,
        new Set(["ballroom"]),
        SEATING_START,
        SEATING_END + 3 * 60 * 60 * 1000,
        NOW,
      ),
    ).toBe(475);
  });

  it("two simultaneous overlapping holds peak at their sum", () => {
    const holds = [
      hold("ballroom", 475, SEATING_START, SEATING_END),
      hold("ballroom", 475, SEATING_START + 30 * 60 * 1000, SEATING_END),
    ];
    expect(peakOccupancy(holds, new Set(["ballroom"]), SEATING_START, SEATING_END, NOW)).toBe(950);
  });

  it("excludes released holds", () => {
    const holds = [hold("ballroom", 475, SEATING_START, SEATING_END, { state: "released" })];
    expect(peakOccupancy(holds, new Set(["ballroom"]), SEATING_START, SEATING_END, NOW)).toBe(0);
  });

  it("counts expired-but-unreleased holds (expiration is not release)", () => {
    const holds = [hold("ballroom", 475, SEATING_START, SEATING_END, { deadline: NOW - 1000 })];
    expect(peakOccupancy(holds, new Set(["ballroom"]), SEATING_START, SEATING_END, NOW)).toBe(475);
  });

  it("filters to the requested resource set only", () => {
    const holds = [
      hold("ballroom", 475, SEATING_START, SEATING_END),
      hold("mayoral", 60, SEATING_START, SEATING_END),
    ];
    expect(peakOccupancy(holds, new Set(["ballroom"]), SEATING_START, SEATING_END, NOW)).toBe(475);
  });
});

describe("availableCapacity — whole-mode multiple parties share 120 by peak headcount", () => {
  it("whole Mayoral 50+50+20 succeeds (peak 120) and rejects another", () => {
    const holds = [
      hold("mayoral", 50, SEATING_START, SEATING_END),
      hold("mayoral", 50, SEATING_START, SEATING_END),
    ];
    // 120 - 100 = 20 remaining for a third whole-mode party.
    expect(availableCapacity(mayoral, allResources, holds, SEATING_START, SEATING_END, NOW)).toBe(
      20,
    );
    // Adding the 20 fills it to 120.
    const full = [...holds, hold("mayoral", 20, SEATING_START, SEATING_END)];
    expect(availableCapacity(mayoral, allResources, full, SEATING_START, SEATING_END, NOW)).toBe(0);
    // And a 21st would be rejected.
    const over = [...full, hold("mayoral", 1, SEATING_START, SEATING_END)];
    expect(availableCapacity(mayoral, allResources, over, SEATING_START, SEATING_END, NOW)).toBe(0);
  });
});
