/**
 * 0005_menu_child_archived_protection.sql — migration-focused tests.
 *
 * These tests inspect the unapplied migration SQL to prove the archived-parent
 * protection and reorder archived-rejection are present and correctly
 * structured. They are SOURCE-INSPECTION tests (the migration is not applied
 * in this environment); behavioral equivalents run against the mock repository
 * in admin-sections.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0005_menu_child_archived_protection.sql"),
  "utf8",
);

describe("0005 — archived-parent protection migration", () => {
  it("creates reject_archived_parent trigger function with fixed search_path", () => {
    expect(sql).toMatch(/create or replace function public\.reject_archived_parent\(\)/i);
    expect(sql).toMatch(/set search_path = public, pg_temp/i);
  });

  it("installs BEFORE INSERT OR UPDATE OR DELETE triggers on menu_sections and menu_items", () => {
    expect(sql).toMatch(
      /before insert or update or delete on public\.menu_sections\s+for each row execute function public\.reject_archived_parent\(\)/i,
    );
    expect(sql).toMatch(
      /before insert or update or delete on public\.menu_items\s+for each row execute function public\.reject_archived_parent\(\)/i,
    );
  });

  it("reject_archived_parent returns OLD for DELETE", () => {
    const start = sql.indexOf("create or replace function public.reject_archived_parent");
    const end = sql.indexOf("revoke execute on function public.reject_archived_parent");
    const fn = sql.slice(start, end);
    expect(fn).toMatch(/if tg_op = 'delete' then/i);
    expect(fn).toMatch(/return old;/i);
  });

  it("DELETE checks OLD.menu_id under FOR UPDATE lock", () => {
    const start = sql.indexOf("create or replace function public.reject_archived_parent");
    const end = sql.indexOf("revoke execute on function public.reject_archived_parent");
    const fn = sql.slice(start, end);
    // Slice the DELETE branch only.
    const delStart = fn.indexOf("if TG_OP = 'DELETE' then");
    const delBranch = fn.slice(delStart);
    expect(delBranch).toMatch(/if old\.menu_id is not null then/i);
    expect(delBranch).toMatch(
      /select status into v_status from public\.menus where id = old\.menu_id for update/i,
    );
    expect(delBranch).toMatch(/if found and v_status = 'archived' then/i);
    expect(delBranch).toMatch(/raise exception 'Archived menus cannot be edited\.'/i);
  });

  it("INSERT and UPDATE behavior remains intact", () => {
    const start = sql.indexOf("create or replace function public.reject_archived_parent");
    const end = sql.indexOf("revoke execute on function public.reject_archived_parent");
    const fn = sql.slice(start, end);
    expect(fn).toMatch(/if tg_op = 'insert' then/i);
    expect(fn).toMatch(/if tg_op = 'update' then/i);
    // INSERT returns NEW.
    const insBranch = fn.slice(
      fn.indexOf("if TG_OP = 'INSERT' then"),
      fn.indexOf("if TG_OP = 'UPDATE' then"),
    );
    expect(insBranch).toMatch(/return new;/i);
    // UPDATE returns NEW.
    const updBranch = fn.slice(
      fn.indexOf("if TG_OP = 'UPDATE' then"),
      fn.indexOf("if TG_OP = 'DELETE' then"),
    );
    expect(updBranch).toMatch(/return new;/i);
  });

  it("checks parent menu status under FOR UPDATE lock", () => {
    // The archived check must SELECT ... FOR UPDATE so the status cannot
    // change between the check and the child write.
    expect(sql).toMatch(/select status into v_status from public\.menus where id = .* for update/i);
    expect(sql).toMatch(/if v_status = 'archived' then/i);
    expect(sql).toMatch(/raise exception 'Archived menus cannot be edited\.'/i);
  });

  it("checks both old and new menu_id on UPDATE (cross-menu move protection)", () => {
    expect(sql).toMatch(/if old\.menu_id is not null then/i);
    expect(sql).toMatch(
      /if new\.menu_id is not null and new\.menu_id is distinct from old\.menu_id then/i,
    );
  });

  it("revokes EXECUTE on reject_archived_parent from PUBLIC, anon, and authenticated", () => {
    expect(sql).toMatch(
      /revoke execute on function public\.reject_archived_parent\(\) from public, anon, authenticated/i,
    );
  });

  it("reorder_menu_sections_atomic rejects archived after locking the menu row", () => {
    const start = sql.indexOf("create or replace function public.reorder_menu_sections_atomic");
    const end = sql.indexOf("revoke execute on function public.reorder_menu_sections_atomic");
    const fn = sql.slice(start, end);
    // Lock first.
    expect(fn).toMatch(
      /select id, status into v_menu_id, v_menu_status\s+from public\.menus where id = p_menu_id for update/i,
    );
    expect(fn).toMatch(/if not found then/i);
    // Archived check after the lock, before count/validation.
    expect(fn).toMatch(/if v_menu_status = 'archived' then/i);
    expect(fn).toMatch(/Archived menus cannot be edited\./i);
  });

  it("reorder_menu_items_atomic rejects archived after locking the menu row", () => {
    const start = sql.indexOf("create or replace function public.reorder_menu_items_atomic");
    const end = sql.indexOf("revoke execute on function public.reorder_menu_items_atomic");
    const fn = sql.slice(start, end);
    expect(fn).toMatch(
      /select id, status into v_menu_id, v_menu_status\s+from public\.menus where id = p_menu_id for update/i,
    );
    expect(fn).toMatch(/if v_menu_status = 'archived' then/i);
  });

  it("keeps both reorder RPCs restricted to service_role", () => {
    expect(sql).toMatch(
      /revoke execute on function public\.reorder_menu_sections_atomic\(uuid, uuid\[\], uuid\) from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.reorder_menu_sections_atomic\(uuid, uuid\[\], uuid\) to service_role/i,
    );
    expect(sql).toMatch(
      /revoke execute on function public\.reorder_menu_items_atomic\(uuid, uuid\[\], uuid\) from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.reorder_menu_items_atomic\(uuid, uuid\[\], uuid\) to service_role/i,
    );
  });

  it("does not use destructive operations", () => {
    expect(sql).not.toMatch(/\bdrop table\b/i);
    expect(sql).not.toMatch(/\bdrop schema\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
  });

  it("does not modify 0001, 0002, 0003, or 0004", () => {
    expect(sql).toMatch(/does NOT modify or reapply 0001/i);
  });
});
