/**
 * Focused action tests for serverListServiceCapacityOptions.
 *
 * Exercises the REAL action with mocked authorization, admin-client, and
 * capacity-resource-reader boundaries. Mocked-boundary tests, NOT live
 * PostgreSQL verification.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock boundaries --------------------------------------------------------

const mockResolveSundaysActor = vi.fn();
const mockReadCapacityResources = vi.fn();

vi.mock("@/lib/server/sundays-auth.server", () => ({
  resolveSundaysActor: (...args: unknown[]) => mockResolveSundaysActor(...args),
}));

vi.mock("@/lib/server/supabase-admin.server", () => ({
  getAdminClient: () => ({ mocked: true }),
}));

vi.mock("@/lib/server/capacity-availability-data.server", () => ({
  readCapacityResources: (...args: unknown[]) => mockReadCapacityResources(...args),
}));

// --- Fixtures ---------------------------------------------------------------

const BALLROOM_ID = "11111111-1111-4111-8111-111111111111";
const MAYORAL_S1_ID = "22222222-2222-4222-8222-222222222222";
const MAYORAL_S2_ID = "33333333-3333-4333-8333-333333333333";
const MAYORAL_WHOLE_ID = "44444444-4444-4444-8444-444444444444";

/** A deterministic UUID fixture for the spaceId input. */
const BALLROOM_SPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MAYORAL_S1_SPACE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function standaloneResource(id: string, spaceId: string, totalCapacity: number, isActive = true) {
  return {
    id,
    space_id: spaceId,
    total_capacity: totalCapacity,
    parent_id: null,
    resource_type: "standalone" as const,
    is_active: isActive,
  };
}

function wholeResource(id: string, totalCapacity: number, isActive = true) {
  return {
    id,
    space_id: null,
    total_capacity: totalCapacity,
    parent_id: null,
    resource_type: "whole" as const,
    is_active: isActive,
  };
}

function sectionResource(
  id: string,
  spaceId: string,
  parentId: string,
  totalCapacity: number,
  isActive = true,
) {
  return {
    id,
    space_id: spaceId,
    total_capacity: totalCapacity,
    parent_id: parentId,
    resource_type: "section" as const,
    is_active: isActive,
  };
}

function resourceMap(...resources: ReturnType<typeof standaloneResource>[]) {
  return new Map(resources.map((r) => [r.id, r]));
}

// --- Suite ------------------------------------------------------------------

