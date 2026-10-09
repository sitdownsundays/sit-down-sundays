-- Sit Down Sundays — 0016_cancel_reservation_atomic.sql
-- REVIEWED DRAFT / UNAPPLIED. PostgreSQL execution has NOT been performed.
-- Apply as database owner after 0015; replaces ONLY the unapplied 0016 draft.
-- Creates a staff cancellation RPC, not a refund/credit/payment workflow.
-- The server wrapper MUST verify reservations.manage and supply the live
-- session actor. No browser role, actor, or status is trusted.

BEGIN;

CREATE OR REPLACE FUNCTION public.cancel_reservation_atomic(
  p_reservation_id uuid,
  p_expected_updated_at timestamptz,
  p_actor_user_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $cancel$
DECLARE
  v_res public.reservations%ROWTYPE;
  v_new_updated_at timestamptz;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_actor');
  END IF;
  PERFORM 1 FROM auth.users u WHERE u.id = p_actor_user_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_actor');
  END IF;

  IF p_reservation_id IS NULL OR p_expected_updated_at IS NULL
     OR NOT isfinite(p_expected_updated_at) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_data');
  END IF;

  -- Required reason, 1–1000 characters, containing a non-whitespace character.
  -- Reject whitespace-only tabs/newlines as well as ordinary spaces. Preserve
  -- the supplied valid text exactly in the status history; never truncate it.
  IF p_reason IS NULL OR char_length(p_reason) > 1000
     OR p_reason !~ '[^[:space:]]' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_data');
  END IF;

  SELECT r.* INTO v_res FROM public.reservations r
    WHERE r.id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- State-idempotent recovery BEFORE stale-token rejection: a retry after a
  -- lost success response still has the old token. If cancellation is already
  -- complete, return the current state without rewriting its reason/history
  -- or releasing assignments again. This does not claim which caller caused
  -- the cancellation. For every state-changing operation, the token check
  -- below remains mandatory.
  IF v_res.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'reservation_id', p_reservation_id,
      'reservation_updated_at', v_res.updated_at,
      'already_cancelled', true
    );
  END IF;

  IF v_res.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'conflict');
  END IF;

  IF v_res.status IS NULL OR NOT (v_res.status = ANY(ARRAY[
    'pending_review', 'confirmed', 'balance_due', 'paid_in_full',
    'ready_for_service', 'cancellation_requested', 'transfer_requested'
  ]::varchar[])) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_status');
  END IF;

  -- Same lock ordering as 0015: reservation first, then physical tables by ID.
  -- No active-table or service-configuration requirement for releasing tables.
  PERFORM dt.id FROM public.dining_tables dt
    WHERE dt.id IN (
      SELECT a.dining_table_id FROM public.reservation_table_assignments a
      WHERE a.reservation_id = p_reservation_id AND a.released_at IS NULL
    )
    ORDER BY dt.id FOR UPDATE;

  -- All following writes are enclosed by this function's EXCEPTION block.
  -- Any caught exception rolls back releases, status, token and audit/history.
  UPDATE public.reservation_table_assignments
    SET released_at = clock_timestamp(), updated_by = p_actor_user_id
    WHERE reservation_id = p_reservation_id AND released_at IS NULL;

  -- Preserve payment status, amount paid, charges, guests and order snapshots.
  UPDATE public.reservations
    SET status = 'cancelled', updated_by = p_actor_user_id
    WHERE id = p_reservation_id
    RETURNING updated_at INTO v_new_updated_at;

  -- Existing BEFORE UPDATE trigger sets now() (transaction start). Do not
  -- alter it here. If the token fails to advance, RAISE rather than RETURN so
  -- every preceding write rolls back; retry requires a fresh transaction.
  IF NOT FOUND OR v_new_updated_at IS NULL
     OR NOT isfinite(v_new_updated_at)
     OR v_new_updated_at <= v_res.updated_at THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'Reservation version did not advance';
  END IF;

  INSERT INTO public.reservation_status_history (
    reservation_id, previous_status, new_status, reason, created_by
  ) VALUES (
    p_reservation_id, v_res.status, 'cancelled', p_reason, p_actor_user_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'reservation_id', p_reservation_id,
    'reservation_updated_at', v_new_updated_at,
    'already_cancelled', false
  );

EXCEPTION
  WHEN deadlock_detected OR serialization_failure OR lock_not_available THEN
    RETURN jsonb_build_object('ok', false, 'code', 'conflict');
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_data');
  WHEN check_violation OR not_null_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_data');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unexpected');
END;
$cancel$;

REVOKE ALL ON FUNCTION public.cancel_reservation_atomic(
  uuid, timestamptz, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_reservation_atomic(
  uuid, timestamptz, uuid, text
) TO service_role;

COMMENT ON FUNCTION public.cancel_reservation_atomic(
  uuid, timestamptz, uuid, text
) IS
  'Atomic pre-arrival staff cancellation with table release and one status-history entry. Server caller must verify reservations.manage and supply the verified actor. Already-cancelled returns current state without writes even with an old token; other stale edits are rejected. No refund, credit, payment changes, or notifications.';

-- No cancellation of checked_in/seated/completed/no_show/refund_review in this
-- first slice. No automatic refunds, credits, notifications, or new direct
-- table-write grants. Migration execution itself cancels no reservations.

COMMIT;