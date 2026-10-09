/**
 * Structural (source-inspection) regression tests for the four pre-application
 * corrections to the UNAPPLIED 0011_reservations.sql migration.
 *
 * These are NOT PostgreSQL execution tests. They verify that the migration SQL
 * source contains the corrected structures and contracts. They do NOT prove
 * runtime database behavior, transaction rollback, or concurrency semantics.
 * The owner must apply 0011 and run the separate manual verification script
 * for live PostgreSQL proof.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0011_reservations.sql"),
  "utf8",
);

describe("0011 correction 1 — unpaid initial financial values (structural)", () => {
  it("requires remaining_balance_cents to equal grand_total_cents for new submissions", () => {
    expect(sql).toContain("p_remaining_balance_cents <> p_grand_total_cents");
    expect(sql).toContain("'code', 'invalid_data'");
  });

  it("requires the deposit to be nonnegative and no greater than the total", () => {
    expect(sql).toContain("p_deposit_required_cents < 0");
    expect(sql).toContain("p_deposit_required_cents > p_grand_total_cents");
  });

  it("rejects null financial inputs", () => {
    expect(sql).toContain("p_grand_total_cents IS NULL");
    expect(sql).toContain("p_remaining_balance_cents IS NULL");
    expect(sql).toContain("p_deposit_required_cents IS NULL");
    expect(sql).toContain("p_subtotal_cents IS NULL");
  });

  it("hardcodes amount_paid_cents = 0 on insert (not the deposit)", () => {
    // The INSERT VALUES list uses a literal 0 for amount_paid_cents.
    expect(sql).toMatch(/0,\s*p_remaining_balance_cents/);
  });

  it("performs financial validation before any INSERT", () => {
    const finIdx = sql.indexOf("p_remaining_balance_cents <> p_grand_total_cents");
    const insertIdx = sql.indexOf("INSERT INTO public.reservations");
    expect(finIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(finIdx).toBeLessThan(insertIdx);
  });
});

describe("0011 correction 2 — guest payload validation before writes (structural)", () => {
  it("requires p_guests to be a JSON array, not SQL NULL or JSON null", () => {
    expect(sql).toContain("jsonb_typeof(p_guests) <> 'array'");
  });

  it("requires guest count to equal party size", () => {
    expect(sql).toContain("v_guest_count <> p_party_size");
  });

  it("validates unique guest indices covering 0..party_size-1", () => {
    expect(sql).toContain("v_idx < 0 OR v_idx >= p_party_size");
    expect(sql).toContain("v_seen @> ARRAY[v_idx]");
  });

  it("validates actual category counts match adults/seniors/children", () => {
    expect(sql).toContain("v_adult_count <> p_adults");
    expect(sql).toContain("v_senior_count <> p_seniors");
    expect(sql).toContain("v_child_count <> p_children");
  });

  it("rejects malformed guests with invalid_guests before writes", () => {
    expect(sql).toContain("'code', 'invalid_guests'");
  });

  it("has a UNIQUE(reservation_id, guest_index) constraint", () => {
    expect(sql).toContain("check_res_guests_reservation_guest_index_unique");
    expect(sql).toContain("UNIQUE (reservation_id, guest_index)");
  });

  it("has a nonnegative guest_index CHECK constraint", () => {
    expect(sql).toContain("check_res_guests_index_nonneg");
    expect(sql).toContain("guest_index >= 0");
  });

  it("performs guest validation before any INSERT", () => {
    const guestIdx = sql.indexOf("v_guest_count <> p_party_size");
    const insertIdx = sql.indexOf("INSERT INTO public.reservations");
    expect(guestIdx).toBeGreaterThan(-1);
    expect(guestIdx).toBeLessThan(insertIdx);
  });
});

describe("0011 correction 3 — return saved statuses on replay (structural)", () => {
  it("fetches saved status and payment_status in the initial idempotency lookup", () => {
    expect(sql).toContain("v_existing_status");
    expect(sql).toContain("v_existing_payment_status");
  });

  it("returns saved statuses (not hardcoded) in the initial replay branch", () => {
    // The replay object references v_existing_status / v_existing_payment_status
    expect(sql).toContain("'status', v_existing_status");
    expect(sql).toContain("'payment_status', v_existing_payment_status");
  });

  it("fetches saved statuses in the concurrent unique-violation replay branch", () => {
    // There must be at least two occurrences of the status fetch (initial + concurrent)
    const count = (sql.match(/v_existing_status, v_existing_payment_status/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("preserves changed-payload rejection (idempotency_key_mismatch)", () => {
    expect(sql).toContain("'code', 'idempotency_key_mismatch'");
  });

  it("performs replay lookup before new-submission validation", () => {
    const replayIdx = sql.indexOf("idempotent_replay");
    const finIdx = sql.indexOf("p_remaining_balance_cents <> p_grand_total_cents");
    expect(replayIdx).toBeGreaterThan(-1);
    expect(replayIdx).toBeLessThan(finIdx);
  });
});

describe("0011 correction 4 — append-only status history (structural)", () => {
  it("grants service_role only SELECT and INSERT on reservation_status_history", () => {
    expect(sql).toContain(
      "GRANT SELECT, INSERT ON TABLE public.reservation_status_history TO service_role",
    );
    // No UPDATE or DELETE grant on the history table. Check the specific grant
    // line does not include UPDATE/DELETE (avoid cross-line false positives).
    const grantLine = sql
      .split("\n")
      .find((l) => l.includes("GRANT") && l.includes("reservation_status_history"));
    expect(grantLine).toBeTruthy();
    expect(grantLine).not.toContain("UPDATE");
    expect(grantLine).not.toContain("DELETE");
  });

  it("has a trigger function blocking UPDATE and DELETE", () => {
    expect(sql).toContain("block_update_delete_reservation_status_history");
    expect(sql).toContain("BEFORE UPDATE ON public.reservation_status_history");
    expect(sql).toContain("BEFORE DELETE ON public.reservation_status_history");
  });

  it("revokes execute on the block function from PUBLIC, anon, authenticated", () => {
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.block_update_delete_reservation_status_history()",
    );
  });

  it("inserts the initial history row inside the atomic submission RPC", () => {
    expect(sql).toContain("INSERT INTO public.reservation_status_history");
  });
});

describe("0011 — atomic rollback boundary intact (structural)", () => {
  it("keeps all writes inside the EXCEPTION block", () => {
    // The EXCEPTION keyword must appear after the INSERT statements.
    const firstInsert = sql.indexOf("INSERT INTO public.reservations");
    const exceptionIdx = sql.indexOf("EXCEPTION", firstInsert);
    expect(exceptionIdx).toBeGreaterThan(firstInsert);
  });

  it("maps malformed UUIDs to invalid_reference via the enclosing handler", () => {
    expect(sql).toContain("WHEN invalid_text_representation THEN");
    expect(sql).toContain("'code', 'invalid_reference'");
  });
});
