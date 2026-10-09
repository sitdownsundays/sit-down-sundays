import { describe, it, expect } from "vitest";
import {
  tableListFromResult,
  createStaleGuard,
  roomOptionsFromResult,
} from "@/components/admin/admin-tables-helpers";
import type { DiningTableDTO, DiningTableRoomOption } from "@/lib/sundays/types";

function makeTable(overrides: Partial<DiningTableDTO> = {}): DiningTableDTO {
  return {
    id: "t1",
    spaceId: "room-1",
    label: "A1",
    seats: 4,
    zone: "",
    isActive: true,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRoom(overrides: Partial<DiningTableRoomOption> = {}): DiningTableRoomOption {
  return {
    id: "room-1",
    name: "Grand Ballroom",
    spaceType: "general_dining",
    isActive: true,
    ...overrides,
  };
}

describe("admin tables helpers", () => {
  // ==========================================================================
  // tableListFromResult — discriminated union mapping
  // ==========================================================================
  describe("tableListFromResult", () => {
    it("maps a successful result (with tables) to loaded state", () => {
      const tables = [makeTable(), makeTable({ id: "t2", label: "A2" })];
      const state = tableListFromResult({ ok: true, tables });
      expect(state.state).toBe("loaded");
      expect(state.tables).toEqual(tables);
      expect(state.error).toBe("");
    });

    it("maps a successful empty inventory to loaded (not error)", () => {
      const state = tableListFromResult({ ok: true, tables: [] });
      expect(state.state).toBe("loaded");
      expect(state.tables).toEqual([]);
    });

    it("maps an authorization failure to error state with the safe message", () => {
      const state = tableListFromResult({
        ok: false,
        error: "You are not authorized to view tables.",
      });
      expect(state.state).toBe("error");
      expect(state.tables).toEqual([]);
      expect(state.error).toBe("You are not authorized to view tables.");
    });

    it("maps an invalid-filter failure to error state", () => {
      const state = tableListFromResult({ ok: false, error: "Invalid room filter." });
      expect(state.state).toBe("error");
      expect(state.error).toBe("Invalid room filter.");
    });

    it("maps a repository failure to error state without raw db text", () => {
      const state = tableListFromResult({
        ok: false,
        error: "Could not load tables. Please try again.",
      });
      expect(state.state).toBe("error");
      expect(state.error).not.toContain("db down");
    });
  });

  // ==========================================================================
  // roomOptionsFromResult — discriminated union mapping
  // ==========================================================================
  describe("roomOptionsFromResult", () => {
    it("maps a successful result (with rooms) to loaded state", () => {
      const rooms = [makeRoom(), makeRoom({ id: "room-2", name: "Garden Room" })];
      const state = roomOptionsFromResult({ ok: true, rooms });
      expect(state.state).toBe("loaded");
      expect(state.rooms).toEqual(rooms);
      expect(state.error).toBe("");
    });

    it("maps a successful empty list to loaded (not error)", () => {
      const state = roomOptionsFromResult({ ok: true, rooms: [] });
      expect(state.state).toBe("loaded");
      expect(state.rooms).toEqual([]);
    });

    it("preserves inactive rooms so existing tables can display their names", () => {
      const rooms = [
        makeRoom({ id: "a", name: "Active Room", isActive: true }),
        makeRoom({ id: "b", name: "Old Room", isActive: false }),
      ];
      const state = roomOptionsFromResult({ ok: true, rooms });
      expect(state.state).toBe("loaded");
      expect(state.rooms).toHaveLength(2);
      expect(state.rooms[1].isActive).toBe(false);
    });

    it("maps an authorization failure to error state, not an empty list", () => {
      const state = roomOptionsFromResult({
        ok: false,
        error: "You are not authorized to view rooms.",
      });
      expect(state.state).toBe("error");
      expect(state.rooms).toEqual([]);
      expect(state.error).toBe("You are not authorized to view rooms.");
    });

    it("maps a repository failure to error state without raw db text", () => {
      const state = roomOptionsFromResult({
        ok: false,
        error: "Could not load rooms. Please try again.",
      });
      expect(state.state).toBe("error");
      expect(state.rooms).toEqual([]);
      expect(state.error).not.toContain("db down");
    });
  });

  // ==========================================================================
  // createStaleGuard — stale response protection
  // ==========================================================================
  describe("createStaleGuard", () => {
    it("accepts the latest request", () => {
      const guard = createStaleGuard();
      const id = guard.next();
      expect(guard.isStale(id)).toBe(false);
    });

    it("marks an older request as stale after a newer one is issued", () => {
      const guard = createStaleGuard();
      const first = guard.next();
      const second = guard.next();
      expect(guard.isStale(first)).toBe(true);
      expect(guard.isStale(second)).toBe(false);
    });

    it("supports sequential room-filter changes without overlap", () => {
      const guard = createStaleGuard();
      const a = guard.next();
      const b = guard.next();
      const c = guard.next();
      expect(guard.isStale(a)).toBe(true);
      expect(guard.isStale(b)).toBe(true);
      expect(guard.isStale(c)).toBe(false);
    });
  });
});
