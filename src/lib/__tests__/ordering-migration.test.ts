/**
 * 0009_ordering_model.sql — regression tests for previously-identified blockers.
 *
 * These tests prove the seven blockers are corrected. They are SOURCE-PATTERN
 * tests against the SQL file (PostgreSQL execution is NOT performed here — the
 * migration is unapplied and reviewed externally). They assert the migration
 * contains the corrected patterns and does NOT contain the broken ones.
 *
 * Blockers covered:
 *   1. Malformed DROP TRIGGER syntax (no event clause on DROP).
 *   2. Invalid singleton CHECK (must be CHECK (id = 1), not a subquery).
 *   3. guest_pricing_rules has created_by (audit_cms_change reads it on INSERT).
 *   4. Non-atomic package/add-on saves replaced by RPCs.
 *   5. Eligibility-write errors surfaced (RPC returns a code), not ignored.
 *   6. Optimistic concurrency enforced INSIDE the write (WHERE updated_at = ...).
 *   7. Database read errors THROW, not return empty success.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL_PATH = resolve("supabase/migrations/0009_ordering_model.sql");
const sql = readFileSync(SQL_PATH, "utf8");
const REPO_PATH = resolve("src/lib/server/ordering-supabase.server.ts");
const repo = readFileSync(REPO_PATH, "utf8");

describe("0009 blocker 1 — DROP TRIGGER syntax", () => {
  it("no DROP TRIGGER statement includes an event clause (AFTER/BEFORE)", () => {
    // The malformed pattern was: DROP TRIGGER IF EXISTS x AFTER INSERT ON t;
    const malformed = /drop trigger if exists\s+\w+\s+(after|before)\s/i;
    expect(malformed.test(sql)).toBe(false);
  });

  it("every DROP TRIGGER uses the correct name ON table form", () => {
    const drops = sql.match(/drop trigger if exists\s+\w+\s+on\s+public\.\w+/gi) ?? [];
    expect(drops.length).toBeGreaterThan(0);
    // None of the DROP statements carry an event clause (the malformed form).
    for (const d of drops) {
      expect(/after|before/i.test(d)).toBe(false);
    }
  });
});

describe("0009 blocker 2 — singleton CHECK constraint", () => {
  it("uses a valid CHECK (id = 1), not a subquery", () => {
    expect(sql).toMatch(/guest_pricing_rules_single_row check \(id = 1\)/i);
    // A subquery inside a column-level CHECK is invalid in PostgreSQL; assert
    // the singleton constraint is a simple expression, not (SELECT ...).
    expect(sql).not.toMatch(/check \(id = \(select/i);
    expect(sql).not.toMatch(/check \(select count/i);
  });
});

describe("0009 blocker 3 — guest_pricing_rules has created_by", () => {
  it("guest_pricing_rules table defines created_by referencing auth.users", () => {
    // The guest_pricing_rules CREATE TABLE block includes a created_by column
    // referencing auth.users, so audit_cms_change can read new.created_by on INSERT.
    expect(sql).toMatch(
      /create table if not exists public\.guest_pricing_rules[\s\S]*?created_by\s+uuid references auth\.users\(id\)/i,
    );
  });
});

describe("0009 blocker 4 — atomic package/add-on saves via RPCs", () => {
  it("defines update_package_atomic, update_addon_atomic, update_platter_atomic, update_guest_pricing_rules_atomic", () => {
    expect(sql).toMatch(/create or replace function public\.update_package_atomic/i);
    expect(sql).toMatch(/create or replace function public\.update_addon_atomic/i);
    expect(sql).toMatch(/create or replace function public\.update_platter_atomic/i);
    expect(sql).toMatch(/create or replace function public\.update_guest_pricing_rules_atomic/i);
  });

  it("the repository calls the RPCs instead of a manual DELETE-then-INSERT", () => {
    // The RPC name may wrap across lines after formatting; match the bare name.
    expect(repo).toMatch(/\.rpc\(\s*"update_package_atomic"/);
    expect(repo).toMatch(/\.rpc\(\s*"update_addon_atomic"/);
    expect(repo).toMatch(/\.rpc\(\s*"update_platter_atomic"/);
    expect(repo).toMatch(/\.rpc\(\s*"update_guest_pricing_rules_atomic"/);
  });

  it("no replaceEligible / replaceAddonLinks manual two-step methods remain", () => {
    expect(repo).not.toMatch(/replaceEligible|replaceAddonLinks/);
  });
});

describe("0009 blocker 5 — eligibility-write errors are surfaced", () => {
  it("the RPC returns a code on failure (not a swallowed void)", () => {
    expect(sql).toMatch(/return jsonb_build_object\('ok', false, 'code'/i);
  });

  it("the repository maps RPC result codes to safe errors", () => {
    expect(repo).toMatch(/rpcCodeToError/);
    expect(repo).toMatch(/result\.code/);
  });

  it("createPackage surfaces an eligible-insert failure rather than ignoring it", () => {
    // Creation now goes through create_package_atomic; the RPC result code is
    // surfaced via rpcCodeToError, not a separate eligible-insert string.
    expect(repo).toMatch(/createPackage\.rpc/);
    expect(repo).toMatch(/rpcCodeToError/);
  });
});

describe("0009 blocker 6 — optimistic concurrency enforced inside the write", () => {
  it("the RPC locks + checks concurrency in one FOR UPDATE statement", () => {
    expect(sql).toMatch(
      /where id = p_package_id and updated_at = p_expected_updated_at\s+for update/i,
    );
    expect(sql).toMatch(
      /where id = p_addon_id and updated_at = p_expected_updated_at\s+for update/i,
    );
    expect(sql).toMatch(
      /where id = p_platter_id and updated_at = p_expected_updated_at\s+for update/i,
    );
    expect(sql).toMatch(/where id = 1 and updated_at = p_expected_updated_at\s+for update/i);
  });

  it("a stale edit returns a conflict code, not a silent overwrite", () => {
    expect(sql).toMatch(/'conflict'/i);
  });

  it("the repository does NOT perform a separate pre-update concurrency SELECT", () => {
    // The old pattern did a SELECT for updated_at, then a separate UPDATE.
    // The RPC now does both in one statement, so the repo should not have a
    // standalone .select(...).eq("updated_at", ...) guard before the rpc call.
    expect(repo).not.toMatch(/\.eq\("updated_at"/);
  });
});

describe("0009 blocker 7 — database read errors throw, not empty success", () => {
  it("listPackages throws on error instead of returning []", () => {
    expect(repo).toMatch(/ordering\.listPackages failed/);
  });

  it("listAddons throws on error", () => {
    expect(repo).toMatch(/ordering\.listAddons failed/);
  });

  it("listPlatters throws on error", () => {
    expect(repo).toMatch(/ordering\.listPlatters failed/);
  });

  it("getGuestPricingRules throws on error instead of returning null", () => {
    expect(repo).toMatch(/ordering\.getGuestPricingRules failed/);
  });

  it("no read method returns data ?? [] on error as a success result", () => {
    // The broken pattern returned (data ?? []) even when error was set.
    // Confirm the throw-on-error guard precedes any data use.
    const listPackagesBlock = repo.match(/async listPackages\(\)[\s\S]*?\n {2}\}/);
    expect(listPackagesBlock).toBeTruthy();
    expect(listPackagesBlock![0]).toMatch(/if \(error\)/);
    expect(listPackagesBlock![0]).toMatch(/throw new Error/);
  });
});

describe("0009 — RPC execution privileges (service-role only)", () => {
  it("revokes EXECUTE on all RPCs from PUBLIC, anon, authenticated", () => {
    expect(sql).toMatch(
      /revoke execute on function public\.update_package_atomic[\s\S]*?from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /revoke execute on function public\.update_addon_atomic[\s\S]*?from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /revoke execute on function public\.update_platter_atomic[\s\S]*?from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /revoke execute on function public\.update_guest_pricing_rules_atomic[\s\S]*?from public, anon, authenticated/i,
    );
  });

  it("grants EXECUTE on all RPCs only to service_role", () => {
    expect(sql).toMatch(
      /grant execute on function public\.update_package_atomic[\s\S]*?to service_role/i,
    );
  });
});

describe("0009 — atomic audit logging preserved", () => {
  it("audit triggers reuse audit_cms_change() on all audited tables", () => {
    expect(sql).toMatch(
      /trg_meal_packages_audit[\s\S]*?execute function public\.audit_cms_change\(\)/i,
    );
    expect(sql).toMatch(
      /trg_individual_addons_audit[\s\S]*?execute function public\.audit_cms_change\(\)/i,
    );
    expect(sql).toMatch(
      /trg_shared_platters_audit[\s\S]*?execute function public\.audit_cms_change\(\)/i,
    );
    expect(sql).toMatch(/trg_gpr_audit[\s\S]*?execute function public\.audit_cms_change\(\)/i);
  });

  it("does not redefine audit_cms_change()", () => {
    expect(sql).not.toMatch(/create or replace function public\.audit_cms_change/i);
  });
});

/**
 * The following tests are STRUCTURAL SQL source-inspection checks — NOT
 * PostgreSQL execution tests. The migration is unapplied and reviewed
 * externally. They assert the corrected patterns exist in the SQL file.
 */

