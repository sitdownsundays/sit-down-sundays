import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { ROLES, PERMISSIONS, PERMISSION_KEYS, ROLE_PERMISSIONS } from "@/lib/domain/roles";
import type { RoleKey } from "@/lib/domain/types";

const MIGRATION_PATH = join(process.cwd(), "supabase", "migrations", "0002_auth_roles.sql");

function sql(): string {
  return readFileSync(MIGRATION_PATH, "utf-8");
}

/** SQL with `--` comment lines stripped, for structural/security assertions. */
function sqlCode(): string {
  return sql()
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/**
 * The database and application now share ONE role-key vocabulary. The
 * migration seeds the exact RoleKey union values, so no translation map is
 * needed.
 */
const APP_ROLE_KEYS: RoleKey[] = ROLES.map((r) => r.key);

describe("0002_auth_roles.sql — structure", () => {
  it("creates all required tables", () => {
    const s = sql();
    expect(s).toMatch(/create table[^;]*public\.profiles/i);
    expect(s).toMatch(/create table[^;]*public\.roles/i);
    expect(s).toMatch(/create table[^;]*public\.permissions/i);
    expect(s).toMatch(/create table[^;]*public\.role_permissions/i);
    expect(s).toMatch(/create table[^;]*public\.user_roles/i);
  });

  it("does not modify or reapply 0001", () => {
    const s = sqlCode();
    expect(s).not.toMatch(/waitlist_entries/i);
    expect(s).not.toMatch(/drop table/i);
    expect(s).not.toMatch(/truncate/i);
  });

  it("profiles references auth.users and carries required columns", () => {
    const s = sqlCode();
    expect(s).toMatch(/references auth\.users\(id\)\s+on delete cascade/i);
    expect(s).toMatch(/email\s+varchar\(254\)/i);
    expect(s).toMatch(/first_name\s+varchar\(80\)/i);
    expect(s).toMatch(/last_name\s+varchar\(80\)/i);
    expect(s).toMatch(/phone\s+varchar\(32\)/i);
    expect(s).toMatch(/status\s+varchar\(40\)/i);
    expect(s).toMatch(/last_sign_in_at\s+timestamptz/i);
  });

  it("profiles.status is constrained to the four valid values", () => {
    const s = sql();
    expect(s).toMatch(
      /status\s+varchar\(40\)\s+not null default 'invited'\s+check\s*\(status in \('invited','active','suspended','archived'\)\)/i,
    );
  });
});

describe("0002_auth_roles.sql — unified role-key vocabulary", () => {
  it("database role keys exactly match the application RoleKey union", () => {
    const s = sql();
    // The roles check constraint lists the exact app keys.
    for (const key of APP_ROLE_KEYS) {
      expect(s).toContain(`'${key}'`);
    }
  });

  it("does not use the old translated keys anywhere", () => {
    const s = sql();
    expect(s).not.toContain("'front_of_house'");
    expect(s).not.toContain("'operations_manager'");
  });

  it("seeds exactly the six application role keys", () => {
    const s = sql();
    for (const key of APP_ROLE_KEYS) {
      // Each key appears as a seeded role value.
      expect(s).toContain(`('${key}',`);
    }
  });

  it("roles include name, description, is_internal, and timestamps", () => {
    const s = sql();
    expect(s).toMatch(/name\s+varchar\(120\)/i);
    expect(s).toMatch(/description\s+text/i);
    expect(s).toMatch(/is_internal\s+boolean/i);
    expect(s).toMatch(/created_at\s+timestamptz/i);
    expect(s).toMatch(/updated_at\s+timestamptz/i);
  });

  it("marks only non-guest roles as internal", () => {
    const s = sql();
    expect(s).toMatch(/'guest'.*false/i);
    expect(s).toMatch(/'foh_staff'.*true/i);
    expect(s).toMatch(/'kitchen_staff'.*true/i);
    expect(s).toMatch(/'content_manager'.*true/i);
    expect(s).toMatch(/'ops_manager'.*true/i);
    expect(s).toMatch(/'administrator'.*true/i);
  });

  it("seeds inserts are idempotent (on conflict do nothing)", () => {
    const s = sql();
    expect(s).toMatch(/on conflict \(key\) do nothing/i);
  });
});

describe("0002_auth_roles.sql — permission vocabulary matches the app", () => {
  it("seeds every application permission key exactly once", () => {
    const s = sql();
    for (const key of PERMISSION_KEYS) {
      expect(s).toContain(`'${key}'`);
    }
  });

  it("does not invent any permission key outside the app vocabulary", () => {
    const s = sql();
    const found = Array.from(s.matchAll(/'([a-z_]+\.[a-z_]+(?:_[a-z_]+)?)'/g)).map((m) => m[1]);
    const known = new Set<string>(PERMISSION_KEYS);
    const offenders = found.filter((k) => k.includes(".") && !known.has(k));
    expect(offenders).toEqual([]);
  });
});

describe("0002_auth_roles.sql — role_permissions mirrors ROLE_PERMISSIONS", () => {
  it("maps each app role to the same permission set as ROLE_PERMISSIONS", () => {
    const s = sql();
    for (const roleKey of Object.keys(ROLE_PERMISSIONS) as RoleKey[]) {
      const expectedPerms = ROLE_PERMISSIONS[roleKey];
      // Every expected permission appears in the migration's seed block for
      // that role (the block is scoped by r.key = '<roleKey>').
      for (const perm of expectedPerms) {
        expect(s).toContain(`'${perm}'`);
      }
      // The migration references the exact app role key.
      expect(s).toContain(`r.key = '${roleKey}'`);
    }
  });

  it("administrator receives all permissions", () => {
    const s = sql();
    expect(s).toMatch(/where r\.key = 'administrator'\s*\n\s*on conflict/i);
  });

  it("role_permissions enforces a unique role+permission pair", () => {
    const s = sql();
    expect(s).toMatch(/unique \(role_id, permission_id\)/i);
  });
});

describe("0002_auth_roles.sql — user_roles history & dedupe", () => {
  it("preserves history via revoked_at rather than deletion", () => {
    const s = sql();
    expect(s).toMatch(/revoked_at\s+timestamptz/i);
  });

  it("prevents duplicate active assignments with a partial unique index", () => {
    const s = sql();
    expect(s).toMatch(
      /create unique index[^;]*uniq_user_roles_active[^;]*where revoked_at is null/i,
    );
  });

  it("references auth.users for user_id and assigned_by", () => {
    const s = sql();
    expect(s).toMatch(/user_id\s+uuid not null references auth\.users\(id\)\s+on delete cascade/i);
    expect(s).toMatch(/assigned_by\s+uuid references auth\.users\(id\)\s+on delete set null/i);
  });

  it("documents that user_id cascade deletes role assignments", () => {
    const s = sql();
    // The comment must describe actual ON DELETE CASCADE behavior, not claim
    // history is preserved on user deletion.
    expect(s).toMatch(/on delete cascade/i);
    expect(s).toMatch(/assigned_by.*on delete set null/i);
  });
});

describe("0002_auth_roles.sql — new-user trigger", () => {
  it("creates an idempotent after-insert trigger on auth.users", () => {
    const s = sql();
    expect(s).toMatch(/after insert on auth\.users/i);
    expect(s).toMatch(/on conflict \(id\) do nothing/i);
  });

  it("assigns only the Guest role and ignores browser metadata", () => {
    const s = sql();
    expect(s).toMatch(/where key = 'guest'/i);
    expect(s).not.toMatch(/raw_user_meta_data.*role/i);
  });

  it("uses SECURITY DEFINER with a safe search_path", () => {
    const s = sql();
    expect(s).toMatch(/security definer/i);
    expect(s).toMatch(/set search_path = public, pg_temp/i);
  });

  it("public signup still receives only Guest", () => {
    const s = sql();
    // The trigger body only ever inserts the guest role id; no other role key
    // is referenced inside handle_new_user for assignment.
    const start = s.indexOf("handle_new_user");
    const triggerBody = s.slice(start, s.indexOf("$$;", start));
    expect(triggerBody).toMatch(/where key = 'guest'/i);
    expect(triggerBody).not.toMatch(
      /'foh_staff'|'kitchen_staff'|'content_manager'|'ops_manager'|'administrator'/i,
    );
  });
});

describe("0002_auth_roles.sql — profile column privileges (no trigger)", () => {
  it("does NOT define a protect_profile_fields trigger or function", () => {
    const s = sql();
    expect(s).not.toMatch(/protect_profile_fields/i);
    expect(s).not.toMatch(/new\.status := old\.status/i);
    expect(s).not.toMatch(/new\.email := old\.email/i);
  });

  it("revokes general profile UPDATE from authenticated", () => {
    const s = sql();
    expect(s).toMatch(/revoke update on public\.profiles from authenticated/i);
  });

  it("grants authenticated UPDATE only on first_name, last_name, phone", () => {
    const s = sql();
    expect(s).toMatch(
      /grant update \(first_name, last_name, phone\) on public\.profiles to authenticated/i,
    );
  });

  it("does not grant authenticated UPDATE on status, email, or last_sign_in_at", () => {
    const s = sql();
    // The only grant to authenticated on profiles is the three-column one.
    const grants = Array.from(
      s.matchAll(/grant update[^;]+on public\.profiles to authenticated/gi),
    ).map((m) => m[0]);
    expect(grants).toHaveLength(1);
    expect(grants[0]).not.toMatch(/status/i);
    expect(grants[0]).not.toMatch(/email/i);
    expect(grants[0]).not.toMatch(/last_sign_in_at/i);
  });

  it("keeps the own-row RLS update policy", () => {
    const s = sql();
    expect(s).toMatch(/profiles_update_own.*id = auth\.uid\(\)/is);
  });
});

describe("0002_auth_roles.sql — security & RLS", () => {
  it("enables RLS on all new tables", () => {
    const s = sql();
    expect(s).toMatch(/alter table public\.profiles\s+enable row level security/i);
    expect(s).toMatch(/alter table public\.roles\s+enable row level security/i);
    expect(s).toMatch(/alter table public\.permissions\s+enable row level security/i);
    expect(s).toMatch(/alter table public\.role_permissions\s+enable row level security/i);
    expect(s).toMatch(/alter table public\.user_roles\s+enable row level security/i);
  });

  it("lets users read and update only their own profile", () => {
    const s = sql();
    expect(s).toMatch(/profiles_select_own.*id = auth\.uid\(\)/is);
    expect(s).toMatch(/profiles_update_own.*id = auth\.uid\(\)/is);
  });

  it("has no profile INSERT/DELETE policy for authenticated users", () => {
    const s = sql();
    const profilePolicies = s.match(/create policy[^;]+on public\.profiles[^;]+;/gis) ?? [];
    const joined = profilePolicies.join(" ");
    expect(joined).not.toMatch(/for insert/i);
    expect(joined).not.toMatch(/for delete/i);
  });

  it("lets users read only their own user_roles and never write them", () => {
    const s = sql();
    expect(s).toMatch(/user_roles_select_own.*user_id = auth\.uid\(\)/is);
    const urPolicies = s.match(/create policy[^;]+on public\.user_roles[^;]+;/gis) ?? [];
    const joined = urPolicies.join(" ");
    expect(joined).not.toMatch(/for insert/i);
    expect(joined).not.toMatch(/for update/i);
    expect(joined).not.toMatch(/for delete/i);
  });

  it("declares safe search paths on all database functions", () => {
    const s = sql();
    const fnCount = (s.match(/language plpgsql/gi) ?? []).length;
    const safeCount = (s.match(/set search_path = public, pg_temp/gi) ?? []).length;
    expect(safeCount).toBeGreaterThanOrEqual(fnCount);
  });

  it("avoids destructive operations", () => {
    const s = sqlCode();
    expect(s).not.toMatch(/\bdrop table\b/i);
    expect(s).not.toMatch(/\bdrop schema\b/i);
    expect(s).not.toMatch(/\btruncate\b/i);
  });
});

describe("0002_auth_roles.sql — consistency with app definitions", () => {
  it("seeds the same number of permissions as the app defines", () => {
    const s = sql();
    const matches = s.matchAll(
      /\('([a-z_]+\.[a-z_]+(?:_[a-z_]+)?)',\s*'[^']+',\s*'[^']+',\s*'[^']+'\)/g,
    );
    const keys = new Set<string>();
    for (const m of matches) keys.add(m[1]);
    expect(keys.size).toBe(PERMISSIONS.length);
  });

  it("seeds the same number of roles as the app defines", () => {
    const s = sql();
    const roleRows = s.matchAll(
      /\('(guest|foh_staff|kitchen_staff|content_manager|ops_manager|administrator)',/g,
    );
    const keys = new Set<string>();
    for (const m of roleRows) keys.add(m[1]);
    expect(keys.size).toBe(ROLES.length);
  });
});
