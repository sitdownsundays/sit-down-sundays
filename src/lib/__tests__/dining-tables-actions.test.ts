/**
 * Dining-table action handlers — behavioral tests.
 *
 * Exercises the REAL production action handlers in sundays-actions.server.ts:
 *   serverListDiningTables, serverCreateDiningTable, serverUpdateDiningTable
 *
 * The authorization helper (resolveSundaysActorWithPermission) and the
 * repository selector (getSundaysRepository) are mocked at their real module
 * boundaries via vi.mock, so the action wiring — permission requested, actor
 * passed to mutations, input validation, conflict/error propagation — is what
 * is under test. These are MOCKED-BOUNDARY tests, not live Supabase.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  DiningTableDTO,
  DiningTableOperationResult,
  CreateDiningTableInput,
  UpdateDiningTableInput,
} from "@/lib/sundays/types";
import type { ISundaysRepository } from "@/lib/server/sundays-repository-interface.server";

// ---------------------------------------------------------------------------
// Mock the repository selector so we can assert call args and control results.
// ---------------------------------------------------------------------------
const mockRepo: {
  listDiningTables: ReturnType<typeof vi.fn>;
  createDiningTable: ReturnType<typeof vi.fn>;
  updateDiningTable: ReturnType<typeof vi.fn>;
} = {
  listDiningTables: vi.fn(),
  createDiningTable: vi.fn(),
  updateDiningTable: vi.fn(),
};

vi.mock("@/lib/server/sundays-repository.server", () => ({
  getSundaysRepository: (): ISundaysRepository => mockRepo as unknown as ISundaysRepository,
}));

// ---------------------------------------------------------------------------
// Mock the authorization helper so we can control auth outcomes per test.
// ---------------------------------------------------------------------------
const mockResolve = vi.fn();
vi.mock("@/lib/server/sundays-auth.server", () => ({
  resolveSundaysActorWithPermission: (permission: string) => mockResolve(permission),
  resolveSundaysActor: () => mockResolve("availability.manage"),
  SundaysAuthorizationError: class SundaysAuthorizationError extends Error {
    constructor(message = "You are not authorized.") {
      super(message);
      this.name = "SundaysAuthorizationError";
    }
  },
}));

// Import AFTER mocks are registered.
const { serverListDiningTables, serverCreateDiningTable, serverUpdateDiningTable } =
  await import("@/lib/server/sundays-actions.server");

const ACTOR_ID = "verified-session-user-id";

function authActor(): { role: string; userId: string } {
  return { role: "foh_staff", userId: ACTOR_ID };
}

function authReject(): never {
  throw new (class extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "SundaysAuthorizationError";
    }
  })();
}

function makeTableDTO(overrides: Partial<DiningTableDTO> = {}): DiningTableDTO {
  return {
    id: "table-1",
    spaceId: "11111111-1111-1111-1111-111111111111",
    label: "Table 1",
    seats: 4,
    zone: "",
    isActive: true,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const VALID_SPACE_ID = "11111111-1111-1111-1111-111111111111";
const VALID_TABLE_ID = "22222222-2222-2222-2222-222222222222";

describe("dining-table action handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockReset();
    mockRepo.listDiningTables.mockReset();
    mockRepo.createDiningTable.mockReset();
    mockRepo.updateDiningTable.mockReset();
  });

  // ==========================================================================
  // serverListDiningTables — discriminated union
  // ==========================================================================
  describe("serverListDiningTables", () => {
    it("requires seating.read before reaching the repository", async () => {
      mockResolve.mockImplementation(authReject);
      const result = await serverListDiningTables({});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBeTruthy();
      expect(mockRepo.listDiningTables).not.toHaveBeenCalled();
      expect(mockResolve).toHaveBeenCalledWith("seating.read");
    });

    it("returns tables and passes an optional spaceId filter to the repository", async () => {
      mockResolve.mockImplementation(authActor);
      const tables = [makeTableDTO()];
      mockRepo.listDiningTables.mockResolvedValue(tables);
      const result = await serverListDiningTables({ spaceId: VALID_SPACE_ID });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.tables).toEqual(tables);
      expect(mockRepo.listDiningTables).toHaveBeenCalledWith(VALID_SPACE_ID);
    });

    it("passes undefined to the repository when no spaceId is supplied", async () => {
      mockResolve.mockImplementation(authActor);
      mockRepo.listDiningTables.mockResolvedValue([]);
      await serverListDiningTables({});
      expect(mockRepo.listDiningTables).toHaveBeenCalledWith(undefined);
    });

    it("successful empty inventory is ok:true", async () => {
      mockResolve.mockImplementation(authActor);
      mockRepo.listDiningTables.mockResolvedValue([]);
      const result = await serverListDiningTables({});
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.tables).toEqual([]);
    });

    it("returns ok:false for an invalid (non-UUID) spaceId without calling the repository", async () => {
      mockResolve.mockImplementation(authActor);
      const result = await serverListDiningTables({ spaceId: "not-a-uuid" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("Invalid");
      expect(mockRepo.listDiningTables).not.toHaveBeenCalled();
    });

    it("returns ok:false when the repository throws, without surfacing raw errors", async () => {
      mockResolve.mockImplementation(authActor);
      mockRepo.listDiningTables.mockRejectedValue(new Error("db down"));
      const result = await serverListDiningTables({});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).not.toContain("db down");
    });

    it("successful results preserve table records", async () => {
      mockResolve.mockImplementation(authActor);
      const tables = [makeTableDTO({ label: "A1" }), makeTableDTO({ id: "table-2", label: "A2" })];
      mockRepo.listDiningTables.mockResolvedValue(tables);
      const result = await serverListDiningTables({});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.tables).toHaveLength(2);
        expect(result.tables[0].label).toBe("A1");
        expect(result.tables[1].label).toBe("A2");
      }
    });
  });

  // ==========================================================================
  // serverCreateDiningTable
  // ==========================================================================
  describe("serverCreateDiningTable", () => {
    it("requires seating.manage before reaching the repository", async () => {
      mockResolve.mockImplementation(authReject);
      const result = await serverCreateDiningTable({});
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(mockRepo.createDiningTable).not.toHaveBeenCalled();
      expect(mockResolve).toHaveBeenCalledWith("seating.manage");
    });

    it("rejects invalid input without calling the repository", async () => {
      mockResolve.mockImplementation(authActor);
      const result = await serverCreateDiningTable({ label: "T1" }); // missing spaceId, seats
      expect(result.success).toBe(false);
      expect(mockRepo.createDiningTable).not.toHaveBeenCalled();
    });

    it("passes the verified actor ID and parsed input to the repository", async () => {
      mockResolve.mockImplementation(authActor);
      const created = makeTableDTO({ label: "T1" });
      mockRepo.createDiningTable.mockResolvedValue({ success: true, data: created });
      const result = await serverCreateDiningTable({
        spaceId: VALID_SPACE_ID,
        label: "T1",
        seats: 8,
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual(created);
      expect(mockRepo.createDiningTable).toHaveBeenCalledWith(ACTOR_ID, {
        spaceId: VALID_SPACE_ID,
        label: "T1",
        seats: 8,
      });
    });

    it("returns a safe error when the repository throws", async () => {
      mockResolve.mockImplementation(authActor);
      mockRepo.createDiningTable.mockRejectedValue(new Error("db down"));
      const result = await serverCreateDiningTable({
        spaceId: VALID_SPACE_ID,
        label: "T1",
        seats: 4,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.error).not.toContain("db down");
    });

    it("propagates a duplicate-label conflict result from the repository", async () => {
      mockResolve.mockImplementation(authActor);
      mockRepo.createDiningTable.mockResolvedValue({
        success: false,
        error: "A table with that label already exists in this room.",
      });
      const result = await serverCreateDiningTable({
        spaceId: VALID_SPACE_ID,
        label: "T1",
        seats: 4,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("already exists");
    });
  });

  // ==========================================================================
  // serverUpdateDiningTable
  // ==========================================================================
  describe("serverUpdateDiningTable", () => {
    it("requires seating.manage before reaching the repository", async () => {
      mockResolve.mockImplementation(authReject);
      const result = await serverUpdateDiningTable({});
      expect(result.success).toBe(false);
      expect(mockRepo.updateDiningTable).not.toHaveBeenCalled();
      expect(mockResolve).toHaveBeenCalledWith("seating.manage");
    });

    it("rejects invalid input without calling the repository", async () => {
      mockResolve.mockImplementation(authActor);
      const result = await serverUpdateDiningTable({ id: "bad" });
      expect(result.success).toBe(false);
      expect(mockRepo.updateDiningTable).not.toHaveBeenCalled();
    });

    it("passes the verified actor ID and parsed input (including expectedUpdatedAt)", async () => {
      mockResolve.mockImplementation(authActor);
      const updated = makeTableDTO({ id: VALID_TABLE_ID, seats: 12 });
      mockRepo.updateDiningTable.mockResolvedValue({ success: true, data: updated });
      const result = await serverUpdateDiningTable({
        id: VALID_TABLE_ID,
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        seats: 12,
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual(updated);
      expect(mockRepo.updateDiningTable).toHaveBeenCalledWith(ACTOR_ID, {
        id: VALID_TABLE_ID,
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        seats: 12,
      });
    });

    it("preserves a stale-edit conflict result from the repository", async () => {
      mockResolve.mockImplementation(authActor);
      const conflict: DiningTableOperationResult = {
        success: false,
        conflict: true,
        error: "This table was edited by someone else. Refresh and try again.",
      };
      mockRepo.updateDiningTable.mockResolvedValue(conflict);
      const result = await serverUpdateDiningTable({
        id: VALID_TABLE_ID,
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        isActive: false,
      });
      expect(result.success).toBe(false);
      expect(result.conflict).toBe(true);
    });

    it("returns a safe error when the repository throws", async () => {
      mockResolve.mockImplementation(authActor);
      mockRepo.updateDiningTable.mockRejectedValue(new Error("db down"));
      const result = await serverUpdateDiningTable({
        id: VALID_TABLE_ID,
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        seats: 6,
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.error).not.toContain("db down");
    });

    it("supports soft-disable via isActive=false", async () => {
      mockResolve.mockImplementation(authActor);
      const disabled = makeTableDTO({ id: VALID_TABLE_ID, isActive: false });
      mockRepo.updateDiningTable.mockResolvedValue({ success: true, data: disabled });
      const result = await serverUpdateDiningTable({
        id: VALID_TABLE_ID,
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        isActive: false,
      });
      expect(result.success).toBe(true);
      expect(result.data!.isActive).toBe(false);
    });
  });

  // ==========================================================================
  // Cross-cutting: actor identity never comes from the caller
  // ==========================================================================
  describe("actor identity", () => {
    it("never accepts an actor ID from the browser input on create", async () => {
      mockResolve.mockImplementation(authActor);
      mockRepo.createDiningTable.mockResolvedValue({
        success: true,
        data: makeTableDTO(),
      });
      await serverCreateDiningTable({
        spaceId: VALID_SPACE_ID,
        label: "T1",
        seats: 4,
        // Browser cannot inject an actor; the schema strips unknown keys.
        createdBy: "hacker",
      } as unknown as CreateDiningTableInput);
      const [, input] = mockRepo.createDiningTable.mock.calls[0];
      expect(input).not.toHaveProperty("createdBy");
      // The verified session ID is used, not the browser value.
      expect(mockRepo.createDiningTable).toHaveBeenCalledWith(ACTOR_ID, expect.anything());
    });

    it("never accepts an actor ID from the browser input on update", async () => {
      mockResolve.mockImplementation(authActor);
      mockRepo.updateDiningTable.mockResolvedValue({
        success: true,
        data: makeTableDTO(),
      });
      await serverUpdateDiningTable({
        id: VALID_TABLE_ID,
        expectedUpdatedAt: "2026-01-01T00:00:00.000Z",
        updatedBy: "hacker",
      } as unknown as UpdateDiningTableInput);
      const [, input] = mockRepo.updateDiningTable.mock.calls[0];
      expect(input).not.toHaveProperty("updatedBy");
      expect(mockRepo.updateDiningTable).toHaveBeenCalledWith(ACTOR_ID, expect.anything());
    });
  });
});
