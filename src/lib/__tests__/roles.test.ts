import { describe, it, expect } from "vitest";
import { ROLES, ROLE_PERMISSIONS, PERMISSION_KEYS, roleHasPermission } from "@/lib/domain/roles";
import { ROLE_KEYS } from "@/lib/domain";
import type { PermissionKey, RoleKey } from "@/lib/domain/types";

describe("role-to-permission mapping", () => {
  it("defines all six roles", () => {
    expect(ROLES.map((r) => r.key).sort()).toEqual(
      [
        "administrator",
        "content_manager",
        "foh_staff",
        "guest",
        "kitchen_staff",
        "ops_manager",
      ].sort(),
    );
  });

  it("every role has at least one permission", () => {
    for (const key of ROLE_KEYS) {
      expect(ROLE_PERMISSIONS[key].length).toBeGreaterThan(0);
    }
  });

  it("administrator holds every permission", () => {
    expect(ROLE_PERMISSIONS.administrator).toEqual(expect.arrayContaining(PERMISSION_KEYS));
    expect(ROLE_PERMISSIONS.administrator.length).toBe(PERMISSION_KEYS.length);
  });

  it("kitchen staff has no financial permissions", () => {
    const kitchen = ROLE_PERMISSIONS.kitchen_staff;
    expect(kitchen).not.toContain("payments.read");
    expect(kitchen).not.toContain("payments.manage");
    expect(kitchen).not.toContain("pricing.manage");
  });

  it("guest only has own-account permissions", () => {
    const guest = ROLE_PERMISSIONS.guest;
    expect(guest).toEqual(["account.read_own", "account.update_own", "reservations.read_own"]);
  });

  it("roleHasPermission returns correct booleans", () => {
    expect(roleHasPermission("guest", "account.read_own")).toBe(true);
    expect(roleHasPermission("guest", "reservations.read_all")).toBe(false);
    expect(roleHasPermission("administrator", "audit.read")).toBe(true);
  });

  it("every permission assigned to a role is a valid permission key", () => {
    const valid = new Set<PermissionKey>(PERMISSION_KEYS);
    for (const key of ROLE_KEYS) {
      for (const p of ROLE_PERMISSIONS[key]) {
        expect(valid.has(p)).toBe(true);
      }
    }
  });

  it("every role key is a valid RoleKey", () => {
    const valid: RoleKey[] = [
      "guest",
      "foh_staff",
      "kitchen_staff",
      "content_manager",
      "ops_manager",
      "administrator",
    ];
    expect(ROLE_KEYS.sort()).toEqual(valid.sort());
  });
});
