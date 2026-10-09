-- ============================================================================
-- Sit Down Sundays — 0012_reservations_guest_notes.sql
-- ============================================================================
-- Per-guest food allergies, dietary preferences, and meal-specific requests.
--
-- This migration is ADDITIVE. It adds three text columns to
-- public.reservation_guests and recreates submit_reservation_request_atomic
-- (same signature) to persist and validate them in the same transaction as
-- the guest row.
--
-- It does NOT modify or reapply 0001–0011. It does NOT implement UI, booking,
-- table assignment, Stripe, or any application wiring.
--
-- DESIGN RULES (per owner direction):
--   * food_allergies, dietary_preferences, meal_requests are per-guest notes.
--     They are stored as snake_case database columns on reservation_guests.
--   * Each defaults to '' (empty) and is limited to 1,000 characters.
--   * Existing rows remain valid: the DEFAULT '' + NOT NULL backfills them.
--   * The RPC reads them from each p_guests JSON object using camelCase
--     keys: foodAllergies, dietaryPreferences, mealRequests.
--   * Missing keys default to '' (backward compatibility).
--   * Non-string values (numbers, booleans, arrays, objects) are rejected.
--   * Over-length text is rejected.
--   * They are inserted in the SAME transaction as the guest and reservation.
--   * No separate allergy audit log — see the audit coverage note below.
--
-- AUDIT COVERAGE:
--   0011 defines trg_reservations_audit (AFTER INSERT OR UPDATE on
--   public.reservations) calling public.audit_cms_change() (0004). There is
--   NO audit trigger on public.reservation_guests. The parent reservation
--   INSERT is audited (recording the reservation row's old/new JSON), but
--   individual guest rows — including these new note fields — are NOT
--   separately audited. They are written in the same transaction as the
--   audited reservation INSERT, so a guest-insert failure rolls back the
--   entire transaction including the reservation. No separate log duplicates
--   allergy information.
--
-- STATUS: DRAFT, NOT YET APPLIED.
-- Supabase should run this versioned migration exactly once, after
-- 0011_reservations.sql. Wrapped in BEGIN/COMMIT for atomic application.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Add per-guest note columns to reservation_guests
-- ----------------------------------------------------------------------------
-- Existing rows backfill to '' via DEFAULT + NOT NULL. The CHECK constraints
-- enforce the 1,000-character limit.

ALTER TABLE public.reservation_guests
  ADD COLUMN IF NOT EXISTS food_allergies text NOT NULL DEFAULT '';

ALTER TABLE public.reservation_guests
  ADD COLUMN IF NOT EXISTS dietary_preferences text NOT NULL DEFAULT '';

ALTER TABLE public.reservation_guests
  ADD COLUMN IF NOT EXISTS meal_requests text NOT NULL DEFAULT '';

-- Length constraints (≤ 1,000 characters each).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_res_guests_food_allergies_len'
      AND conrelid = 'public.reservation_guests'::regclass
  ) THEN
    ALTER TABLE public.reservation_guests
      ADD CONSTRAINT check_res_guests_food_allergies_len
      CHECK (length(food_allergies) <= 1000);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_res_guests_dietary_preferences_len'
      AND conrelid = 'public.reservation_guests'::regclass
  ) THEN
    ALTER TABLE public.reservation_guests
      ADD CONSTRAINT check_res_guests_dietary_preferences_len
      CHECK (length(dietary_preferences) <= 1000);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_res_guests_meal_requests_len'
      AND conrelid = 'public.reservation_guests'::regclass
  ) THEN
    ALTER TABLE public.reservation_guests
      ADD CONSTRAINT check_res_guests_meal_requests_len
      CHECK (length(meal_requests) <= 1000);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Recreate submit_reservation_request_atomic (same signature)