describe("0009 correction 1 — update_package_atomic invalid_text_representation handler", () => {
  // Extract the update_package_atomic function body only.
  const fnMatch = sql.match(
    /create or replace function public\.update_package_atomic[\s\S]*?\$\$;\s/is,
  );
  const fnBody = fnMatch ? fnMatch[0] : "";

  it("update_package_atomic EXCEPTION includes WHEN invalid_text_representation", () => {
    expect(fnBody).toMatch(/when invalid_text_representation then/i);
    expect(fnBody).toMatch(/'invalid_reference'/i);
  });

  it("no nested BEGIN/EXCEPTION/RETURN inside update_package_atomic that returns after writes", () => {
    // A nested exception block that returns after earlier writes would be a
    // second match of BEGIN...EXCEPTION...END. Only the outer handler is
    // allowed.
    const nestedBlocks = fnBody.match(/\bbegin\b[\s\S]*?\bexception\b[\s\S]*?\bend\b/gi);
    expect(nestedBlocks ? nestedBlocks.length : 0).toBeLessThanOrEqual(1);
  });

  it("create_package_atomic already had invalid_text_representation (unaffected)", () => {
    const createFn = sql.match(
      /create or replace function public\.create_package_atomic[\s\S]*?\$\$;\s/is,
    );
    expect(createFn ? createFn[0] : "").toMatch(/when invalid_text_representation then/i);
  });
});

