import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockSundaysRepository } from "@/lib/server/sundays-mock.server";
import type {
  CreateDiningTableInput,
  UpdateDiningTableInput,
  DiningTableDTO,
} from "@/lib/sundays/types";

// --- Internal accessor for actor-field verification (mock only) ---
type InternalRecord = DiningTableDTO & { createdBy: string; updatedBy: string };
function getInternalRecords(repo: MockSundaysRepository): InternalRecord[] {
  return (repo as unknown as { diningTables: InternalRecord[] }).diningTables;
}

describe("Dining tables repository (mock)", () => {
  const actor = "staff-actor-1";
  const otherActor = "staff-actor-2";
  const spaceA = "space-a";
  const spaceB = "space-b";

  function makeCreateInput(
    overrides: Partial<CreateDiningTableInput> = {},
  ): CreateDiningTableInput {
    return {
      spaceId: spaceA,
      label: "Table 1",
      seats: 4,
      ...overrides,
    };
  }

  // ==========================================================================
  // createDiningTable
  // ==========================================================================
  describe("createDiningTable", () => {
    it("persists all fields and returns the created table", async () => {
      const repo = new MockSundaysRepository();
      const result = await repo.createDiningTable(
        actor,
        makeCreateInput({
          label: "T1",
          seats: 8,
          zone: "Main Floor",
          isActive: false,
          displayOrder: 5,
        }),
      );
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      const dto = result.data!;
      expect(dto.label).toBe("T1");
      expect(dto.seats).toBe(8);
      expect(dto.zone).toBe("Main Floor");
      expect(dto.isActive).toBe(false);
      expect(dto.displayOrder).toBe(5);
      expect(dto.spaceId).toBe(spaceA);
      expect(dto.id).toBeTruthy();
      expect(dto.createdAt).toBeTruthy();
      expect(dto.updatedAt).toBeTruthy();
    });

    it("populates created_by and updated_by from the trusted server actor", async () => {
      const repo = new MockSundaysRepository();
      await repo.createDiningTable(actor, makeCreateInput());
      const records = getInternalRecords(repo);
      expect(records[0].createdBy).toBe(actor);
      expect(records[0].updatedBy).toBe(actor);
    });

    it("defaults zone to empty string, isActive to true, displayOrder to 0", async () => {
      const repo = new MockSundaysRepository();
      const result = await repo.createDiningTable(actor, makeCreateInput({ label: "T1" }));
      expect(result.success).toBe(true);
      expect(result.data!.zone).toBe("");
      expect(result.data!.isActive).toBe(true);
      expect(result.data!.displayOrder).toBe(0);
    });

    it("rejects empty labels", async () => {
      const repo = new MockSundaysRepository();
      const result = await repo.createDiningTable(actor, makeCreateInput({ label: "   " }));
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("rejects duplicate labels in the same room (case-insensitive, surrounding whitespace)", async () => {
      const repo = new MockSundaysRepository();
      await repo.createDiningTable(actor, makeCreateInput({ label: "Table 1" }));
      const dup = await repo.createDiningTable(actor, makeCreateInput({ label: "  table 1  " }));
      expect(dup.success).toBe(false);
      expect(dup.error).toContain("already exists");
    });

    it("allows identical labels in different rooms", async () => {
      const repo = new MockSundaysRepository();
      const r1 = await repo.createDiningTable(
        actor,
        makeCreateInput({ label: "Table 1", spaceId: spaceA }),
      );
      const r2 = await repo.createDiningTable(
        actor,
        makeCreateInput({ label: "Table 1", spaceId: spaceB }),
      );
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });
  });

  // ==========================================================================
  // listDiningTables
  // ==========================================================================
  describe("listDiningTables", () => {
    it("returns tables sorted by display_order, label, then id", async () => {
      const repo = new MockSundaysRepository();
      await repo.createDiningTable(actor, makeCreateInput({ label: "Zebra", displayOrder: 1 }));
      await repo.createDiningTable(actor, makeCreateInput({ label: "Alpha", displayOrder: 1 }));
      await repo.createDiningTable(actor, makeCreateInput({ label: "Middle", displayOrder: 0 }));
      const tables = await repo.listDiningTables();
      expect(tables.map((t) => t.label)).toEqual(["Middle", "Alpha", "Zebra"]);
    });

    it("includes inactive tables for management", async () => {
      const repo = new MockSundaysRepository();
      await repo.createDiningTable(actor, makeCreateInput({ label: "Active", isActive: true }));
      await repo.createDiningTable(actor, makeCreateInput({ label: "Inactive", isActive: false }));
      const tables = await repo.listDiningTables();
      expect(tables).toHaveLength(2);
      expect(tables.some((t) => t.label === "Inactive")).toBe(true);
    });

    it("filters by spaceId when provided", async () => {
      const repo = new MockSundaysRepository();
      await repo.createDiningTable(actor, makeCreateInput({ label: "A1", spaceId: spaceA }));
      await repo.createDiningTable(actor, makeCreateInput({ label: "B1", spaceId: spaceB }));
      const aTables = await repo.listDiningTables(spaceA);
      expect(aTables).toHaveLength(1);
      expect(aTables[0].label).toBe("A1");

      const all = await repo.listDiningTables();
      expect(all).toHaveLength(2);
    });

    it("returns empty array when no tables exist", async () => {
      const repo = new MockSundaysRepository();
      const tables = await repo.listDiningTables();
      expect(tables).toEqual([]);
    });
  });

  // ==========================================================================
  // updateDiningTable
  // ==========================================================================
  describe("updateDiningTable", () => {
    it("updates fields and returns a fresh updated_at", async () => {
      const repo = new MockSundaysRepository();
      const created = await repo.createDiningTable(
        actor,
        makeCreateInput({ label: "T1", seats: 4 }),
      );
      const result = await repo.updateDiningTable(actor, {
        id: created.data!.id,
        expectedUpdatedAt: created.data!.updatedAt,
        seats: 8,
        label: "T1-Renamed",
        zone: "Patio",
        displayOrder: 3,
      });
      expect(result.success).toBe(true);
      expect(result.data!.seats).toBe(8);
      expect(result.data!.label).toBe("T1-Renamed");
      expect(result.data!.zone).toBe("Patio");
      expect(result.data!.displayOrder).toBe(3);
      expect(result.data!.updatedAt).not.toBe(created.data!.updatedAt);
    });

    it("sets updated_by from the trusted actor while preserving created_by", async () => {
      const repo = new MockSundaysRepository();
      const created = await repo.createDiningTable(actor, makeCreateInput());
      await repo.updateDiningTable(otherActor, {
        id: created.data!.id,
        expectedUpdatedAt: created.data!.updatedAt,
        seats: 6,
      });
      const records = getInternalRecords(repo);
      expect(records[0].updatedBy).toBe(otherActor);
      expect(records[0].createdBy).toBe(actor); // unchanged
    });

    it("rejects stale edits with a conflict result", async () => {
      const repo = new MockSundaysRepository();
      const created = await repo.createDiningTable(actor, makeCreateInput());
      const stale = await repo.updateDiningTable(actor, {
        id: created.data!.id,
        expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
        seats: 6,
      });
      expect(stale.success).toBe(false);
      expect(stale.conflict).toBe(true);
    });

    it("rejects duplicate labels on update in the same room", async () => {
      const repo = new MockSundaysRepository();
      await repo.createDiningTable(actor, makeCreateInput({ label: "T1" }));
      const t2 = await repo.createDiningTable(actor, makeCreateInput({ label: "T2" }));
      const dup = await repo.updateDiningTable(actor, {
        id: t2.data!.id,
        expectedUpdatedAt: t2.data!.updatedAt,
        label: "T1",
      });
      expect(dup.success).toBe(false);
      expect(dup.error).toContain("already exists");
    });

    it("supports soft-disable via is_active=false and keeps it in management results", async () => {
      const repo = new MockSundaysRepository();
      const created = await repo.createDiningTable(
        actor,
        makeCreateInput({ label: "T1", isActive: true }),
      );
      const disabled = await repo.updateDiningTable(actor, {
        id: created.data!.id,
        expectedUpdatedAt: created.data!.updatedAt,
        isActive: false,
      });
      expect(disabled.success).toBe(true);
      expect(disabled.data!.isActive).toBe(false);
      // Soft-disabled table remains in management list
      const tables = await repo.listDiningTables();
      expect(tables.some((t) => t.id === created.data!.id)).toBe(true);
    });

    it("returns not found for a missing table", async () => {
      const repo = new MockSundaysRepository();
      const result = await repo.updateDiningTable(actor, {
        id: "nonexistent-id",
        expectedUpdatedAt: new Date().toISOString(),
        seats: 6,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  // ==========================================================================
  // Round-trip: create → list → update → list
  // ==========================================================================
  describe("round-trip", () => {
    it("create then list returns the created table; update then list reflects changes", async () => {
      const repo = new MockSundaysRepository();
      const created = await repo.createDiningTable(
        actor,
        makeCreateInput({ label: "RT1", seats: 4, displayOrder: 10 }),
      );
      expect(created.success).toBe(true);

      const list1 = await repo.listDiningTables();
      expect(list1).toHaveLength(1);
      expect(list1[0].label).toBe("RT1");
      expect(list1[0].seats).toBe(4);

      const updated = await repo.updateDiningTable(actor, {
        id: created.data!.id,
        expectedUpdatedAt: created.data!.updatedAt,
        seats: 12,
        label: "RT1-Updated",
      });
      expect(updated.success).toBe(true);
      expect(updated.data!.seats).toBe(12);

      const list2 = await repo.listDiningTables();
      expect(list2).toHaveLength(1);
      expect(list2[0].label).toBe("RT1-Updated");
      expect(list2[0].seats).toBe(12);
    });
  });

  // ==========================================================================
  // Frozen-clock timestamp regression
  // ==========================================================================
  describe("frozen-clock timestamp advances", () => {
    const fixedNow = Date.parse("2026-01-01T12:00:00.000Z");
    let realNow: () => number;

    beforeEach(() => {
      realNow = Date.now;
      Date.now = () => fixedNow;
    });

    afterEach(() => {
      Date.now = realNow;
    });

    it("create and update at the same clock time produce strictly increasing updatedAt", async () => {
      const repo = new MockSundaysRepository();
      const created = await repo.createDiningTable(
        actor,
        makeCreateInput({ label: "T1", seats: 4 }),
      );
      const result = await repo.updateDiningTable(actor, {
        id: created.data!.id,
        expectedUpdatedAt: created.data!.updatedAt,
        seats: 8,
      });
      expect(result.success).toBe(true);
      expect(result.data!.updatedAt).not.toBe(created.data!.updatedAt);
      expect(Date.parse(result.data!.updatedAt)).toBeGreaterThan(
        Date.parse(created.data!.updatedAt),
      );
    });

    it("a second update using the original timestamp returns conflict and leaves stored data unchanged", async () => {
      const repo = new MockSundaysRepository();
      const created = await repo.createDiningTable(
        actor,
        makeCreateInput({ label: "T1", seats: 4 }),
      );
      const firstUpdate = await repo.updateDiningTable(actor, {
        id: created.data!.id,
        expectedUpdatedAt: created.data!.updatedAt,
        seats: 6,
      });
      expect(firstUpdate.success).toBe(true);

      const conflict = await repo.updateDiningTable(actor, {
        id: created.data!.id,
        expectedUpdatedAt: created.data!.updatedAt, // stale — pre-first-update
        seats: 10,
      });
      expect(conflict.success).toBe(false);
      expect(conflict.conflict).toBe(true);

      const records = getInternalRecords(repo);
      expect(records[0].seats).toBe(6); // not overwritten by the rejected update
    });

    it("an update using the latest timestamp succeeds and advances updatedAt even while the clock is frozen", async () => {
      const repo = new MockSundaysRepository();
      const created = await repo.createDiningTable(
        actor,
        makeCreateInput({ label: "T1", seats: 4 }),
      );
      const first = await repo.updateDiningTable(actor, {
        id: created.data!.id,
        expectedUpdatedAt: created.data!.updatedAt,
        seats: 6,
      });
      expect(first.success).toBe(true);

      const second = await repo.updateDiningTable(otherActor, {
        id: created.data!.id,
        expectedUpdatedAt: first.data!.updatedAt,
        seats: 10,
      });
      expect(second.success).toBe(true);
      expect(Date.parse(second.data!.updatedAt)).toBeGreaterThan(Date.parse(first.data!.updatedAt));
    });

    it("createdAt and createdBy remain unchanged; updatedBy reflects the successful editor", async () => {
      const repo = new MockSundaysRepository();
      const created = await repo.createDiningTable(
        actor,
        makeCreateInput({ label: "T1", seats: 4 }),
      );
      const result = await repo.updateDiningTable(otherActor, {
        id: created.data!.id,
        expectedUpdatedAt: created.data!.updatedAt,
        seats: 8,
      });
      expect(result.success).toBe(true);
      const records = getInternalRecords(repo);
      expect(records[0].createdAt).toBe(created.data!.createdAt);
      expect(records[0].createdBy).toBe(actor);
      expect(records[0].updatedBy).toBe(otherActor);
    });
  });
});
