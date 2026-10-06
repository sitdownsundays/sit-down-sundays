import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MockSpaceRepository } from "@/lib/server/space-mock.server";
import { createVenueSpaceSchema, updateVenueSpaceSchema } from "@/lib/spaces/schema";
import { SPACE_TYPES } from "@/lib/spaces/constants";

const SQL_PATH = resolve("supabase/migrations/0008_venue_spaces.sql");
const sql = readFileSync(SQL_PATH, "utf8");

describe("0008_venue_spaces migration — structure", () => {
  it("creates the venue_spaces table", () => {
    expect(sql).toMatch(/create table if not exists public\.venue_spaces/i);
  });

  it("seeds exactly three confirmed spaces and no suites", () => {
    expect(sql).toMatch(/'Grand Ballroom'/);
    expect(sql).toMatch(/'Mayoral Room 1'/);
    expect(sql).toMatch(/'Mayoral Room 2'/);
    // Seed INSERTs must not include a suite row. Comments may mention suites.
    const inserts = sql.match(/INSERT INTO public\.venue_spaces[\s\S]*?;/gi) ?? [];
    const allInserts = inserts.join("\n");
    expect(allInserts).not.toMatch(/suite/i);
  });

  it("defaults online_booking_limit to null (nothing for sale)", () => {
    expect(sql).toMatch(/online_booking_limit\s+integer,/i);
    const ballroomLine = sql.match(/'Grand Ballroom'[\s\S]*?'general_dining',\s*950,\s*NULL/i);
    expect(ballroomLine).not.toBeNull();
  });

  it("keeps mayoral rooms request-only", () => {
    expect(sql).toMatch(/'Mayoral Room 1'[\s\S]*?'request_only'/);
    expect(sql).toMatch(/'Mayoral Room 2'[\s\S]*?'request_only'/);
  });

  it("enforces reported_capacity separately from online_booking_limit", () => {
    expect(sql).toMatch(/check_venue_spaces_reported_capacity/i);
    expect(sql).toMatch(/check_venue_spaces_online_booking_limit/i);
  });

  it("constrains space_type to the three supported values", () => {
    expect(sql).toMatch(/space_type in \('general_dining', 'request_only', 'not_bookable'\)/i);
  });

  it("uses canonical slug format matching the application", () => {
    expect(sql).toMatch(/check_venue_spaces_slug_format/i);
    expect(sql).toMatch(/\^\[a-z0-9\]\+\(\?:-\[a-z0-9\]\+\)\*\$/);
  });

  it("enables RLS with no anon/authenticated policies (internal config)", () => {
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/no select\/insert\/update\/delete policies for anon or authenticated/i);
  });

  it("revokes table access from public/anon/authenticated and grants service_role", () => {
    expect(sql).toMatch(
      /revoke all on table public\.venue_spaces\s+from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant select, insert, update on table public\.venue_spaces\s+to service_role/i,
    );
  });

  it("reuses audit_cms_change for atomic audit logging", () => {
    expect(sql).toMatch(/trg_venue_spaces_audit/i);
    expect(sql).toMatch(/audit_cms_change\(\)/i);
  });

  it("wraps the migration in BEGIN/COMMIT", () => {
    const beginIdx = sql.search(/\bbegin\b/i);
    expect(beginIdx).toBeGreaterThan(-1);
    const commitIdx = sql.toLowerCase().lastIndexOf("commit");
    expect(commitIdx).toBeGreaterThan(beginIdx);
  });

  it("describes that setting a limit does not open bookings", () => {
    expect(sql).toMatch(/does NOT open bookings/i);
  });

  it("fixes the SECURITY INVOKER comment to reference invoking role, not owner", () => {
    expect(sql).toMatch(/SECURITY INVOKER/i);
    expect(sql).toMatch(/invoking statement's role's privileges/i);
  });
});