describe("serverListServiceCapacityOptions", () => {
  let serverListServiceCapacityOptions: typeof import("@/lib/server/service-capacity-options.server").serverListServiceCapacityOptions;

  beforeEach(async () => {
    vi.resetModules();
    mockResolveSundaysActor.mockReset();
    mockReadCapacityResources.mockReset();

    // Re-import after mock reset so the action picks up fresh mocks.
    const mod = await import("@/lib/server/service-capacity-options.server");
    serverListServiceCapacityOptions = mod.serverListServiceCapacityOptions;
  });

  // -- Authorization --------------------------------------------------------

  it("returns a safe error when not authorized, without touching the database", async () => {
    mockResolveSundaysActor.mockRejectedValue(new Error("Unauthorized"));

    const result = await serverListServiceCapacityOptions({ spaceId: BALLROOM_SPACE_ID });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/authorized/i);
    expect(mockReadCapacityResources).not.toHaveBeenCalled();
  });

  // -- Input validation -----------------------------------------------------

  it("rejects an invalid UUID without database access", async () => {
    mockResolveSundaysActor.mockResolvedValue({ role: "administrator", userId: "actor-1" });

    const result = await serverListServiceCapacityOptions({ spaceId: "not-a-uuid" });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid/i);
    expect(mockReadCapacityResources).not.toHaveBeenCalled();
  });

  it("rejects unknown input fields without database access", async () => {
    mockResolveSundaysActor.mockResolvedValue({ role: "administrator", userId: "actor-1" });

    const result = await serverListServiceCapacityOptions({
      spaceId: BALLROOM_SPACE_ID,
      capacityResourceId: MAYORAL_WHOLE_ID,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid/i);
    expect(mockReadCapacityResources).not.toHaveBeenCalled();
  });

  // -- Standalone room ------------------------------------------------------

  it("returns only the default/null option for an active standalone room", async () => {
    mockResolveSundaysActor.mockResolvedValue({ role: "administrator", userId: "actor-1" });
    mockReadCapacityResources.mockResolvedValue(
      resourceMap(standaloneResource(BALLROOM_ID, BALLROOM_SPACE_ID, 950)),
    );

    const result = await serverListServiceCapacityOptions({ spaceId: BALLROOM_SPACE_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options).toHaveLength(1);
    expect(result.options[0]).toEqual({
      capacityResourceId: null,
      mode: "default",
      totalCapacity: 950,
    });
  });

  // -- Section room ---------------------------------------------------------

  it("returns default/null plus its own active whole parent for an active section", async () => {
    mockResolveSundaysActor.mockResolvedValue({ role: "administrator", userId: "actor-1" });
    mockReadCapacityResources.mockResolvedValue(
      resourceMap(
        wholeResource(MAYORAL_WHOLE_ID, 120),
        sectionResource(MAYORAL_S1_ID, MAYORAL_S1_SPACE_ID, MAYORAL_WHOLE_ID, 60),
        sectionResource(
          MAYORAL_S2_ID,
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          MAYORAL_WHOLE_ID,
          60,
        ),
      ),
    );

    const result = await serverListServiceCapacityOptions({ spaceId: MAYORAL_S1_SPACE_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.options).toHaveLength(2);

    const defaultOpt = result.options.find((o) => o.mode === "default");
    expect(defaultOpt).toEqual({
      capacityResourceId: null,
      mode: "default",
      totalCapacity: 60,
    });

    const wholeOpt = result.options.find((o) => o.mode === "whole");
    expect(wholeOpt).toEqual({
      capacityResourceId: MAYORAL_WHOLE_ID,
      mode: "whole",
      totalCapacity: 120,
    });
  });

  it("does not offer a sibling section or an unrelated whole room", async () => {
    mockResolveSundaysActor.mockResolvedValue({ role: "administrator", userId: "actor-1" });
    mockReadCapacityResources.mockResolvedValue(
      resourceMap(
        wholeResource(MAYORAL_WHOLE_ID, 120),
        sectionResource(MAYORAL_S1_ID, MAYORAL_S1_SPACE_ID, MAYORAL_WHOLE_ID, 60),
        sectionResource(
          MAYORAL_S2_ID,
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          MAYORAL_WHOLE_ID,
          60,
        ),
        standaloneResource(BALLROOM_ID, BALLROOM_SPACE_ID, 950),
      ),
    );

    const result = await serverListServiceCapacityOptions({ spaceId: MAYORAL_S1_SPACE_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only default (section itself) + whole parent. No sibling section, no ballroom.
    const ids = result.options.map((o) => o.capacityResourceId);
    expect(ids).toContain(null);
    expect(ids).toContain(MAYORAL_WHOLE_ID);
    expect(ids).not.toContain(MAYORAL_S2_ID);
    expect(ids).not.toContain(BALLROOM_ID);
    expect(result.options).toHaveLength(2);
  });

  // -- Capacities from records ----------------------------------------------

  it("uses capacities from the records, not hardcoded values", async () => {
    mockResolveSundaysActor.mockResolvedValue({ role: "administrator", userId: "actor-1" });
    mockReadCapacityResources.mockResolvedValue(
      resourceMap(
        wholeResource(MAYORAL_WHOLE_ID, 140),
        sectionResource(MAYORAL_S1_ID, MAYORAL_S1_SPACE_ID, MAYORAL_WHOLE_ID, 70),
      ),
    );

    const result = await serverListServiceCapacityOptions({ spaceId: MAYORAL_S1_SPACE_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const defaultOpt = result.options.find((o) => o.mode === "default");
    const wholeOpt = result.options.find((o) => o.mode === "whole");
    expect(defaultOpt?.totalCapacity).toBe(70);
    expect(wholeOpt?.totalCapacity).toBe(140);
  });

  // -- Missing / inactive mapping -------------------------------------------

  it("fails when no resource is mapped to the space", async () => {
    mockResolveSundaysActor.mockResolvedValue({ role: "administrator", userId: "actor-1" });
    mockReadCapacityResources.mockResolvedValue(
      resourceMap(standaloneResource(BALLROOM_ID, BALLROOM_SPACE_ID, 950)),
    );

    const result = await serverListServiceCapacityOptions({ spaceId: MAYORAL_S1_SPACE_ID });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not have/i);
  });

  it("fails when the mapped resource is inactive", async () => {
    mockResolveSundaysActor.mockResolvedValue({ role: "administrator", userId: "actor-1" });
    mockReadCapacityResources.mockResolvedValue(
      resourceMap(standaloneResource(BALLROOM_ID, BALLROOM_SPACE_ID, 950, false)),
    );

    const result = await serverListServiceCapacityOptions({ spaceId: BALLROOM_SPACE_ID });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not have an active/i);
  });

  // -- Missing / inactive parent --------------------------------------------

  it("fails when the section's whole parent is missing", async () => {
    mockResolveSundaysActor.mockResolvedValue({ role: "administrator", userId: "actor-1" });
    mockReadCapacityResources.mockResolvedValue(
      resourceMap(
        sectionResource(
          MAYORAL_S1_ID,
          MAYORAL_S1_SPACE_ID,
          "00000000-0000-4000-8000-000000000000",
          60,
        ),
      ),
    );

    const result = await serverListServiceCapacityOptions({ spaceId: MAYORAL_S1_SPACE_ID });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/could not be verified/i);
  });

  it("fails when the section's whole parent is inactive", async () => {
    mockResolveSundaysActor.mockResolvedValue({ role: "administrator", userId: "actor-1" });
    mockReadCapacityResources.mockResolvedValue(
      resourceMap(
        wholeResource(MAYORAL_WHOLE_ID, 120, false),
        sectionResource(MAYORAL_S1_ID, MAYORAL_S1_SPACE_ID, MAYORAL_WHOLE_ID, 60),
      ),
    );

    const result = await serverListServiceCapacityOptions({ spaceId: MAYORAL_S1_SPACE_ID });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/could not be verified/i);
  });

  // -- Reader rejection -----------------------------------------------------

  it("returns a safe error when the reader throws, without raw database text", async () => {
    mockResolveSundaysActor.mockResolvedValue({ role: "administrator", userId: "actor-1" });
    mockReadCapacityResources.mockRejectedValue(
      new Error("raw DB connection string pg://secret:5432"),
    );

    const result = await serverListServiceCapacityOptions({ spaceId: BALLROOM_SPACE_ID });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/could not be loaded/i);
    expect(result.error).not.toContain("pg://");
    expect(result.error).not.toContain("secret");
  });
});
