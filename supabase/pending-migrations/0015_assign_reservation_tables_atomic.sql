-- Sit Down Sundays — 0015_assign_reservation_tables_atomic.sql
-- CORRECTED DRAFT / UNAPPLIED. PostgreSQL execution has NOT been performed.
-- Apply as database owner after 0014. This replaces only the unapplied draft.
-- No changes to existing table schemas, triggers, statuses, payments or orders.
-- The application wrapper MUST verify seating.manage using the live session
-- and supply the authenticated user ID. The service-role key stays server-side.

BEGIN;

CREATE OR REPLACE FUNCTION public.assign_reservation_tables_atomic(
  p_reservation_id uuid,
  p_table_ids uuid[],
  p_expected_updated_at timestamptz,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $assign_tables$
DECLARE
  v_res public.reservations%ROWTYPE;
  v_service public.sunday_services%ROWTYPE;
  v_seating public.seating_times%ROWTYPE;
  v_space_active boolean;
  v_tz text;
  v_ids uuid[];
  v_count bigint;
  v_total_seats bigint;
  v_seating_start timestamptz;
  v_seating_end timestamptz;
  v_new_updated_at timestamptz;
  v_constraint_name text;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_actor');
  END IF;

  -- Keep the validated actor reference alive until this operation completes.
  PERFORM 1 FROM auth.users u
    WHERE u.id = p_actor_user_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_actor');
  END IF;

  IF p_reservation_id IS NULL OR p_expected_updated_at IS NULL
     OR NOT isfinite(p_expected_updated_at) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_data');
  END IF;

  -- Empty array explicitly means unassign. Reject malformed array shapes,
  -- NULL elements and duplicates rather than silently normalizing them away.
  IF p_table_ids IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_table');
  END IF;
  IF cardinality(p_table_ids) > 0 AND array_ndims(p_table_ids) <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_table');
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_table_ids) AS t(id) WHERE t.id IS NULL)
     OR EXISTS (
       SELECT 1 FROM unnest(p_table_ids) AS t(id)
       GROUP BY t.id HAVING count(*) > 1
     ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_table');
  END IF;

  SELECT COALESCE(array_agg(t.id ORDER BY t.id), ARRAY[]::uuid[])
    INTO v_ids FROM unnest(p_table_ids) AS t(id);

  -- Every assignment writer must use this reservation lock. It serializes
  -- moves/releases for one party and protects the optimistic concurrency check.
  SELECT r.* INTO v_res FROM public.reservations r
    WHERE r.id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF v_res.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'conflict');
  END IF;

  -- The existing BEFORE UPDATE trigger writes now() (transaction start).
  -- Do not change that shared trigger here. Reject an old/same transaction
  -- timestamp instead of returning success with an unchanged/older edit token.
  -- The caller may reload and retry in a fresh request/transaction.
  IF v_res.updated_at IS NULL OR NOT isfinite(v_res.updated_at)
     OR transaction_timestamp() <= v_res.updated_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'conflict');
  END IF;

  IF cardinality(v_ids) > 0 THEN
    -- Requests to cancel/transfer are NOT completed cancellations/transfers.
    -- Conservatively block NEW placement while they await review, retaining
    -- all existing assignments. No status automatically releases tables here.
    IF v_res.status IS NULL OR NOT (v_res.status = ANY(ARRAY[
      'pending_review', 'confirmed', 'balance_due', 'paid_in_full',
      'ready_for_service', 'checked_in', 'seated'
    ]::varchar[])) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_status');
    END IF;
    IF v_res.party_size IS NULL OR v_res.party_size <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_data');
    END IF;

    -- Configuration is held stable during validation AND the later writes.
    -- Shared locks permit concurrent assignments but block configuration edits.
    SELECT p.restaurant_timezone INTO v_tz
      FROM public.payment_policy p WHERE p.id = 1 FOR SHARE;
    IF NOT FOUND OR v_tz IS NULL OR btrim(v_tz) = '' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_configuration');
    END IF;
    v_tz := btrim(v_tz);
    -- Accept configured region names (America/Chicago) and UTC, not a
    -- seasonal abbreviation such as CDT or an arbitrary numeric offset.
    IF (position('/' IN v_tz) = 0 AND v_tz <> 'UTC')
       OR NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_tz
       ) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_configuration');
    END IF;

    SELECT s.* INTO v_service FROM public.sunday_services s
      WHERE s.id = v_res.sunday_service_id FOR SHARE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_configuration');
    END IF;
    -- Sold-out services can still seat existing parties. Closed services
    -- cannot receive new placements; release-all remains available below.
    IF v_service.is_active IS NOT TRUE OR v_service.status = 'closed'
       OR v_service.date IS NULL OR NOT isfinite(v_service.date) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_configuration');
    END IF;

    SELECT st.* INTO v_seating FROM public.seating_times st
      WHERE st.id = v_res.seating_time_id FOR SHARE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_configuration');
    END IF;
    IF v_seating.is_active IS NOT TRUE
       OR v_seating.sunday_service_id IS DISTINCT FROM v_service.id THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_configuration');
    END IF;

    SELECT s.is_active INTO v_space_active FROM public.venue_spaces s
      WHERE s.id = v_service.space_id FOR SHARE;
    IF NOT FOUND OR v_space_active IS NOT TRUE THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_configuration');
    END IF;

    BEGIN
      v_seating_start :=
        (v_service.date + v_seating.start_time::time) AT TIME ZONE v_tz;
      v_seating_end :=
        (v_service.date + v_seating.end_time::time) AT TIME ZONE v_tz;
    EXCEPTION
      WHEN invalid_parameter_value OR invalid_datetime_format
           OR datetime_field_overflow THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_configuration');
    END;

    IF v_seating_start IS NULL OR v_seating_end IS NULL
       OR NOT isfinite(v_seating_start) OR NOT isfinite(v_seating_end)
       OR v_seating_end <= v_seating_start THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_configuration');
    END IF;
  END IF;

  -- Lock the union of OLD and NEW physical tables in ID order. This covers
  -- releases and moves as well as first assignments. Deterministic ordering
  -- reduces deadlocks; it does not promise arbitrary other workflows cannot
  -- deadlock. Deadlock/serialization failures below return a safe conflict.
  PERFORM dt.id FROM public.dining_tables dt
    WHERE dt.id = ANY(v_ids) OR dt.id IN (
      SELECT a.dining_table_id FROM public.reservation_table_assignments a
      WHERE a.reservation_id = p_reservation_id AND a.released_at IS NULL
    )
    ORDER BY dt.id FOR UPDATE;

  IF cardinality(v_ids) > 0 THEN
    SELECT count(*), COALESCE(sum(dt.seats), 0)
      INTO v_count, v_total_seats
      FROM public.dining_tables dt WHERE dt.id = ANY(v_ids);
    IF v_count <> cardinality(v_ids) OR EXISTS (
      SELECT 1 FROM public.dining_tables dt WHERE dt.id = ANY(v_ids)
        AND (dt.is_active IS NOT TRUE
             OR dt.space_id IS DISTINCT FROM v_service.space_id)
    ) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_table');
    END IF;
    IF v_total_seats < v_res.party_size THEN
      RETURN jsonb_build_object('ok', false, 'code', 'insufficient_seats');
    END IF;
  END IF;

  -- No validation-return branches after writes start. ALL writes are inside
  -- the function's exception block. Any caught exception rolls them all back,
  -- including audit rows, releases, inserts and the reservation token change.
  -- Empty v_ids is an EXPLICIT release action even for terminal statuses or
  -- inactive/missing operational configuration; it does not change status.
  UPDATE public.reservation_table_assignments
    SET released_at = clock_timestamp(), updated_by = p_actor_user_id
    WHERE reservation_id = p_reservation_id AND released_at IS NULL;

  IF cardinality(v_ids) > 0 THEN
    INSERT INTO public.reservation_table_assignments (
      reservation_id, dining_table_id, seating_start, seating_end,
      created_by, updated_by
    )
    SELECT p_reservation_id, t.id, v_seating_start, v_seating_end,
           p_actor_user_id, p_actor_user_id
    FROM unnest(v_ids) AS t(id) ORDER BY t.id;
  END IF;

  UPDATE public.reservations SET updated_by = p_actor_user_id
    WHERE id = p_reservation_id
    RETURNING updated_at INTO v_new_updated_at;
  IF NOT FOUND OR v_new_updated_at IS NULL
     OR NOT isfinite(v_new_updated_at)
     OR v_new_updated_at <= v_res.updated_at THEN
    -- Raise, rather than RETURN, so already-performed writes are rolled back.
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'Reservation version did not advance';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'reservation_id', p_reservation_id,
    'assigned_table_ids', to_jsonb(v_ids),
    'reservation_updated_at', v_new_updated_at
  );

