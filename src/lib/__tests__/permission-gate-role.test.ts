import { describe, it, expect } from "vitest";
import { roleHasPermission } from "@/lib/domain/roles";
import { ROLE_PERMISSIONS } from "@/lib/domain/roles";
import type { RoleKey, PermissionKey } from "@/lib/domain/types";

/**
 * Regression for the PermissionGate role-source mismatch.
 *
 * In Supabase mode the gate must use the authenticated session roleKey,
 * never a mock administrator. The roleHasPermission mapping is the single
 * source of truth for which roles can see Confirm/Cancel/Assign actions
 * for a pending_review reservation.
 */

const MANAGE = "reservations.manage" as PermissionKey;
const SEATING_MANAGE = "seating.manage" as PermissionKey;
const READ_ALL = "reservations.read_all" as PermissionKey;

describe("PermissionGate role resolution", () => {
  it("administrator holds reservations.manage, seating.manage, reservations.read_all", () => {
    const role = "administrator" as RoleKey;
    expect(roleHasPermission(role, MANAGE)).toBe(true);
    expect(roleHasPermission(role, SEATING_MANAGE)).toBe(true);
    expect(roleHasPermission(role, READ_ALL)).toBe(true);
  });

  it("ops_manager holds reservations.manage and reservations.read_all", () => {
    const role = "ops_manager" as RoleKey;
    expect(roleHasPermission(role, MANAGE)).toBe(true);
    expect(roleHasPermission(role, READ_ALL)).toBe(true);
  });

  it("foh_staff holds reservations.manage and seating.manage", () => {
    const role = "foh_staff" as RoleKey;
    expect(roleHasPermission(role, MANAGE)).toBe(true);
    expect(roleHasPermission(role, SEATING_MANAGE)).toBe(true);
  });

  it("guest does NOT hold reservations.manage, seating.manage, or reservations.read_all", () => {
    const role = "guest" as RoleKey;
    expect(roleHasPermission(role, MANAGE)).toBe(false);
    expect(roleHasPermission(role, SEATING_MANAGE)).toBe(false);
    expect(roleHasPermission(role, READ_ALL)).toBe(false);
  });

  it("content_manager and kitchen_staff lack reservation management permissions", () => {
    const content = "content_manager" as RoleKey;
    const kitchen = "kitchen_staff" as RoleKey;
    expect(roleHasPermission(content, MANAGE)).toBe(false);
    expect(roleHasPermission(content, SEATING_MANAGE)).toBe(false);
    expect(roleHasPermission(kitchen, MANAGE)).toBe(false);
    expect(roleHasPermission(kitchen, SEATING_MANAGE)).toBe(false);
  });

  it("ROLE_PERMISSIONS never grants reservations.manage to guest", () => {
    expect(ROLE_PERMISSIONS.guest).not.toContain("reservations.manage");
    expect(ROLE_PERMISSIONS.guest).not.toContain("seating.manage");
  });

  it("every role has a complete permission entry", () => {
    const keys: RoleKey[] = [
      "guest",
      "foh_staff",
      "kitchen_staff",
      "content_manager",
      "ops_manager",
      "administrator",
    ];
    for (const k of keys) {
      expect(Array.isArray(ROLE_PERMISSIONS[k])).toBe(true);
    }
  });
});
