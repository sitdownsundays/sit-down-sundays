import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(__dirname, "../../../supabase/migrations/0007_feast_offerings.sql");
const sql = readFileSync(migrationPath, "utf-8");

describe("0007_feast_offerings.sql migration structure", () => {
  it("creates an independent feast_offerings table (not menus columns)", () => {
    expect(sql).toMatch(/create table if not exists public\.feast_offerings/i);
    // It must NOT alter the existing menus table.
    expect(sql).not.toMatch(/alter table\s+public\.menus/i);
  });

  it("has the required display-only columns", () => {
    expect(sql).toMatch(/price_per_person_cents\s+integer/i);
    expect(sql).toMatch(/inclusions\s+text\[\]/i);
    expect(sql).toMatch(/cover_image_url\s+text/i);
    expect(sql).toMatch(/cover_image_alt\s+varchar\(300\)/i);
    expect(sql).toMatch(/is_published\s+boolean/i);
    expect(sql).toMatch(/display_order\s+integer/i);
  });

  it("references auth.users(id) for created_by and updated_by with ON DELETE SET NULL", () => {
    expect(sql).toMatch(/created_by\s+uuid references auth\.users\(id\) on delete set null/i);
    expect(sql).toMatch(/updated_by\s+uuid references auth\.users\(id\) on delete set null/i);
  });

  it("scopes every constraint-existence check to public.feast_offerings via conrelid", () => {
    const conrelidChecks = sql.match(/conrelid = 'public\.feast_offerings'::regclass/g);
    expect(conrelidChecks).not.toBeNull();
    // slug unique + slug format + price + display_order + cover-alt = 5 guards.
    expect(conrelidChecks!.length).toBeGreaterThanOrEqual(5);
  });

  it("enforces a unique slug", () => {
    expect(sql).toMatch(/feast_offerings_slug_key\s+unique\s+\(slug\)/i);
  });

  it("enforces the canonical slug format", () => {
    expect(sql).toMatch(/check_feast_offerings_slug_format/i);
    // The SQL regex literal: slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    expect(sql).toContain("slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'");
  });

  it("enforces a non-negative price ceiling within the shared safety bound", () => {
    expect(sql).toMatch(/check_feast_offerings_price_per_person_cents/i);
    expect(sql).toMatch(/price_per_person_cents\s*>=\s*0/i);
    expect(sql).toMatch(/price_per_person_cents\s*<=\s*1000000/i);
  });

  it("enforces the cover-image accessibility constraint", () => {
    expect(sql).toMatch(/check_feast_offerings_cover_image_alt_required/i);
    expect(sql).toMatch(/cover_image_alt is not null/i);
  });

  it("describes prices and inclusions as display-only, not booking rules", () => {
    expect(sql).toMatch(/DISPLAY-ONLY/i);
    expect(sql).toMatch(/calculate booking totals/i);
    expect(sql).toMatch(/not structured selection rules/i);
  });

  it("enables RLS and allows public reads of published rows only", () => {
    expect(sql).toMatch(/alter table public\.feast_offerings enable row level security/i);
    expect(sql).toMatch(/feast_offerings_public_read/i);
    expect(sql).toMatch(/using \(is_published = true\)/i);
  });

  it("defines no public INSERT/UPDATE/DELETE policies", () => {
    // No write policies for anon/authenticated.
    expect(sql).not.toMatch(/for insert\s+to anon/i);
    expect(sql).not.toMatch(/for update\s+to anon/i);
    expect(sql).not.toMatch(/for delete\s+to anon/i);
  });

  it("reuses the existing audit_cms_change trigger for atomic audit logging", () => {
    expect(sql).toMatch(/public\.audit_cms_change\(\)/i);
    expect(sql).toMatch(/after insert or update on public\.feast_offerings/i);
    // No application-level audit insert SQL in the migration.
    expect(sql).not.toMatch(/insert into public\.audit_logs/i);
  });

  it("reuses the existing audit_logs table without redefining it", () => {
    expect(sql).not.toMatch(/create table.*audit_logs/i);
  });

  it("uses a safe fixed search_path on the updated-at function", () => {
    expect(sql).toMatch(/set search_path = public, pg_temp/i);
  });

  it("revokes EXECUTE on trigger helpers from browser roles", () => {
    expect(sql).toMatch(/revoke execute on function public\.set_feast_offerings_updated_at\(\)/i);
    expect(sql).toMatch(/from public, anon, authenticated/i);
  });

  it("does not weaken the existing menu publishing rule", () => {
    // No menu_items seeding, no publish_menu_atomic changes, no fake dishes.
    expect(sql).not.toMatch(/insert into\s+public\.menu_items/i);
    expect(sql).not.toMatch(/create or replace function public\.publish_menu_atomic/i);
    // No triggers dropped from the existing menu tables.
    expect(sql).not.toMatch(/drop trigger if exists trg_menus_audit/i);
    expect(sql).not.toMatch(/drop trigger if exists trg_menu_sections_audit/i);
    expect(sql).not.toMatch(/drop trigger if exists trg_menu_items_audit/i);
  });

  it("does not apply destructive operations", () => {
    // No executable destructive statements (comments explaining their absence
    // are fine). Match lowercase SQL keywords at statement start.
    expect(sql).not.toMatch(/\bdrop table\b/i);
    expect(sql).not.toMatch(/\bdrop schema\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
    // No on delete cascade on feast_offerings foreign keys (only SET NULL).
    expect(sql).not.toMatch(/references auth\.users\(id\) on delete cascade/i);
  });

  it("sets explicit table privileges", () => {
    // Revoke all from PUBLIC, anon, authenticated (may span newlines).
    expect(sql).toMatch(
      /revoke all on table public\.feast_offerings\s+from public, anon, authenticated/i,
    );
    // Grant SELECT only to anon and authenticated.
    expect(sql).toMatch(/grant select on table public\.feast_offerings\s+to anon, authenticated/i);
    // Grant SELECT, INSERT, UPDATE to service_role.
    expect(sql).toMatch(
      /grant select, insert, update on table public\.feast_offerings\s+to service_role/i,
    );
  });

  it("does not grant DELETE to any role", () => {
    expect(sql).not.toMatch(/grant.*delete.*on table public\.feast_offerings/i);
  });

  it("wraps the migration in BEGIN/COMMIT for atomic application", () => {
    // BEGIN must appear before the first DDL statement; COMMIT must appear at
    // the end. There should be exactly one of each.
    const beginCount = (sql.match(/\bbegin\b/gi) || []).length;
    const commitCount = (sql.match(/\bcommit\b/gi) || []).length;
    expect(beginCount).toBeGreaterThanOrEqual(1);
    expect(commitCount).toBeGreaterThanOrEqual(1);
    // BEGIN appears before the table creation.
    const beginIdx = sql.search(/\bbegin\b/i);
    const createIdx = sql.search(/create table if not exists public\.feast_offerings/i);
    expect(beginIdx).toBeLessThan(createIdx);
    // COMMIT appears after the last statement (comments aside). Use
    // case-insensitive search since the reviewed SQL uses uppercase keywords.
    const lower = sql.toLowerCase();
    const commitIdx = lower.lastIndexOf("commit");
    const revokeIdx = lower.lastIndexOf(
      "revoke execute on function public.set_feast_offerings_updated_at",
    );
    expect(commitIdx).toBeGreaterThan(revokeIdx);
  });

  it("corrects the SECURITY INVOKER trigger comment", () => {
    // The updated-at helper is SECURITY INVOKER and runs with the invoking
    // role's privileges — NOT automatically the table owner's privileges.
    expect(sql).toMatch(/SECURITY INVOKER/i);
    expect(sql).toMatch(/invoking role's privileges/i);
    // It must NOT claim the INVOKER function runs with the table owner's
    // privileges.
    expect(sql).not.toMatch(/SECURITY INVOKER.*table owner's privileges/i);
  });
});
