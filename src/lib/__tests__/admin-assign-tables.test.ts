/**
 * Assign Tables dialog helpers — behavioral tests.
 *
 * Exercises the REAL production pure helpers in assign-tables-helpers.ts.
 * These are helper-level (not rendered component) tests.
 */
import { describe, it, expect } from "vitest";
import {
  initialSelectionFromContext,
  selectedSeats,
  selectionHasChanges,
  guardMessage,
  buildSavePayload,
  buildReleasePayload,
} from "@/components/admin/assign-tables-helpers";
import type {
  ReservationTableContextDTO,
  ReservationRoomTableDTO,
  ReservationTableAssignmentDTO,
} from "@/lib/sundays/types";

const ROOM_ID = "room-1";

function makeRoomTable(
  id: string,
  seats: number,
  isActive = true,
  zone = "",
): ReservationRoomTableDTO {
  return { id, label: id.toUpperCase(), seats, zone, isActive };
}

function makeAssignment(
  tableId: string,
  seats: number,
  isActive: boolean,
): ReservationTableAssignmentDTO {
  return {
    id: `asg-${tableId}`,
    diningTableId: tableId,
    seatingStart: "2026-10-11T13:00:00-05:00",
    seatingEnd: "2026-10-11T15:30:00-05:00",
    tableLabel: tableId.toUpperCase(),
    tableSeats: seats,
    tableIsActive: isActive,
  };
}

function makeContext(overrides: Partial<ReservationTableContextDTO>): ReservationTableContextDTO {
  return {
    reservationId: "res-1",
    reservationNumber: "RES-001",
    partySize: 8,
    status: "pending_review",
    updatedAt: "2026-10-09T10:00:00Z",
    roomId: ROOM_ID,
    roomName: "Main Hall",
    serviceDate: "2026-10-11",
    seatingStart: "13:00",
    seatingEnd: "15:30",
    currentAssignments: [],
    roomTables: [],
    ...overrides,
  };
}

describe("initialSelectionFromContext", () => {
  it("preselects current assignments", () => {
    const ctx = makeContext({
      currentAssignments: [makeAssignment("tbl-a", 6, true), makeAssignment("tbl-b", 4, false)],
    });
    const sel = initialSelectionFromContext(ctx);
    expect(sel.tableIds).toEqual(["tbl-a", "tbl-b"]);
  });

  it("returns empty when no current assignments", () => {
    const ctx = makeContext({});
    expect(initialSelectionFromContext(ctx).tableIds).toEqual([]);
  });
});

describe("selectedSeats", () => {
  it("sums seats of selected tables only", () => {
    const tables = [
      makeRoomTable("tbl-a", 6),
      makeRoomTable("tbl-b", 4),
      makeRoomTable("tbl-c", 8),
    ];
    expect(selectedSeats(tables, { tableIds: ["tbl-a", "tbl-b"] })).toBe(10);
    expect(selectedSeats(tables, { tableIds: ["tbl-c"] })).toBe(8);
    expect(selectedSeats(tables, { tableIds: [] })).toBe(0);
  });
});

describe("selectionHasChanges", () => {
  it("returns false when selection matches current assignments", () => {
    const ctx = makeContext({
      currentAssignments: [makeAssignment("tbl-a", 6, true)],
    });
    expect(selectionHasChanges(ctx, { tableIds: ["tbl-a"] })).toBe(false);
  });

  it("returns true when selection differs", () => {
    const ctx = makeContext({
      currentAssignments: [makeAssignment("tbl-a", 6, true)],
    });
    expect(selectionHasChanges(ctx, { tableIds: ["tbl-b"] })).toBe(true);
    expect(selectionHasChanges(ctx, { tableIds: [] })).toBe(true);
    expect(selectionHasChanges(ctx, { tableIds: ["tbl-a", "tbl-b"] })).toBe(true);
  });
});

describe("guardMessage", () => {
  it("returns null for a valid sufficient selection", () => {
    const ctx = makeContext({
      partySize: 8,
      currentAssignments: [],
      roomTables: [makeRoomTable("tbl-a", 6), makeRoomTable("tbl-b", 4)],
    });
    expect(guardMessage(ctx, { tableIds: ["tbl-a", "tbl-b"] })).toBe(null);
  });

  it("returns null for empty selection (release, not a guard)", () => {
    const ctx = makeContext({
      partySize: 8,
      currentAssignments: [makeAssignment("tbl-a", 6, true)],
      roomTables: [makeRoomTable("tbl-a", 6)],
    });
    expect(guardMessage(ctx, { tableIds: [] })).toBe(null);
  });

  it("blocks a nonempty selection with insufficient seats", () => {
    const ctx = makeContext({
      partySize: 8,
      currentAssignments: [],
      roomTables: [makeRoomTable("tbl-a", 4)],
    });
    const msg = guardMessage(ctx, { tableIds: ["tbl-a"] });
    expect(msg).toContain("4 seats");
    expect(msg).toContain("8 guests");
  });

  it("blocks a nonempty selection that newly includes an inactive table", () => {
    const ctx = makeContext({
      partySize: 4,
      currentAssignments: [],
      roomTables: [makeRoomTable("tbl-inactive", 6, false)],
    });
    const msg = guardMessage(ctx, { tableIds: ["tbl-inactive"] });
    expect(msg).toContain("Inactive tables cannot be newly selected");
  });

  it("allows deselecting an inactive currently-assigned table", () => {
    const ctx = makeContext({
      partySize: 4,
      currentAssignments: [makeAssignment("tbl-inactive", 6, false)],
      roomTables: [makeRoomTable("tbl-inactive", 6, false)],
    });
    // Selecting only the inactive table that is already current → not a "new" selection
    expect(guardMessage(ctx, { tableIds: ["tbl-inactive"] })).toBe(null);
    // Deselecting it → empty → no guard
    expect(guardMessage(ctx, { tableIds: [] })).toBe(null);
  });
});

describe("buildSavePayload", () => {
  it("preserves reservation ID and original updatedAt as expectedUpdatedAt", () => {
    const ctx = makeContext({ updatedAt: "2026-10-09T10:00:00Z" });
    const payload = buildSavePayload(ctx, { tableIds: ["tbl-a"] });
    expect(payload).toEqual({
      reservationId: "res-1",
      tableIds: ["tbl-a"],
      expectedUpdatedAt: "2026-10-09T10:00:00Z",
    });
  });

  it("returns a defensive copy of tableIds", () => {
    const ctx = makeContext({});
    const sel = { tableIds: ["tbl-a"] };
    const payload = buildSavePayload(ctx, sel);
    expect(payload.tableIds).not.toBe(sel.tableIds);
    expect(payload.tableIds).toEqual(["tbl-a"]);
  });
});

describe("buildReleasePayload", () => {
  it("sends an empty tableIds array with the original updatedAt", () => {
    const ctx = makeContext({ updatedAt: "2026-10-09T10:00:00Z" });
    const payload = buildReleasePayload(ctx);
    expect(payload).toEqual({
      reservationId: "res-1",
      tableIds: [],
      expectedUpdatedAt: "2026-10-09T10:00:00Z",
    });
  });
});
