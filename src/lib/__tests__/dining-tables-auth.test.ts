/**
 * Dining-table authorization — behavioral tests.
 *
 * Exercises the REAL production authorization helper
 * `resolveSundaysActorWithPermission` (in sundays-auth.server.ts) — the single
 * canonical helper the dining-table actions import. The auth REPOSITORY is
 * mocked at its real boundary via the project's mock-session helpers
 * (__getMockAuthRepository / __seedMockSession), NOT the authorization helper
 * itself, so the real permission-checking logic is under test.
 *
 * These are MOCKED-CLIENT tests (no real database, no real Supabase auth).
 * They do NOT prove live Supabase session resolution.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { __getMockAuthRepository } from "@/lib/server/auth-repository.server";
import {
  resolveSundaysActorWithPermission,
  SundaysAuthorizationError,
} from "@/lib/server/sundays-auth.server";
import type { RoleKey } from "@/lib/domain/types";

function authenticateAs(role: RoleKey): string {
  return __getMockAuthRepository().__seedMockSession(role).id;
}

beforeEach(() => {
  process.env.APP_DATA_MODE = "mock";
  try {
    void __getMockAuthRepository().signout(false);
  } catch {
    /* first call: no instance yet */
  }
});

describe("resolveSundaysActorWithPermission — dining-table authorization", () => {
  it("rejects unauthenticated sessions for seating.read", async () => {
    await expect(resolveSundaysActorWithPermission("seating.read")).rejects.toThrow(
      SundaysAuthorizationError,
    );
  });

  it("rejects unauthenticated sessions for seating.manage", async () => {
    await expect(resolveSundaysActorWithPermission("seating.manage")).rejects.toThrow(
      SundaysAuthorizationError,
    );
  });

  it("denies a role with neither seating permission (kitchen_staff) for seating.read", async () => {
    authenticateAs("kitchen_staff");
    await expect(resolveSundaysActorWithPermission("seating.read")).rejects.toThrow(
      SundaysAuthorizationError,
    );
  });

  it("denies a role without seating.manage (guest) for seating.manage", async () => {
    authenticateAs("guest");
    await expect(resolveSundaysActorWithPermission("seating.manage")).rejects.toThrow(
      SundaysAuthorizationError,
    );
  });

  it("allows seating.read for foh_staff and returns the verified session actor ID", async () => {
    const seededId = authenticateAs("foh_staff");
    const actor = await resolveSundaysActorWithPermission("seating.read");
    expect(actor.userId).toBe(seededId);
    expect(actor.role).toBe("foh_staff");
  });

  it("allows seating.manage for foh_staff and returns the verified session actor ID", async () => {
    const seededId = authenticateAs("foh_staff");
    const actor = await resolveSundaysActorWithPermission("seating.manage");
    expect(actor.userId).toBe(seededId);
    expect(actor.role).toBe("foh_staff");
  });

  it("allows seating.manage for ops_manager and returns the verified session actor ID", async () => {
    const seededId = authenticateAs("ops_manager");
    const actor = await resolveSundaysActorWithPermission("seating.manage");
    expect(actor.userId).toBe(seededId);
    expect(actor.role).toBe("ops_manager");
  });

  it("allows both seating.read and seating.manage for administrator", async () => {
    const seededId = authenticateAs("administrator");
    const readActor = await resolveSundaysActorWithPermission("seating.read");
    expect(readActor.role).toBe("administrator");
    expect(readActor.userId).toBe(seededId);
    const manageActor = await resolveSundaysActorWithPermission("seating.manage");
    expect(manageActor.role).toBe("administrator");
    expect(manageActor.userId).toBe(seededId);
  });

  it("never accepts a browser-supplied role — only the resolved session role is used", async () => {
    authenticateAs("foh_staff");
    // The helper accepts only a permission key, never a role from the caller.
    const actor = await resolveSundaysActorWithPermission("seating.manage");
    expect(actor.role).toBe("foh_staff");
  });
});