describe("venue spaces — schema validation", () => {
  it("create schema rejects protected fields (id, timestamps, audit)", () => {
    const result = createVenueSpaceSchema.safeParse({
      name: "Test Room",
      slug: "test-room",
      id: "should-not-be-accepted",
      createdAt: "2024-01-01",
      createdBy: "x",
    });
    expect(result.success).toBe(false);
  });

  it("create schema defaults onlineBookingLimit to null", () => {
    const result = createVenueSpaceSchema.parse({ name: "Test Room", slug: "test-room" });
    expect(result.onlineBookingLimit).toBeNull();
    expect(result.spaceType).toBe("general_dining");
    expect(result.isActive).toBe(true);
  });

  it("create schema rejects negative reported capacity", () => {
    const result = createVenueSpaceSchema.safeParse({
      name: "Bad",
      slug: "bad",
      reportedCapacity: -1,
    });
    expect(result.success).toBe(false);
  });

  it("update schema rejects id-less input and requires expectedUpdatedAt", () => {
    const result = updateVenueSpaceSchema.safeParse({ onlineBookingLimit: 100 });
    expect(result.success).toBe(false);
  });

  it("update schema rejects protected fields beyond the contract", () => {
    const result = updateVenueSpaceSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      expectedUpdatedAt: "2024-01-01T00:00:00Z",
      name: "X",
      createdBy: "attacker",
      updatedAt: "2024-01-02T00:00:00Z",
    });
    expect(result.success).toBe(false);
  });

  it("space types match the database constraint values", () => {
    expect(SPACE_TYPES).toEqual(["general_dining", "request_only", "not_bookable"]);
  });
});

describe("venue spaces — mock repository behavior", () => {
  async function freshRepo() {
    // Each test gets its own isolated instance to avoid cross-test bleed.
    return new MockSpaceRepository();
  }

  it("seeds exactly three spaces (no fictional suite)", async () => {
    const repo = await freshRepo();
    const spaces = await repo.listAllSpaces();
    expect(spaces).toHaveLength(3);
    expect(spaces.map((s) => s.name).sort()).toEqual([
      "Grand Ballroom",
      "Mayoral Room 1",
      "Mayoral Room 2",
    ]);
  });

  it("defaults all seeded booking limits to null", async () => {
    const repo = await freshRepo();
    const spaces = await repo.listAllSpaces();
    expect(spaces.every((s) => s.onlineBookingLimit === null)).toBe(true);
  });

  it("keeps mayoral rooms request-only", async () => {
    const repo = await freshRepo();
    const spaces = await repo.listAllSpaces();
    const mayoral = spaces.filter((s) => s.name.startsWith("Mayoral"));
    expect(mayoral.every((s) => s.spaceType === "request_only")).toBe(true);
  });

  it("updates a booking limit and returns the updated record", async () => {
    const repo = await freshRepo();
    const spaces = await repo.listAllSpaces();
    const ballroom = spaces.find((s) => s.slug === "grand-ballroom")!;
    const result = await repo.updateSpace("staff-1", {
      id: ballroom.id,
      expectedUpdatedAt: ballroom.updatedAt,
      onlineBookingLimit: 200,
    });
    expect(result.success).toBe(true);
    expect(result.space?.onlineBookingLimit).toBe(200);
    expect(result.space?.reportedCapacity).toBe(950);
  });

  it("rejects a stale update with a conflict result", async () => {
    const repo = await freshRepo();
    const spaces = await repo.listAllSpaces();
    const ballroom = spaces.find((s) => s.slug === "grand-ballroom")!;
    // First update succeeds and bumps updatedAt.
    await repo.updateSpace("staff-1", {
      id: ballroom.id,
      expectedUpdatedAt: ballroom.updatedAt,
      onlineBookingLimit: 200,
    });
    // Second update with the STALE timestamp must conflict.
    const stale = await repo.updateSpace("staff-2", {
      id: ballroom.id,
      expectedUpdatedAt: ballroom.updatedAt,
      onlineBookingLimit: 300,
    });
    expect(stale.success).toBe(false);
    expect(stale.conflict).toBe(true);
  });

  it("does not allow a duplicate slug on create", async () => {
    const repo = await freshRepo();
    const result = await repo.createSpace("staff-1", {
      name: "Duplicate",
      slug: "grand-ballroom",
      spaceType: "general_dining",
      reportedCapacity: 10,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("slug");
  });

  it("preserves reportedCapacity when only booking limit changes", async () => {
    const repo = await freshRepo();
    const spaces = await repo.listAllSpaces();
    const room = spaces.find((s) => s.slug === "mayoral-room-1")!;
    const result = await repo.updateSpace("staff-1", {
      id: room.id,
      expectedUpdatedAt: room.updatedAt,
      onlineBookingLimit: 40,
    });
    expect(result.success).toBe(true);
    expect(result.space?.reportedCapacity).toBe(60);
    expect(result.space?.spaceType).toBe("request_only");
  });
});