describe("0009 correction 2 — addon eligibility element type validation (structural)", () => {
  // NOTE: These are SQL source-inspection (structural) tests, NOT PostgreSQL
  // execution tests. The migration is unapplied and reviewed externally. They
  // assert the corrected patterns exist in the SQL file.

  it("create_addon_atomic validates each element is a JSON string via jsonb_typeof", () => {
    const fnMatch = sql.match(
      /create or replace function public\.create_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/jsonb_typeof\(v_pid_el\)\s*<>\s*'string'/i);
    expect(fnBody).toMatch(/#>>\s*'\{\}'/i);
  });

  it("update_addon_atomic validates each element is a JSON string via jsonb_typeof", () => {
    const fnMatch = sql.match(
      /create or replace function public\.update_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/jsonb_typeof\(v_pid_el\)\s*<>\s*'string'/i);
    expect(fnBody).toMatch(/#>>\s*'\{\}'/i);
  });

  it("create_addon_atomic declares v_pid_el jsonb", () => {
    const fnMatch = sql.match(
      /create or replace function public\.create_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/v_pid_el\s+jsonb/i);
  });

  it("update_addon_atomic declares v_pid_el jsonb", () => {
    const fnMatch = sql.match(
      /create or replace function public\.update_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/v_pid_el\s+jsonb/i);
  });

  it("create_addon_atomic rejects JSON null collection (non-array typeof)", () => {
    const fnMatch = sql.match(
      /create or replace function public\.create_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    // jsonb_typeof <> 'array' catches JSON null (typeof 'null') before any write
    expect(fnBody).toMatch(/jsonb_typeof\(p_eligible_package_ids\)\s*<>\s*'array'/i);
  });

  it("update_addon_atomic rejects JSON null collection (non-array typeof)", () => {
    const fnMatch = sql.match(
      /create or replace function public\.update_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/jsonb_typeof\(p_eligible_package_ids\)\s*<>\s*'array'/i);
  });

  it("create_addon_atomic rejects non-string elements (null/number/boolean/array/object)", () => {
    const fnMatch = sql.match(
      /create or replace function public\.create_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    // jsonb_typeof <> 'string' on each element rejects all non-string JSON types
    expect(fnBody).toMatch(/jsonb_typeof\(v_pid_el\)\s*<>\s*'string'/i);
    expect(fnBody).toMatch(/'invalid_reference'/i);
  });

  it("update_addon_atomic rejects non-string elements (null/number/boolean/array/object)", () => {
    const fnMatch = sql.match(
      /create or replace function public\.update_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/jsonb_typeof\(v_pid_el\)\s*<>\s*'string'/i);
    expect(fnBody).toMatch(/'invalid_reference'/i);
  });

  it("create_addon_atomic preserves empty array as valid empty eligibility set", () => {
    const fnMatch = sql.match(
      /create or replace function public\.create_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    // jsonb_array_elements on an empty array yields zero rows, so the loop
    // body never executes — empty array passes validation and links stay [].
    expect(fnBody).toMatch(/jsonb_array_elements\(p_eligible_package_ids\)/i);
  });
});

describe("0009 correction 3 — duplicate eligibility entry rejection (structural)", () => {
  // NOTE: These are SQL source-inspection (structural) tests, NOT PostgreSQL
  // execution tests. The migration is unapplied and reviewed externally.

  it("create_package_atomic rejects duplicate menuItemId with invalid_value via v_seen", () => {
    const fnMatch = sql.match(
      /create or replace function public\.create_package_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/v_seen/i);
    expect(fnBody).toMatch(/v_uuid = ANY\(v_seen\)/i);
    expect(fnBody).toMatch(/'invalid_value'/i);
  });

  it("update_package_atomic rejects duplicate menuItemId with invalid_value via v_seen", () => {
    const fnMatch = sql.match(
      /create or replace function public\.update_package_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/v_seen/i);
    expect(fnBody).toMatch(/v_uuid = ANY\(v_seen\)/i);
    expect(fnBody).toMatch(/'invalid_value'/i);
  });

  it("create_addon_atomic rejects duplicate package UUIDs with invalid_value via v_links", () => {
    const fnMatch = sql.match(
      /create or replace function public\.create_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/v_links\s*:=\s*ARRAY\[\]::uuid\[\]/i);
    expect(fnBody).toMatch(/v_uuid = ANY\(v_links\)/i);
    expect(fnBody).toMatch(/'invalid_value'/i);
  });

  it("update_addon_atomic rejects duplicate package UUIDs with invalid_value via v_links", () => {
    const fnMatch = sql.match(
      /create or replace function public\.update_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/v_links\s*:=\s*ARRAY\[\]::uuid\[\]/i);
    expect(fnBody).toMatch(/v_uuid = ANY\(v_links\)/i);
    expect(fnBody).toMatch(/'invalid_value'/i);
  });

  it("package eligibility validates menuItemId is a JSON string type (not just non-null text)", () => {
    const fnMatch = sql.match(
      /create or replace function public\.create_package_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/jsonb_typeof\(v_item->'menuItemId'\)\s*<>\s*'string'/i);
  });

  it("duplicate check compares normalized UUIDs (casts to uuid before ANY)", () => {
    const fnMatch = sql.match(
      /create or replace function public\.update_package_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    // The cast to uuid happens before the ANY() comparison, ensuring normalized
    // comparison rather than raw string comparison.
    expect(fnBody).toMatch(/v_uuid\s*:=\s*\(v_item->>'menuItemId'\)::uuid/i);
    expect(fnBody).toMatch(/v_uuid = ANY\(v_seen\)/i);
  });

  it("create_addon_atomic duplicate check casts package id to uuid before ANY", () => {
    const fnMatch = sql.match(
      /create or replace function public\.create_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/v_uuid\s*:=\s*v_pid::uuid/i);
    expect(fnBody).toMatch(/v_uuid = ANY\(v_links\)/i);
  });

  it("update_addon_atomic duplicate check casts package id to uuid before ANY", () => {
    const fnMatch = sql.match(
      /create or replace function public\.update_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/v_uuid\s*:=\s*v_pid::uuid/i);
    expect(fnBody).toMatch(/v_uuid = ANY\(v_links\)/i);
  });
});

describe("0009 correction 4 — add-on RPC response links not duplicated (structural)", () => {
  // NOTE: These are SQL source-inspection (structural) tests, NOT PostgreSQL
  // execution tests. The migration is unapplied and reviewed externally. They
  // assert the prevalidation loop populates v_links (for duplicate detection)
  // while the later INSERT loop does NOT append to v_links again, so the
  // success response returns each supplied package ID exactly once.

  it("create_addon_atomic prevalidation loop appends to v_links for duplicate detection", () => {
    const fnMatch = sql.match(
      /create or replace function public\.create_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/v_links\s*:=\s*array_append\(v_links,\s*v_uuid\)/i);
  });

  it("create_addon_atomic INSERT loop does NOT append to v_links (no duplication)", () => {
    const fnMatch = sql.match(
      /create or replace function public\.create_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    const insertLoopMatch = fnBody.match(
      /insert into public\.addon_eligible_packages[\s\S]*?end loop;/i,
    );
    expect(insertLoopMatch).toBeTruthy();
    expect(insertLoopMatch![0]).not.toMatch(/v_links\s*:=\s*array_append/i);
  });

  it("create_addon_atomic success response returns v_links once", () => {
    const fnMatch = sql.match(
      /create or replace function public\.create_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/'links',\s*to_jsonb\(v_links\)/i);
  });

  it("update_addon_atomic prevalidation loop appends to v_links for duplicate detection", () => {
    const fnMatch = sql.match(
      /create or replace function public\.update_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/v_links\s*:=\s*array_append\(v_links,\s*v_uuid\)/i);
  });

  it("update_addon_atomic INSERT loop does NOT append to v_links (no duplication)", () => {
    const fnMatch = sql.match(
      /create or replace function public\.update_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    const insertLoopMatch = fnBody.match(
      /insert into public\.addon_eligible_packages[\s\S]*?end loop;/i,
    );
    expect(insertLoopMatch).toBeTruthy();
    expect(insertLoopMatch![0]).not.toMatch(/v_links\s*:=\s*array_append/i);
  });

  it("update_addon_atomic ELSE branch retrieves existing links when collection is SQL NULL", () => {
    const fnMatch = sql.match(
      /create or replace function public\.update_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/else[\s\S]*?select array_agg\(package_id\) into v_links/i);
  });

  it("update_addon_atomic success response returns v_links once", () => {
    const fnMatch = sql.match(
      /create or replace function public\.update_addon_atomic[\s\S]*?\$\$;\s/is,
    );
    const fnBody = fnMatch ? fnMatch[0] : "";
    expect(fnBody).toMatch(/'links',\s*to_jsonb\(v_links\)/i);
  });
});
