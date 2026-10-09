/**
 * listDiningTableRoomOptions action — behavioral tests.
 *
 * Exercises the REAL production action handler serverListDiningTableRoomOptions
 * in sundays-actions.server.ts. The authorization helper
 * (resolveSundaysActorWithPermission) and the space repository selector
 * (getSpaceRepository) are mocked at their real module boundaries via vi.mock,
 * so the action wiring — permission requested, projection shape, error
 * handling — is what is under test. These are MOCKED-BOUNDARY tests, not live
 * Supabase.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { VenueSpaceDTO } from "@/lib/spaces/types";
import type { ISpaceRepository } from "@/lib/server/space-repository-interface.server";

// ---------------------------------------------------------------------------
// Mock the space repository selector so we can assert calls and control data.
// ---------------------------------------------------------------------------
const mockRepo: {
  listAllSpaces: ReturnType<typeof vi.fn>;
} = {
  listAllSpaces: vi.fn(),
};

vi.mock("@/lib/server/space-repository.server", () => ({
  getSpaceRepository: (): ISpaceRepository => mockRepo as unknown as ISpaceRepository,
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
const { serverListDiningTableRoomOptions } = await import("@/lib/server/sundays-actions.server");

function authActor(): { role: string; userId: string } {
  return { role: "foh_staff", userId: "verified-session-user-id" };
}

function authReject(): never {
  throw new (class extends Error {
    constructor() {
      super("Unauthorized");
      this.name = "SundaysAuthorizationError";
    }
  })();
}

function makeSpaceDTO(overrides: Partial<VenueSpaceDTO> = {}): VenueSpaceDTO {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Grand Ballroom",
    slug: "grand-ballroom",
    description: "",
    spaceType: "general_dining",
    reportedCapacity: 950,
    onlineBookingLimit: 120,
    isActive: true,
    displayOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

describe("serverListDiningTableRoomOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockReset();
    mockRepo.listAllSpaces.mockReset();
  });

  it("requires seating.read before reaching the repository", async () => {
    mockResolve.mockImplementation(authReject);
    const result = await serverListDiningTableRoomOptions();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
    expect(mockRepo.listAllSpaces).not.toHaveBeenCalled();
    expect(mockResolve).toHaveBeenCalledWith("seating.read");
  });

  it("successful projection includes only the four allowed fields", async () => {
    mockResolve.mockImplementation(authActor);
    const spaces = [makeSpaceDTO()];
    mockRepo.listAllSpaces.mockResolvedValue(spaces);
    const result = await serverListDiningTableRoomOptions();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rooms).toHaveLength(1);
      const room = result.rooms[0];
      expect(room).toEqual({
        id: "11111111-1111-1111-1111-111111111111",
        name: "Grand Ballroom",
        spaceType: "general_dining",
        isActive: true,
      });
      // No booking limits, audit actors, or other venue config leak through.
      expect(room).not.toHaveProperty("onlineBookingLimit");
      expect(room).not.toHaveProperty("reportedCapacity");
      expect(room).not.toHaveProperty("createdBy");
      expect(room).not.toHaveProperty("updatedBy");
      expect(room).not.toHaveProperty("slug");
      expect(room).not.toHaveProperty("description");
    }
  });

  it("inactive rooms are retained", async () => {
    mockResolve.mockImplementation(authActor);
    const spaces = [
      makeSpaceDTO({ id: "a", name: "Active Room", isActive: true }),
      makeSpaceDTO({ id: "b", name: "Old Room", isActive: false }),
    ];
    mockRepo.listAllSpaces.mockResolvedValue(spaces);
    const result = await serverListDiningTableRoomOptions();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rooms).toHaveLength(2);
      expect(result.rooms[1].isActive).toBe(false);
      expect(result.rooms[1].name).toBe("Old Room");
    }
  });

  it("successful empty results are ok:true", async () => {
    mockResolve.mockImplementation(authActor);
    mockRepo.listAllSpaces.mockResolvedValue([]);
    const result = await serverListDiningTableRoomOptions();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rooms).toEqual([]);
  });

  it("repository failure returns a safe ok:false response, not an empty list", async () => {
    mockResolve.mockImplementation(authActor);
    mockRepo.listAllSpaces.mockRejectedValue(new Error("db down"));
    const result = await serverListDiningTableRoomOptions();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
      expect(result.error).not.toContain("db down");
    }
  });
});
