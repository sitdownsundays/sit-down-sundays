-- ============================================================================
-- Sit Down Sundays — 0011_reservations.sql
-- ============================================================================
-- Reservation & Order Management foundation.
--
-- This migration is ADDITIVE. It creates the reservation model the customer
-- booking wizard and staff reservation screens depend on. It reuses existing
-- entities (sunday_services, seating_times, venue_spaces, meal_packages,
-- individual_addons, shared_platters, menu_items) rather than parallel tables.
--
-- It does NOT modify or reapply 0001–0010. It does NOT implement Stripe,
-- capacity enforcement, table assignment, email/SMS delivery, or automatic
-- confirmation. This phase only persists an UNPAID REQUEST that staff review.
--
-- KEY DESIGN RULES (per owner direction):
--   * A reservation is a REQUEST, not a guaranteed booking. The initial
--     status is 'pending_review' and payment status 'unpaid'. Staff confirm
--     later once capacity enforcement exists. The customer sees:
--     "Reservation request received — your booking is not yet confirmed."
--   * Snapshots are IMMUTABLE at submission: package name/price, item
--     name/price, addon name/price, and the payment-policy snapshot are
--     captured so later config changes never retroactively alter a booking.
--   * Idempotency: a client-supplied idempotency key + payload hash. Reusing
--     a key with the SAME hash returns the existing reservation. Reusing a
--     key with a DIFFERENT hash is rejected (no silent unrelated return).
--   * Contact details are private. No anonymous/authenticated direct table
--     access to reservation data. All reads/writes go through validated
--     server functions. Reservation numbers are NOT authorization tokens —
--     staff/admin access is gated by server-side role checks.
--   * Quantities are positive integers (CHECK > 0). References use FKs.
--   * Audit logging reuses public.audit_cms_change() (0004) → append-only
--     public.audit_logs (0001) in the SAME transaction. created_by on INSERT,
--     updated_by on UPDATE. Reservation submission by a public customer has
--     no authenticated actor, so created_by/updated_by are NULL (system) and
--     the audit trigger tolerates a NULL actor.
--
-- STATUS: DRAFT, NOT YET APPLIED.
-- Supabase should run this versioned migration exactly once, after
-- 0010_sundays_seating_payment.sql. Wrapped in BEGIN/COMMIT.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- reservations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reservations (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-readable, non-authoritative reservation number (NOT an auth token).
  reservation_number          varchar(40) NOT NULL,
  -- Optional authenticated customer association. NULL for guest checkouts.
  guest_owner_id              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Contact details (private — never exposed through public availability).
  contact_first_name          varchar(120) NOT NULL,
  contact_last_name           varchar(120) NOT NULL,
  contact_email               varchar(320) NOT NULL,
  contact_phone               varchar(40) NOT NULL,
  -- Service / seating association.
  sunday_service_id           uuid NOT NULL REFERENCES public.sunday_services(id) ON DELETE RESTRICT,
  seating_time_id             uuid NOT NULL REFERENCES public.seating_times(id) ON DELETE RESTRICT,
  -- Experience.
  experience_type             varchar(20) NOT NULL DEFAULT 'standard',
  private_room_id             uuid REFERENCES public.venue_spaces(id) ON DELETE SET NULL,
  -- Party composition.
  party_size                  integer NOT NULL,
  adults                      integer NOT NULL,
  seniors                     integer NOT NULL,
  children                    integer NOT NULL,
  -- Guest-facing notes.
  guest_notes                 text NOT NULL DEFAULT '',
  dietary_notes               text NOT NULL DEFAULT '',
  accessibility_requests      text NOT NULL DEFAULT '',
  occasion                    varchar(160) NOT NULL DEFAULT '',
  -- Staff-only notes (never returned to guests).
  internal_notes              text NOT NULL DEFAULT '',
  -- Lifecycle.
  status                      varchar(40) NOT NULL DEFAULT 'pending_review',
  payment_status              varchar(40) NOT NULL DEFAULT 'unpaid',
  -- Financial snapshot (integer cents). Recalculated server-side at submission.
  subtotal_cents              integer NOT NULL DEFAULT 0,
  deposit_required_cents      integer NOT NULL DEFAULT 0,
  grand_total_cents           integer NOT NULL DEFAULT 0,
  amount_paid_cents           integer NOT NULL DEFAULT 0,
  remaining_balance_cents     integer NOT NULL DEFAULT 0,
  balance_deadline            timestamptz,
  -- Immutable JSON snapshots (itemized order lines + agreed payment terms).
  pricing_snapshot            jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_snapshot             jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Idempotency.
  idempotency_key             varchar(120),
  payload_hash                varchar(120),
  -- Timestamps + audit actors.
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- reservation_guests — one row per guest: category, package, included selections
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reservation_guests (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id              uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  guest_index                 integer NOT NULL,
  guest_category              varchar(20) NOT NULL,
  guest_name                  varchar(160),
  -- Live reference for validation (kept); snapshots are immutable below.
  package_id                  uuid NOT NULL REFERENCES public.meal_packages(id) ON DELETE RESTRICT,
  package_name_snapshot       varchar(160) NOT NULL,
  package_price_snapshot      integer NOT NULL,
  -- Immutable included-selection snapshots: [{menuItemId, itemNameSnapshot, selectionCategory}]
  included_selections         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

-- One guest per index within a reservation (no duplicate guest_index).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_res_guests_reservation_guest_index_unique'
      AND conrelid = 'public.reservation_guests'::regclass
  ) THEN
    ALTER TABLE public.reservation_guests
      ADD CONSTRAINT check_res_guests_reservation_guest_index_unique
      UNIQUE (reservation_id, guest_index);
  END IF;
END $$;

-- guest_index is nonnegative (0-based index).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_res_guests_index_nonneg'
      AND conrelid = 'public.reservation_guests'::regclass
  ) THEN
    ALTER TABLE public.reservation_guests
      ADD CONSTRAINT check_res_guests_index_nonneg
      CHECK (guest_index >= 0);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- reservation_guest_addons — individual add-ons attached to one guest
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reservation_guest_addons (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_guest_id        uuid NOT NULL REFERENCES public.reservation_guests(id) ON DELETE CASCADE,
  addon_id                    uuid NOT NULL REFERENCES public.individual_addons(id) ON DELETE RESTRICT,
  addon_name_snapshot         varchar(160) NOT NULL,
  price_per_unit_snapshot     integer NOT NULL,
  quantity                    integer NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- reservation_platter_lines — shared platters (per platter, party-level)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reservation_platter_lines (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id              uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  platter_id                  uuid NOT NULL REFERENCES public.shared_platters(id) ON DELETE RESTRICT,
  platter_name_snapshot       varchar(160) NOT NULL,
  price_per_platter_snapshot  integer NOT NULL,
  quantity                    integer NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- reservation_status_history — append-only status transitions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reservation_status_history (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id              uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  previous_status             varchar(40),
  new_status                  varchar(40) NOT NULL,
  reason                      text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- Constraints — reservations
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_reservations_reservation_number_unique'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT check_reservations_reservation_number_unique UNIQUE (reservation_number);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_reservations_idempotency_key_unique'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT check_reservations_idempotency_key_unique UNIQUE (idempotency_key);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_reservations_party_positive'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT check_reservations_party_positive CHECK (party_size > 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_reservations_composition_nonneg'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT check_reservations_composition_nonneg
      CHECK (adults >= 0 AND seniors >= 0 AND children >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_reservations_composition_sum'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT check_reservations_composition_sum
      CHECK (adults + seniors + children = party_size);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_reservations_amounts_nonneg'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT check_reservations_amounts_nonneg
      CHECK (
        subtotal_cents >= 0 AND deposit_required_cents >= 0
        AND grand_total_cents >= 0 AND amount_paid_cents >= 0
        AND remaining_balance_cents >= 0
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_reservations_experience_type'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT check_reservations_experience_type
      CHECK (experience_type IN ('standard', 'private_room'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_reservations_status'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT check_reservations_status
      CHECK (status IN (
        'pending_review', 'confirmed', 'balance_due', 'paid_in_full',
        'ready_for_service', 'checked_in', 'seated', 'completed',
        'transfer_requested', 'cancellation_requested', 'cancelled',
        'no_show', 'refund_review'
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_reservations_payment_status'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT check_reservations_payment_status
      CHECK (payment_status IN (
        'unpaid', 'deposit_pending', 'deposit_paid', 'partially_paid',
        'balance_due', 'paid_in_full', 'partially_refunded', 'refunded',
        'payment_failed', 'disputed'
      ));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Constraints — reservation_guests / addons / platter lines / history
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_res_guests_category'
      AND conrelid = 'public.reservation_guests'::regclass
  ) THEN
    ALTER TABLE public.reservation_guests
      ADD CONSTRAINT check_res_guests_category
      CHECK (guest_category IN ('adult', 'senior', 'child'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_res_guests_price_nonneg'
      AND conrelid = 'public.reservation_guests'::regclass
  ) THEN
    ALTER TABLE public.reservation_guests
      ADD CONSTRAINT check_res_guests_price_nonneg
      CHECK (package_price_snapshot >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_res_guest_addons_qty'
      AND conrelid = 'public.reservation_guest_addons'::regclass
  ) THEN
    ALTER TABLE public.reservation_guest_addons
      ADD CONSTRAINT check_res_guest_addons_qty
      CHECK (quantity > 0 AND price_per_unit_snapshot >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_res_platter_lines_qty'
      AND conrelid = 'public.reservation_platter_lines'::regclass
  ) THEN
    ALTER TABLE public.reservation_platter_lines
      ADD CONSTRAINT check_res_platter_lines_qty
      CHECK (quantity > 0 AND price_per_platter_snapshot >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_res_status_history_new_status'
      AND conrelid = 'public.reservation_status_history'::regclass
  ) THEN
    ALTER TABLE public.reservation_status_history
      ADD CONSTRAINT check_res_status_history_new_status
      CHECK (new_status IN (
        'pending_review', 'confirmed', 'balance_due', 'paid_in_full',
        'ready_for_service', 'checked_in', 'seated', 'completed',
        'transfer_requested', 'cancellation_requested', 'cancelled',
        'no_show', 'refund_review'
      ));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_res_status_history_prev'
      AND conrelid = 'public.reservation_status_history'::regclass
  ) THEN
    ALTER TABLE public.reservation_status_history
      ADD CONSTRAINT check_res_status_history_prev
      CHECK (previous_status IS NULL OR previous_status IN (
        'pending_review', 'confirmed', 'balance_due', 'paid_in_full',
        'ready_for_service', 'checked_in', 'seated', 'completed',
        'transfer_requested', 'cancellation_requested', 'cancelled',
        'no_show', 'refund_review'
      ));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_reservations_service
  ON public.reservations (sunday_service_id);
CREATE INDEX IF NOT EXISTS idx_reservations_seating
  ON public.reservations (seating_time_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status
  ON public.reservations (status);
CREATE INDEX IF NOT EXISTS idx_reservations_payment_status
  ON public.reservations (payment_status);
CREATE INDEX IF NOT EXISTS idx_reservations_created_at
  ON public.reservations (created_at);
CREATE INDEX IF NOT EXISTS idx_reservations_contact_email
  ON public.reservations (contact_email);
CREATE INDEX IF NOT EXISTS idx_reservation_guests_reservation
  ON public.reservation_guests (reservation_id);
CREATE INDEX IF NOT EXISTS idx_reservation_platters_reservation
  ON public.reservation_platter_lines (reservation_id);
CREATE INDEX IF NOT EXISTS idx_reservation_status_history_reservation
  ON public.reservation_status_history (reservation_id);

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
-- SECURITY INVOKER: runs with the invoking statement's role's privileges,
-- NOT automatically the table owner's privileges.
CREATE OR REPLACE FUNCTION public.set_reservations_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reservations_updated_at ON public.reservations;
CREATE TRIGGER trg_reservations_updated_at
  BEFORE UPDATE ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_reservations_updated_at();

-- ----------------------------------------------------------------------------
-- Audit logging triggers (reuse shared audit_cms_change from 0004)
-- ----------------------------------------------------------------------------
-- Audit reservation INSERT and UPDATE in the same transaction as the
-- mutation. Actor comes from created_by (INSERT) / updated_by (UPDATE).
-- Only safe old/new row JSON is recorded; these columns contain no secrets.
-- If the audit insert fails, the transaction (including the mutation) rolls
-- back. CREATE OR REPLACE FUNCTION preserves existing ownership/privileges.
DROP TRIGGER IF EXISTS trg_reservations_audit ON public.reservations;
CREATE TRIGGER trg_reservations_audit
  AFTER INSERT OR UPDATE ON public.reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_cms_change();

-- ----------------------------------------------------------------------------
-- Append-only protection for reservation_status_history
-- ----------------------------------------------------------------------------
-- reservation_status_history must never be UPDATEd or DELETEd. service_role is
-- granted only SELECT + INSERT above; this trigger is defense-in-depth so that
-- even a future privilege widening cannot mutate history. Consistent with the
-- existing audit_logs append-only pattern. SECURITY INVOKER runs with the
-- invoking statement's role's privileges, NOT the table owner's automatically.
CREATE OR REPLACE FUNCTION public.block_update_delete_reservation_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'reservation_status_history is append-only: UPDATE and DELETE are not permitted.'
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_res_status_history_block_update
  ON public.reservation_status_history;
CREATE TRIGGER trg_res_status_history_block_update
  BEFORE UPDATE ON public.reservation_status_history
  FOR EACH ROW
  EXECUTE FUNCTION public.block_update_delete_reservation_status_history();

DROP TRIGGER IF EXISTS trg_res_status_history_block_delete
  ON public.reservation_status_history;
CREATE TRIGGER trg_res_status_history_block_delete
  BEFORE DELETE ON public.reservation_status_history
  FOR EACH ROW
  EXECUTE FUNCTION public.block_update_delete_reservation_status_history();

REVOKE EXECUTE ON FUNCTION public.block_update_delete_reservation_status_history()
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Row-level security (private data — no public table access)
-- ----------------------------------------------------------------------------
-- Reservation data is PRIVATE. anon and authenticated get NO direct access.
-- All public submission and staff reads/writes go through validated server
-- functions using the service-role client (which bypasses RLS) AFTER the
-- caller's role is verified server-side. Reservation numbers are NOT
-- authorization tokens.
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_guest_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_platter_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_status_history ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE/DELETE policies for anon or authenticated.

-- ----------------------------------------------------------------------------
-- Explicit table privileges
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.reservations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.reservation_guests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.reservation_guest_addons FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.reservation_platter_lines FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.reservation_status_history FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE public.reservations FROM service_role;
REVOKE ALL ON TABLE public.reservation_guests FROM service_role;
REVOKE ALL ON TABLE public.reservation_guest_addons FROM service_role;
REVOKE ALL ON TABLE public.reservation_platter_lines FROM service_role;
REVOKE ALL ON TABLE public.reservation_status_history FROM service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.reservations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reservation_guests TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reservation_guest_addons TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reservation_platter_lines TO service_role;
-- reservation_status_history is APPEND-ONLY: service_role may SELECT and
-- INSERT, but NOT UPDATE or DELETE. Database-level protection below
-- (block_update_delete_reservation_status_history) additionally rejects
-- UPDATE/DELETE even if a future grant widens privileges, consistent with the
-- existing audit_logs append-only pattern.
GRANT SELECT, INSERT ON TABLE public.reservation_status_history TO service_role;

REVOKE EXECUTE ON FUNCTION public.set_reservations_updated_at()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_reservations_updated_at()
  TO service_role;

-- ----------------------------------------------------------------------------
-- Atomic reservation submission RPC
-- ----------------------------------------------------------------------------
-- Service-role only. Performs the ENTIRE reservation + order + history +
-- idempotency insert in ONE transaction. The application layer recalculates
-- the authoritative price and passes the validated snapshot; this RPC
-- validates that referenced entities still exist and are active, enforces
-- idempotency, and writes everything atomically. A failed child write or
-- audit row rolls back the whole reservation.
--
-- Idempotency rules:
--   * p_idempotency_key may be NULL (no idempotency, always insert).
--   * If the key exists with the SAME payload_hash → return the existing
--     reservation (neutral success, no duplicate).
--   * If the key exists with a DIFFERENT payload_hash → reject
--     (idempotency_key_mismatch). Never silently return an unrelated reservation.
--
-- Revoke execution from PUBLIC, anon, authenticated; grant only service_role.
CREATE OR REPLACE FUNCTION public.submit_reservation_request_atomic(
  p_reservation_number     varchar,
  p_contact_first_name     varchar,
  p_contact_last_name      varchar,
  p_contact_email          varchar,
  p_contact_phone          varchar,
  p_sunday_service_id      uuid,
  p_seating_time_id        uuid,
  p_experience_type        varchar,
  p_private_room_id        uuid,
  p_party_size             integer,
  p_adults                 integer,
  p_seniors                integer,
  p_children               integer,
  p_guest_notes            text,
  p_dietary_notes          text,
  p_accessibility_requests text,
  p_occasion               varchar,
  p_subtotal_cents         integer,
  p_deposit_required_cents integer,
  p_grand_total_cents      integer,
  p_remaining_balance_cents integer,
  p_balance_deadline       timestamptz,
  p_pricing_snapshot       jsonb,
  p_policy_snapshot        jsonb,
  p_guests                 jsonb,   -- [{guestIndex,category,name,packageId,packageName,packagePrice,included:[{menuItemId,name,category}],addons:[{addonId,name,price,quantity}]}]
  p_platters               jsonb,   -- [{platterId,name,price,quantity}]
  p_idempotency_key        varchar,
  p_payload_hash           varchar,
  p_actor_user_id          uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reservation_id   uuid;
  v_guest           jsonb;
  v_guest_id        uuid;
  v_addon          jsonb;
  v_platter        jsonb;
  v_existing_id              uuid;
  v_existing_reservation_number varchar;
  v_existing_hash            varchar;
  v_existing_status          varchar;
  v_existing_payment_status  varchar;
  v_service_exists boolean;
  v_seating_exists boolean;
  v_guest_count int;
  v_idx int;
  v_g jsonb;
  v_seen int[];
  v_adult_count int;
  v_senior_count int;
  v_child_count int;
  v_cat varchar;
BEGIN
  -- Idempotency check (only when a key is supplied). Done BEFORE any
  -- validation of new-submission inputs so a replay of an already-saved
  -- request still succeeds even if its seating/configuration later became
  -- unavailable. We return the SAVED status/payment_status, never hardcoded.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, reservation_number, payload_hash, status, payment_status
      INTO v_existing_id, v_existing_reservation_number, v_existing_hash,
           v_existing_status, v_existing_payment_status
      FROM public.reservations
      WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_existing_hash = p_payload_hash THEN
        -- Same key, same payload → return the ORIGINAL saved reservation
        -- identity AND its saved statuses (not hardcoded pending_review/unpaid).
        RETURN jsonb_build_object(
          'ok', true,
          'reservation_id', v_existing_id,
          'reservation_number', v_existing_reservation_number,
          'status', v_existing_status,
          'payment_status', v_existing_payment_status,
          'idempotent_replay', true
        );
      ELSE
        -- Same key, different payload → reject. Never return an unrelated reservation.
        RETURN jsonb_build_object('ok', false, 'code', 'idempotency_key_mismatch');
      END IF;
    END IF;
  END IF;

  -- ----------------------------------------------------------------------
  -- NEW-submission validation (all before any write).
  -- ----------------------------------------------------------------------

  -- Financial inputs must be present and valid for an unpaid new request.
  IF p_grand_total_cents IS NULL
     OR p_remaining_balance_cents IS NULL
     OR p_deposit_required_cents IS NULL
     OR p_subtotal_cents IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_data');
  END IF;
  -- For a NEW unpaid submission, the outstanding balance equals the full
  -- grand total (nothing has been paid). The required deposit is separate
  -- and must NOT be counted as received money.
  IF p_remaining_balance_cents <> p_grand_total_cents THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_data');
  END IF;
  -- Required deposit is nonnegative and no greater than the total.
  IF p_deposit_required_cents < 0 OR p_deposit_required_cents > p_grand_total_cents THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_data');
  END IF;
  IF p_subtotal_cents < 0 OR p_grand_total_cents < 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_data');
  END IF;

  -- Validate the guest payload BEFORE any writes.
  -- p_guests must be a JSON array (not SQL NULL, not JSON null, not an object).
  IF p_guests IS NULL OR jsonb_typeof(p_guests) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_guests');
  END IF;
  v_guest_count := jsonb_array_length(p_guests);
  -- Guest count must equal party size.
  IF v_guest_count <> p_party_size THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_guests');
  END IF;
  -- Guest indices must be unique integers covering 0..party_size-1, and
  -- actual category counts must match p_adults/p_seniors/p_children.
  v_seen := ARRAY[]::int[];
  v_adult_count := 0;
  v_senior_count := 0;
  v_child_count := 0;
  FOR v_idx IN 0..v_guest_count - 1 LOOP
    v_g := p_guests->v_idx;
    IF v_g IS NULL
       OR (v_g->>'guestIndex') IS NULL
       OR (v_g->>'category') IS NULL
       OR (v_g->>'packageId') IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_guests');
    END IF;
    -- guestIndex must be an integer in 0..party_size-1.
    BEGIN
      v_idx := (v_g->>'guestIndex')::int;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_guests');
    END;
    IF v_idx < 0 OR v_idx >= p_party_size THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_guests');
    END IF;
    -- Unique index.
    IF v_seen @> ARRAY[v_idx] THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_guests');
    END IF;
    v_seen := array_append(v_seen, v_idx);
    -- Tally categories.
    v_cat := v_g->>'category';
    IF v_cat = 'adult' THEN
      v_adult_count := v_adult_count + 1;
    ELSIF v_cat = 'senior' THEN
      v_senior_count := v_senior_count + 1;
    ELSIF v_cat = 'child' THEN
      v_child_count := v_child_count + 1;
    ELSE
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_guests');
    END IF;
  END LOOP;
  IF v_adult_count <> p_adults
     OR v_senior_count <> p_seniors
     OR v_child_count <> p_children THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_guests');
  END IF;

  -- Validate referenced service + seating still exist and belong together.
  SELECT EXISTS(SELECT 1 FROM public.sunday_services WHERE id = p_sunday_service_id AND is_active = true)
    INTO v_service_exists;
  IF NOT v_service_exists THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_service');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.seating_times st
    WHERE st.id = p_seating_time_id
      AND st.sunday_service_id = p_sunday_service_id
      AND st.is_active = true
  ) INTO v_seating_exists;
  IF NOT v_seating_exists THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_seating');
  END IF;

  -- ----------------------------------------------------------------------
  -- Writes (all enclosed by the EXCEPTION block below for atomic rollback).
  -- ----------------------------------------------------------------------

  -- Insert the reservation (status pending_review, payment unpaid).
  -- created_by is the authenticated customer if present, else NULL (system).
  INSERT INTO public.reservations (
    reservation_number, guest_owner_id,
    contact_first_name, contact_last_name, contact_email, contact_phone,
    sunday_service_id, seating_time_id,
    experience_type, private_room_id,
    party_size, adults, seniors, children,
    guest_notes, dietary_notes, accessibility_requests, occasion,
    internal_notes,
    status, payment_status,
    subtotal_cents, deposit_required_cents, grand_total_cents,
    amount_paid_cents, remaining_balance_cents, balance_deadline,
    pricing_snapshot, policy_snapshot,
    idempotency_key, payload_hash,
    created_by, updated_by
  ) VALUES (
    p_reservation_number, p_actor_user_id,
    p_contact_first_name, p_contact_last_name, p_contact_email, p_contact_phone,
    p_sunday_service_id, p_seating_time_id,
    p_experience_type, p_private_room_id,
    p_party_size, p_adults, p_seniors, p_children,
    p_guest_notes, p_dietary_notes, p_accessibility_requests, p_occasion,
    '',
    'pending_review', 'unpaid',
    p_subtotal_cents, p_deposit_required_cents, p_grand_total_cents,
    0, p_remaining_balance_cents, p_balance_deadline,
    p_pricing_snapshot, p_policy_snapshot,
    p_idempotency_key, p_payload_hash,
    p_actor_user_id, p_actor_user_id
  )
  RETURNING id INTO v_reservation_id;

  -- Insert guests + their add-ons.
  FOR v_guest IN SELECT * FROM jsonb_array_elements(p_guests) LOOP
    INSERT INTO public.reservation_guests (
      reservation_id, guest_index, guest_category, guest_name,
      package_id, package_name_snapshot, package_price_snapshot,
      included_selections
    ) VALUES (
      v_reservation_id,
      (v_guest->>'guestIndex')::int,
      v_guest->>'category',
      NULLIF(v_guest->>'name', ''),
      (v_guest->>'packageId')::uuid,
      v_guest->>'packageName',
      (v_guest->>'packagePrice')::int,
      COALESCE(v_guest->'included', '[]'::jsonb)
    )
    RETURNING id INTO v_guest_id;

    IF v_guest ? 'addons' AND jsonb_typeof(v_guest->'addons') = 'array' THEN
      FOR v_addon IN SELECT * FROM jsonb_array_elements(v_guest->'addons') LOOP
        INSERT INTO public.reservation_guest_addons (
          reservation_guest_id, addon_id, addon_name_snapshot,
          price_per_unit_snapshot, quantity
        ) VALUES (
          v_guest_id,
          (v_addon->>'addonId')::uuid,
          v_addon->>'name',
          (v_addon->>'price')::int,
          (v_addon->>'quantity')::int
        );
      END LOOP;
    END IF;
  END LOOP;

  -- Insert shared platter lines.
  IF p_platters IS NOT NULL AND jsonb_typeof(p_platters) = 'array' THEN
    FOR v_platter IN SELECT * FROM jsonb_array_elements(p_platters) LOOP
      INSERT INTO public.reservation_platter_lines (
        reservation_id, platter_id, platter_name_snapshot,
        price_per_platter_snapshot, quantity
      ) VALUES (
        v_reservation_id,
        (v_platter->>'platterId')::uuid,
        v_platter->>'name',
        (v_platter->>'price')::int,
        (v_platter->>'quantity')::int
      );
    END LOOP;
  END IF;

  -- Insert initial status history row.
  INSERT INTO public.reservation_status_history (
    reservation_id, previous_status, new_status, reason, created_by
  ) VALUES (
    v_reservation_id, NULL, 'pending_review', 'Reservation request submitted.', p_actor_user_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'reservation_id', v_reservation_id,
    'reservation_number', p_reservation_number,
    'status', 'pending_review',
    'payment_status', 'unpaid'
  );
EXCEPTION
  -- Malformed UUID or invalid cast → roll back ALL writes, safe code.
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
  WHEN unique_violation THEN
    -- A concurrent same-key submission can race past the idempotency SELECT
    -- and hit the unique(idempotency_key) constraint. Re-fetch the saved row:
    -- a matching payload is a safe replay (NOT a duplicate_reservation error)
    -- returning the SAVED statuses, a different payload is
    -- idempotency_key_mismatch, and any unrelated unique violation (e.g.
    -- reservation_number collision) falls through to a safe duplicate code.
    -- This rolls back this transaction's partial writes before returning.
    IF p_idempotency_key IS NOT NULL THEN
      SELECT id, reservation_number, payload_hash, status, payment_status
        INTO v_existing_id, v_existing_reservation_number, v_existing_hash,
             v_existing_status, v_existing_payment_status
        FROM public.reservations
        WHERE idempotency_key = p_idempotency_key;
      IF FOUND THEN
        IF v_existing_hash = p_payload_hash THEN
          RETURN jsonb_build_object(
            'ok', true,
            'reservation_id', v_existing_id,
            'reservation_number', v_existing_reservation_number,
            'status', v_existing_status,
            'payment_status', v_existing_payment_status,
            'idempotent_replay', true
          );
        ELSE
          RETURN jsonb_build_object('ok', false, 'code', 'idempotency_key_mismatch');
        END IF;
      END IF;
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'duplicate_reservation');
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
  WHEN check_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_data');
  WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unexpected');
END;
$$;

REVOKE ALL ON FUNCTION public.submit_reservation_request_atomic(
  varchar, varchar, varchar, varchar, varchar, uuid, uuid, varchar, uuid,
  integer, integer, integer, integer, text, text, text, varchar,
  integer, integer, integer, integer, timestamptz, jsonb, jsonb,
  jsonb, jsonb, varchar, varchar, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_reservation_request_atomic(
  varchar, varchar, varchar, varchar, varchar, uuid, uuid, varchar, uuid,
  integer, integer, integer, integer, text, text, text, varchar,
  integer, integer, integer, integer, timestamptz, jsonb, jsonb,
  jsonb, jsonb, varchar, varchar, uuid
) TO service_role;

-- ----------------------------------------------------------------------------
-- Read views for staff list/detail (service_role only)
-- ----------------------------------------------------------------------------
-- These views join reservation + service/seating/space context so the
-- repository can read list and detail rows without exposing private data to
-- anon/authenticated (RLS enabled, no public policies). They are internal
-- presentation helpers over the SAME reservation data — not a separate store.
CREATE OR REPLACE VIEW public.reservation_list_view AS
SELECT
  r.id,
  r.reservation_number,
  r.status,
  r.payment_status,
  r.contact_first_name,
  r.contact_last_name,
  r.contact_email,
  r.party_size,
  s.date AS service_date,
  st.start_time AS seating_start_time,
  r.remaining_balance_cents,
  r.created_at,
  r.sunday_service_id,
  r.seating_time_id
FROM public.reservations r
LEFT JOIN public.sunday_services s ON s.id = r.sunday_service_id
LEFT JOIN public.seating_times st ON st.id = r.seating_time_id;

CREATE OR REPLACE VIEW public.reservation_detail_view AS
SELECT
  r.*,
  sp.name AS space_name,
  s.date AS service_date,
  st.start_time AS seating_start_time,
  st.end_time AS seating_end_time
FROM public.reservations r
LEFT JOIN public.sunday_services s ON s.id = r.sunday_service_id
LEFT JOIN public.seating_times st ON st.id = r.seating_time_id
LEFT JOIN public.venue_spaces sp ON sp.id = s.space_id;

REVOKE ALL ON public.reservation_list_view FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.reservation_detail_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.reservation_list_view TO service_role;
GRANT SELECT ON public.reservation_detail_view TO service_role;

-- ----------------------------------------------------------------------------
-- Documentation
-- ----------------------------------------------------------------------------
COMMENT ON TABLE public.reservations IS
  'Customer reservation REQUESTS. Status starts pending_review, payment unpaid. NOT a guaranteed booking — staff confirm later once capacity enforcement exists. Reservation numbers are not authorization tokens.';

COMMENT ON COLUMN public.reservations.pricing_snapshot IS
  'Immutable itemized order snapshot recalculated server-side at submission. Later config changes never retroactively alter this booking.';

COMMENT ON COLUMN public.reservations.policy_snapshot IS
  'Immutable agreed payment terms (deposit %, balance deadline) captured at submission. Global default changes do not retroactively modify existing bookings.';

COMMENT ON COLUMN public.reservations.idempotency_key IS
  'Client-supplied idempotency key. Same key + same payload hash returns the existing reservation; same key + different payload is rejected.';

COMMENT ON TABLE public.reservation_guests IS
  'One row per guest: category, assigned package (with immutable name/price snapshot), and included-selection snapshots. Individual add-ons are child rows.';

COMMENT ON TABLE public.reservation_platter_lines IS
  'Shared platters priced PER PLATTER (never per guest) belonging to the party order.';

COMMIT;
