-- Sit Down Sundays — 0017_confirm_reservation_atomic.sql
-- REVIEWED DRAFT / UNAPPLIED. PostgreSQL execution has NOT been performed.
-- Apply as database owner after 0016; uses existing reservations +
-- reservation_status_history schema from 0011 (and notes in 0012).
-- Creates a staff CONFIRMATION RPC only. Confirmation means staff accepted
-- the reservation request. It does NOT mean a deposit was received or
-- payment completed, and does not change payment_status, totals, deposit,
-- balance deadline, order snapshots, guest notes, or table assignments.
-- The server wrapper MUST verify reservations.manage and supply the live
-- session actor. No browser role, actor, or status is trusted.

BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_reservation_atomic(
  p_reservation_id uuid,
  p_expected_updated_at timestamptz,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $confirm$
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

  -- Every assignment/confirmation/cancellation writer uses this reservation
  -- lock. It serializes state changes for one party and protects the
  -- optimistic-concurrency (expectedUpdatedAt) check.
  SELECT r.* INTO v_res FROM public.reservations r
    WHERE r.id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- State-idempotent recovery BEFORE stale-token rejection: a retry after a
  -- lost success response still carries the old token. If the reservation is
  -- already confirmed, return the current state without another write or
  -- history entry. This does not claim which caller caused confirmation.
  IF v_res.status = 'confirmed' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'reservation_id', p_reservation_id,
      'reservation_updated_at', v_res.updated_at,
      'already_confirmed', true
    );
  END IF;

  IF v_res.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'conflict');
  END IF;

  -- Only pending_review may be confirmed. Never reopen cancelled reservations
  -- or downgrade any payment/service status.
  IF v_res.status IS NULL OR v_res.status <> 'pending_review' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_status');
  END IF;

  -- All following writes are enclosed by this function's EXCEPTION block.
  -- Any caught exception rolls back the status change AND the history/audit
  -- entry together. No partial commit: a failed history insert cannot leave a
  -- confirmed reservation with no audit trail.

  -- Change only status and updated_by. The existing BEFORE UPDATE trigger
  -- (set_reservations_updated_at) sets updated_at = now(). Payment status,
  -- totals, deposit, balance deadline, order snapshots, guest notes, and
  -- table assignments are all preserved.
  UPDATE public.reservations
    SET status = 'confirmed', updated_by = p_actor_user_id
    WHERE id = p_reservation_id
    RETURNING updated_at INTO v_new_updated_at;

  -- If the trigger fails to advance the token, RAISE (not RETURN) so every
  -- preceding write rolls back; retry requires a fresh transaction.
  IF NOT FOUND OR v_new_updated_at IS NULL
     OR NOT isfinite(v_new_updated_at)
     OR v_new_updated_at <= v_res.updated_at THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'Reservation version did not advance';
  END IF;

  -- Append-only history entry. The block_update_delete_reservation_status_history
  -- trigger (0011) prevents later UPDATE/DELETE of this row.
  INSERT INTO public.reservation_status_history (
    reservation_id, previous_status, new_status, reason, created_by
  ) VALUES (
    p_reservation_id, v_res.status, 'confirmed',
    'Reservation confirmed by staff.', p_actor_user_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'reservation_id', p_reservation_id,
    'reservation_updated_at', v_new_updated_at,
    'already_confirmed', false
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
$confirm$;

REVOKE ALL ON FUNCTION public.confirm_reservation_atomic(
  uuid, timestamptz, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_reservation_atomic(
  uuid, timestamptz, uuid
) TO service_role;

COMMENT ON FUNCTION public.confirm_reservation_atomic(
  uuid, timestamptz, uuid
) IS
  'Atomic staff confirmation of a pending_review reservation to confirmed, with one append-only status-history entry. Server caller must verify reservations.manage and supply the verified actor. Already-confirmed returns current state without writes even with an old token; other stale edits are rejected. Does not change payment_status, totals, deposit, balance deadline, order snapshots, guest notes, or table assignments.';

-- No reopen of cancelled/no_show/completed/reservation; no confirmation of
-- non-pending_review statuses. No payment, refund, notification, deposit, or
-- scheduling changes. No new direct table-write grants. The application
-- wrapper (next task) must independently authorize reservations.manage and
-- derive the actor from the authenticated session.

COMMIT;