-- ----------------------------------------------------------------------------
-- Same parameter signature and behavior as 0011. Extended to:
--   * Validate foodAllergies / dietaryPreferences / mealRequests in each
--     p_guests JSON element (reject non-string, reject > 1000 chars).
--   * Insert them into reservation_guests in the same transaction.
-- All idempotency, concurrent duplicate-key handling, financial invariants,
-- rollback, status/history, search_path, SECURITY DEFINER, and grants are
-- preserved exactly.
CREATE OR REPLACE FUNCTION public.submit_reservation_request_atomic(
  p_reservation_number     varchar,
  p_contact_first_name      varchar,
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
  p_guests                 jsonb,   -- [{guestIndex,category,name,packageId,packageName,packagePrice,included:[{menuItemId,name,category}],addons:[{addonId,name,price,quantity}],foodAllergies,dietaryPreferences,mealRequests}]
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
  v_food_allergies text;
  v_dietary_preferences text;
  v_meal_requests text;
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
  -- Also validate per-guest note fields (foodAllergies, dietaryPreferences,
  -- mealRequests): reject non-string values and text exceeding 1,000 chars.
  -- Missing keys default to '' (backward compatibility).
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
    -- Per-guest note validation: reject non-string values (numbers, booleans,
    -- arrays, objects). Missing keys are fine (default to '').
    IF v_g ? 'foodAllergies' AND jsonb_typeof(v_g->'foodAllergies') <> 'string' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_guests');
    END IF;
    IF v_g ? 'dietaryPreferences' AND jsonb_typeof(v_g->'dietaryPreferences') <> 'string' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_guests');
    END IF;
    IF v_g ? 'mealRequests' AND jsonb_typeof(v_g->'mealRequests') <> 'string' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_guests');
    END IF;
    -- Reject over-length text.
    IF (v_g ? 'foodAllergies' AND length(v_g->>'foodAllergies') > 1000)
       OR (v_g ? 'dietaryPreferences' AND length(v_g->>'dietaryPreferences') > 1000)
       OR (v_g ? 'mealRequests' AND length(v_g->>'mealRequests') > 1000) THEN
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
  -- Per-guest notes (food_allergies, dietary_preferences, meal_requests) are
  -- read from the JSON object using camelCase keys. Missing keys default to
  -- '' via COALESCE.
  FOR v_guest IN SELECT * FROM jsonb_array_elements(p_guests) LOOP
    -- Resolve per-guest notes: '' when missing, else the validated string.
    v_food_allergies := COALESCE(v_guest->>'foodAllergies', '');
    v_dietary_preferences := COALESCE(v_guest->>'dietaryPreferences', '');
    v_meal_requests := COALESCE(v_guest->>'mealRequests', '');

    INSERT INTO public.reservation_guests (
      reservation_id, guest_index, guest_category, guest_name,
      package_id, package_name_snapshot, package_price_snapshot,
      included_selections,
      food_allergies, dietary_preferences, meal_requests
    ) VALUES (
      v_reservation_id,
      (v_guest->>'guestIndex')::int,
      v_guest->>'category',
      NULLIF(v_guest->>'name', ''),
      (v_guest->>'packageId')::uuid,
      v_guest->>'packageName',
      (v_guest->>'packagePrice')::int,
      COALESCE(v_guest->'included', '[]'::jsonb),
      v_food_allergies,
      v_dietary_preferences,
      v_meal_requests
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

-- Preserve the exact GRANT/REVOKE signatures from 0011 (same parameter types).
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
-- 3. reservation_detail_view — no update needed
-- ----------------------------------------------------------------------------
-- The detail view (0011) projects r.* from public.reservations and joins
-- service/seating/space context. It does NOT join public.reservation_guests,
-- so the new per-guest columns are not in its projection. Guest-level data
-- (including food_allergies, dietary_preferences, meal_requests) is read
-- separately from public.reservation_guests by the repository. No view change
-- is required; its existing columns and access restrictions are preserved.

-- ----------------------------------------------------------------------------
-- 4. Documentation
-- ----------------------------------------------------------------------------
COMMENT ON COLUMN public.reservation_guests.food_allergies IS
  'Per-guest food allergy notes (≤ 1000 chars). Defaults to empty. Not a guarantee that an allergy can be accommodated.';

COMMENT ON COLUMN public.reservation_guests.dietary_preferences IS
  'Per-guest dietary preferences or restrictions (≤ 1000 chars). Defaults to empty.';

COMMENT ON COLUMN public.reservation_guests.meal_requests IS
  'Per-guest meal-specific requests (≤ 1000 chars). Defaults to empty.';

COMMIT;