EXCEPTION
  WHEN exclusion_violation OR unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name IN (
      'excl_rta_no_overlap_current',
      'uniq_rta_current_per_reservation_per_table'
    ) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'table_conflict');
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'unexpected');
  WHEN deadlock_detected OR serialization_failure OR lock_not_available THEN
    RETURN jsonb_build_object('ok', false, 'code', 'conflict');
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_data');
  WHEN check_violation OR not_null_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_data');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unexpected');
END;
$assign_tables$;

REVOKE ALL ON FUNCTION public.assign_reservation_tables_atomic(
  uuid, uuid[], timestamptz, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_reservation_tables_atomic(
  uuid, uuid[], timestamptz, uuid
) TO service_role;

COMMENT ON FUNCTION public.assign_reservation_tables_atomic(
  uuid, uuid[], timestamptz, uuid
) IS
  'Service-role-only atomic party table replacement. Caller must verify seating.manage and supply the session actor. Empty array explicitly releases tables. Validates and locks authoritative schedule, timezone, room and tables for new placement. Preserves old assignments on failure; returns new reservation updated_at. Does not change reservation/payment status.';

-- NOT A COMPLETE SEATING WORKFLOW:
-- Later edits to table seats/activity/room, reservation party size or schedule,
-- service/seating settings, or timezone MUST be guarded or atomically reconciled
-- with current assignments before launch. A background consistency report may
-- detect drift but is NOT a substitute for preventing it, and must not silently
-- release a party's tables. Cancellation/transfer workflows must separately
-- coordinate explicit assignment changes. No such edit guards or UI exist here.

COMMIT;
