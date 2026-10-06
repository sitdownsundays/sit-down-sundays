import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL_PATH = resolve("supabase/migrations/0010_sundays_seating_payment.sql");
const sql = readFileSync(SQL_PATH, "utf8");

describe("0010_sundays_seating_payment migration — structure", () => {
  it("creates the three required tables", () => {
    expect(sql).toMatch(/create table if not exists public\.sunday_services/i);
    expect(sql).toMatch(/create table if not exists public\.seating_times/i);
    expect(sql).toMatch(/create table if not exists public\.payment_policy/i);
  });

  it("sunday_services references venue_spaces (0008)", () => {
    expect(sql).toMatch(/space_id\s+uuid not null references public\.venue_spaces\(id\)/i);
  });

  it("seating_times references sunday_services with cascade", () => {
    expect(sql).toMatch(
      /sunday_service_id\s+uuid not null references public\.sunday_services\(id\)\s+on delete cascade/i,
    );
  });

  it("enforces the service window constraints (noon–7 PM, latest start 4:30)", () => {
    expect(sql).toMatch(/check_seating_times_start_at_or_after_noon/i);
    expect(sql).toMatch(/start_time >= '12:00'/i);
    expect(sql).toMatch(/check_seating_times_latest_start/i);
    expect(sql).toMatch(/start_time <= '16:30'/i);
    expect(sql).toMatch(/check_seating_times_end_within_window/i);
    expect(sql).toMatch(/end_time <= '19:00'/i);
    expect(sql).toMatch(/check_seating_times_end_after_start/i);
    expect(sql).toMatch(/end_time > start_time/i);
  });

  it("validates HH:MM time format", () => {
    expect(sql).toMatch(/check_seating_times_start_time_format/i);
    expect(sql).toMatch(/check_seating_times_end_time_format/i);
  });

  it("constrains sunday_services status to supported values", () => {
    expect(sql).toMatch(/status in \('scheduled', 'open', 'sold_out', 'closed'\)/i);
  });

  it("keeps online_booking_limit separate from capacity (nullable, non-negative)", () => {
    expect(sql).toMatch(/check_sunday_services_online_booking_limit/i);
    expect(sql).toMatch(/check_seating_times_online_booking_limit/i);
    expect(sql).toMatch(/online_booking_limit is null or online_booking_limit >= 0/i);
  });

  it("payment_policy is a singleton (id = 1 only)", () => {
    expect(sql).toMatch(/payment_policy_single_row check \(id = 1\)/i);
  });

  it("payment_policy enforces deposit 0–100 and deadline hours 0–720", () => {
    expect(sql).toMatch(/check_payment_policy_deposit_percent/i);
    expect(sql).toMatch(/deposit_percent >= 0 and deposit_percent <= 100/i);
    expect(sql).toMatch(/check_payment_policy_deadline_hours/i);
    expect(sql).toMatch(
      /default_balance_deadline_hours >= 0 and default_balance_deadline_hours <= 720/i,
    );
  });

  it("seeds payment_policy with confirmed defaults (50% deposit, 72h deadline)", () => {
    expect(sql).toMatch(/insert into public\.payment_policy/i);
    // Seed includes actor columns (created_by/updated_by = NULL) added for the
    // audit trigger; the confirmed defaults are id=1, deposit 50, deadline 72.
    expect(sql).toMatch(/\(1,\s*50,\s*72,\s*null,\s*null,\s*null\)/i);
    expect(sql).toMatch(/on conflict \(id\) do nothing/i);
  });

  it("enables RLS on all three tables with no anon/authenticated policies", () => {
    expect(sql).toMatch(/alter table public\.sunday_services\s+enable row level security/i);
    expect(sql).toMatch(/alter table public\.seating_times\s+enable row level security/i);
    expect(sql).toMatch(/alter table public\.payment_policy\s+enable row level security/i);
    expect(sql).toMatch(/no select\/insert\/update\/delete policies for anon or authenticated/i);
  });

  it("revokes from public/anon/authenticated and grants service_role", () => {
    expect(sql).toMatch(
      /revoke all on table public\.sunday_services\s+from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /revoke all on table public\.seating_times\s+from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /revoke all on table public\.payment_policy\s+from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant select, insert, update on table public\.sunday_services to service_role/i,
    );
    expect(sql).toMatch(
      /grant select, insert, update on table public\.seating_times to service_role/i,
    );
    expect(sql).toMatch(
      /grant select, insert, update on table public\.payment_policy to service_role/i,
    );
  });

  it("reuses audit_cms_change() (0004) for atomic audit logging", () => {
    expect(sql).toMatch(/trg_sunday_services_audit/i);
    expect(sql).toMatch(/trg_seating_times_audit/i);
    expect(sql).toMatch(/trg_payment_policy_audit/i);
    expect(sql).toMatch(/execute function public\.audit_cms_change\(\)/i);
  });

  it("uses SECURITY INVOKER with fixed search_path on trigger functions", () => {
    expect(sql).toMatch(/security invoker/i);
    expect(sql).toMatch(/set search_path = public, pg_temp/i);
  });

  it("revokes trigger helper execute from public/anon/authenticated", () => {
    expect(sql).toMatch(
      /revoke execute on function public\.set_sundays_updated_at\(\)\s+from public, anon, authenticated/i,
    );
  });

  it("is wrapped in BEGIN/COMMIT", () => {
    // The migration has a leading comment block; BEGIN appears after it.
    expect(sql).toMatch(/\nBEGIN;\n/);
    expect(sql.trim().endsWith("COMMIT;")).toBe(true);
  });

  it("does not implement capacity enforcement (explicitly deferred)", () => {
    expect(sql).toMatch(/capacity — not enforced/i);
    expect(sql).toMatch(/no reservation table yet/i);
    expect(sql).toMatch(/overlapping starts are not independent/i);
  });

  it("does not modify or reapply 0001–0009 objects", () => {
    // Must not recreate venue_spaces, meal_packages, audit_logs, etc.
    expect(sql).not.toMatch(/create table if not exists public\.venue_spaces/i);
    expect(sql).not.toMatch(/create table if not exists public\.meal_packages/i);
    expect(sql).not.toMatch(/create table if not exists public\.audit_logs/i);
    expect(sql).not.toMatch(/create or replace function public\.audit_cms_change/i);
  });
});
