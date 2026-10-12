/**
 * Focused tests for the capacityResourceId field wiring through the Sundays
 * service types/schema/repositories. Mocked-boundary tests, not live PostgreSQL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSundayServiceSchema, updateSundayServiceSchema } from "@/lib/sundays/schema";

describe("Sunday service capacityResourceId schema", () => {
  it("create: omits capacityResourceId (optional)", () => {
    const parsed = createSundayServiceSchema.parse({
      date: "2026-11-15",
      spaceId: "11111111-1111-1111-1111-111111111111",
    });
    expect(parsed.capacityResourceId).toBeUndefined();
  });

  it("create: accepts a UUID capacityResourceId", () => {
    const rid = "22222222-2222-2222-2222-222222222222";
    const parsed = createSundayServiceSchema.parse({
      date: "2026-11-15",
      spaceId: "11111111-1111-1111-1111-111111111111",
      capacityResourceId: rid,
    });
    expect(parsed.capacityResourceId).toBe(rid);
  });

  it("create: accepts explicit null (default mapping)", () => {
    const parsed = createSundayServiceSchema.parse({
      date: "2026-11-15",
      spaceId: "11111111-1111-1111-1111-111111111111",
      capacityResourceId: null,
    });
    expect(parsed.capacityResourceId).toBeNull();
  });

  it("create: rejects a non-UUID capacityResourceId", () => {
    expect(() =>
      createSundayServiceSchema.parse({
        date: "2026-11-15",
        spaceId: "11111111-1111-1111-1111-111111111111",
        capacityResourceId: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("update: omits capacityResourceId = leave unchanged", () => {
    const parsed = updateSundayServiceSchema.parse({
      id: "11111111-1111-1111-1111-111111111111",
      expectedUpdatedAt: "2026-01-01T00:00:00Z",
      label: "New label",
    });
    expect(parsed.capacityResourceId).toBeUndefined();
  });

  it("update: explicit null restores default mapping", () => {
    const parsed = updateSundayServiceSchema.parse({
      id: "11111111-1111-1111-1111-111111111111",
      expectedUpdatedAt: "2026-01-01T00:00:00Z",
      capacityResourceId: null,
    });
    expect(parsed.capacityResourceId).toBeNull();
  });

  it("update: accepts a UUID override", () => {
    const rid = "33333333-3333-3333-3333-333333333333";
    const parsed = updateSundayServiceSchema.parse({
      id: "11111111-1111-1111-1111-111111111111",
      expectedUpdatedAt: "2026-01-01T00:00:00Z",
      capacityResourceId: rid,
    });
    expect(parsed.capacityResourceId).toBe(rid);
  });
});

describe("Mock repository capacityResourceId round-trip", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("@/lib/server/env.server", () => ({
      resolveDataMode: () => "mock",
      resolveSupabaseUrl: () => null,
      isSupabaseMode: () => false,
    }));
  });

  it("create persists capacityResourceId; update preserves when omitted", async () => {
    const { getSundaysRepository } = await import("@/lib/server/sundays-repository.server");
    const repo = getSundaysRepository();
    const rid = "44444444-4444-4444-4444-444444444444";
    const created = await repo.createSundayService("actor-1", {
      date: "2026-11-15",
      spaceId: "11111111-1111-1111-1111-111111111111",
      capacityResourceId: rid,
    });
    expect(created.success).toBe(true);
    expect(created.data?.capacityResourceId).toBe(rid);

    // Update with a different field, omitting capacityResourceId
    const updated = await repo.updateSundayService("actor-1", {
      id: created.data!.id,
      expectedUpdatedAt: created.data!.updatedAt,
      label: "Renamed",
    });
    expect(updated.success).toBe(true);
    expect(updated.data?.label).toBe("Renamed");
    // capacityResourceId preserved (not reset to null)
    expect(updated.data?.capacityResourceId).toBe(rid);
  });

  it("update explicit null restores default mapping", async () => {
    const { getSundaysRepository } = await import("@/lib/server/sundays-repository.server");
    const repo = getSundaysRepository();
    const rid = "55555555-5555-5555-5555-555555555555";
    const created = await repo.createSundayService("actor-1", {
      date: "2026-11-22",
      spaceId: "11111111-1111-1111-1111-111111111111",
      capacityResourceId: rid,
    });
    const updated = await repo.updateSundayService("actor-1", {
      id: created.data!.id,
      expectedUpdatedAt: created.data!.updatedAt,
      capacityResourceId: null,
    });
    expect(updated.success).toBe(true);
    expect(updated.data?.capacityResourceId).toBeNull();
  });
});
