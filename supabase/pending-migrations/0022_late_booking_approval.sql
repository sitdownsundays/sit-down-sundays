-- REPLACEMENT 0022. Apply ONCE after reviewed 0021, only if 0022 is UNAPPLIED.
-- No activation, seed data, Stripe calls, emails, refunds, or live-mode support.
-- Server callers MUST authenticate the actor; a browser cannot call these RPCs.
BEGIN;

ALTER TABLE public.reservations
  ADD COLUMN requires_management_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  ADD COLUMN approval_timing_basis text NOT NULL DEFAULT 'historical_unverified',
  ADD COLUMN approval_submitted_at timestamptz,
  ADD COLUMN approval_seating_start timestamptz,
  ADD COLUMN approval_timezone text,
  ADD CONSTRAINT approval_actor_pair_0022 CHECK
    ((approved_at IS NULL) = (approved_by IS NULL));

CREATE FUNCTION public.management_actor_0022(p_actor uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id=p.id AND ur.revoked_at IS NULL
    JOIN public.role_permissions rp ON rp.role_id=ur.role_id
    JOIN public.permissions pm ON pm.id=rp.permission_id
    WHERE p.id=p_actor AND p.status='active' AND pm.key='reservations.manage'
  );
$$;

CREATE FUNCTION public.deposit_approval_ok_0022(r public.reservations)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
  SELECT COALESCE(
    (r.approved_at IS NOT NULL AND r.approved_by IS NOT NULL)
    OR (NOT r.requires_management_approval
      AND r.approval_timing_basis='early_booking_168h_or_more'
      AND isfinite(r.approval_submitted_at) AND isfinite(r.approval_seating_start)
      AND r.approval_seating_start-r.approval_submitted_at>=interval '168 hours'),false);
$$;

CREATE FUNCTION public.set_approval_requirement_0022() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tz text; starts timestamptz; submitted timestamptz:=clock_timestamp();
BEGIN
  SELECT btrim(restaurant_timezone) INTO tz FROM public.payment_policy WHERE id=1;
  IF tz IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=tz) THEN
    RAISE EXCEPTION 'Restaurant timezone must be configured';
  END IF;
  SELECT (s.date+st.start_time::time) AT TIME ZONE tz INTO starts
    FROM public.sunday_services s JOIN public.seating_times st ON st.sunday_service_id=s.id
    WHERE s.id=NEW.sunday_service_id AND st.id=NEW.seating_time_id;
  IF starts IS NULL OR NOT isfinite(starts) OR starts<=submitted THEN
    RAISE EXCEPTION 'A future seating is required';
  END IF;
  NEW.approved_at:=NULL; NEW.approved_by:=NULL;
  NEW.approval_submitted_at:=submitted; NEW.approval_seating_start:=starts;
  NEW.approval_timezone:=tz;
  NEW.requires_management_approval:=(starts-submitted<interval '168 hours');
  NEW.approval_timing_basis:=CASE WHEN NEW.requires_management_approval
    THEN 'late_booking_under_168h' ELSE 'early_booking_168h_or_more' END;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_set_approval_requirement BEFORE INSERT ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.set_approval_requirement_0022();

-- One immutable approval decision. 'custom' means an absolute timestamp;
-- 'hours_before' is relative; 'at_check_in' matches the existing Sundays enum.
CREATE TABLE public.reservation_balance_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL UNIQUE REFERENCES public.reservations(id) ON DELETE RESTRICT,
  deadline_type text NOT NULL CHECK(deadline_type IN ('default','hours_before','custom','at_check_in')),
  custom_hours integer,
  custom_deadline timestamptz,
  balance_deadline timestamptz NOT NULL CHECK(isfinite(balance_deadline)),
  deposit_deadline timestamptz NOT NULL CHECK(isfinite(deposit_deadline)),
  approved_at timestamptz NOT NULL CHECK(isfinite(approved_at)),
  approved_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CHECK(deposit_deadline=approved_at+interval '2 hours'),
  CHECK(created_by=approved_by),
  CHECK((deadline_type='hours_before' AND custom_hours IS NOT NULL AND custom_hours BETWEEN 1 AND 720 AND custom_deadline IS NULL)
    OR (deadline_type='custom' AND custom_hours IS NULL AND custom_deadline IS NOT NULL AND isfinite(custom_deadline))
    OR (deadline_type IN ('default','at_check_in') AND custom_hours IS NULL AND custom_deadline IS NULL)),
  CHECK(deadline_type='default' OR (reason IS NOT NULL AND length(btrim(reason)) BETWEEN 1 AND 1000))
);
CREATE FUNCTION public.immutable_approval_0022() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Approval decisions are immutable; explicit reconciliation is required'; END $$;
CREATE TRIGGER trg_balance_override_immutable BEFORE UPDATE OR DELETE ON public.reservation_balance_overrides
  FOR EACH ROW EXECUTE FUNCTION public.immutable_approval_0022();
CREATE TRIGGER trg_balance_override_audit AFTER INSERT ON public.reservation_balance_overrides
  FOR EACH ROW EXECUTE FUNCTION public.audit_cms_change();

CREATE FUNCTION public.guard_reservation_approval_0022() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF ROW(NEW.requires_management_approval,NEW.approval_timing_basis,NEW.approval_submitted_at,
    NEW.approval_seating_start,NEW.approval_timezone) IS DISTINCT FROM
    ROW(OLD.requires_management_approval,OLD.approval_timing_basis,OLD.approval_submitted_at,
    OLD.approval_seating_start,OLD.approval_timezone) THEN
    RAISE EXCEPTION 'Approval eligibility snapshot is immutable';
  END IF;
  IF ROW(NEW.approved_at,NEW.approved_by) IS DISTINCT FROM ROW(OLD.approved_at,OLD.approved_by) THEN
    IF OLD.approved_at IS NOT NULL OR NOT EXISTS(
      SELECT 1 FROM public.reservation_balance_overrides o WHERE o.reservation_id=NEW.id
        AND o.approved_at=NEW.approved_at AND o.approved_by=NEW.approved_by
        AND o.balance_deadline=NEW.balance_deadline) THEN
      RAISE EXCEPTION 'Approval requires an atomic recorded decision';
    END IF;
    NEW.updated_at:=GREATEST(clock_timestamp(),OLD.updated_at+interval '1 microsecond');
  END IF;
  IF NEW.status='confirmed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NOT public.deposit_approval_ok_0022(NEW)
       OR NEW.deposit_required_cents<=0 OR NEW.amount_paid_cents<NEW.deposit_required_cents
       OR NEW.payment_status NOT IN ('deposit_paid','partially_paid','balance_due','paid_in_full') THEN
      RAISE EXCEPTION 'Verified deposit and approval eligibility are required';
    END IF;
  END IF;
  RETURN NEW;
END $$;
-- Runs after the existing timestamp trigger so an approval always advances its version.
CREATE TRIGGER trg_zz_guard_reservation_approval BEFORE UPDATE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.guard_reservation_approval_0022();

CREATE FUNCTION public.approve_reservation_for_payment_atomic(
  p_reservation_id uuid,p_actor_user_id uuid,p_expected_updated_at timestamptz,
  p_balance_deadline_type text DEFAULT 'default',p_custom_hours integer DEFAULT NULL,
  p_reason text DEFAULT NULL,p_custom_deadline timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.reservations%ROWTYPE; h public.reservation_capacity_holds%ROWTYPE;
  o public.reservation_balance_overrides%ROWTYPE; starts timestamptz; due timestamptz;
  stamp timestamptz; reason text:=NULLIF(btrim(p_reason),''); tz text; current_start timestamptz;
BEGIN
  IF NOT public.management_actor_0022(p_actor_user_id) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_actor'); END IF;
  IF p_reservation_id IS NULL OR p_expected_updated_at IS NULL OR NOT isfinite(p_expected_updated_at)
    OR p_balance_deadline_type IS NULL OR p_balance_deadline_type NOT IN ('default','hours_before','custom','at_check_in')
    OR (reason IS NOT NULL AND length(reason)>1000)
    OR (p_balance_deadline_type<>'default' AND reason IS NULL) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_data'); END IF;
  IF (p_balance_deadline_type='hours_before' AND
       (p_custom_hours IS NULL OR p_custom_hours NOT BETWEEN 1 AND 720 OR p_custom_deadline IS NOT NULL))
    OR (p_balance_deadline_type='custom' AND
       (p_custom_hours IS NOT NULL OR p_custom_deadline IS NULL OR NOT isfinite(p_custom_deadline)))
    OR (p_balance_deadline_type IN ('default','at_check_in') AND
       (p_custom_hours IS NOT NULL OR p_custom_deadline IS NOT NULL)) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_data'); END IF;
  SELECT * INTO r FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  IF r.status NOT IN ('pending_review','confirmed','balance_due','ready_for_service') THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_status'); END IF;
  PERFORM public.capacity_lock_0019();
  SELECT * INTO h FROM public.reservation_capacity_holds WHERE reservation_id=r.id FOR UPDATE;
  SELECT * INTO o FROM public.reservation_balance_overrides WHERE reservation_id=r.id;
  IF r.approved_at IS NOT NULL THEN
    IF o.id IS NULL OR ROW(o.deadline_type,o.custom_hours,o.custom_deadline,o.reason)
      IS DISTINCT FROM ROW(p_balance_deadline_type,p_custom_hours,p_custom_deadline,reason) THEN
      RETURN jsonb_build_object('ok',false,'code','conflict'); END IF;
    RETURN jsonb_build_object('ok',true,'reservation_id',r.id,'reservation_updated_at',r.updated_at,
      'approved_at',o.approved_at,'deposit_deadline',o.deposit_deadline,
      'balance_deadline',o.balance_deadline,'balance_deadline_type',o.deadline_type,'already_approved',true);
  END IF;
  IF r.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok',false,'code','conflict'); END IF;
  IF o.id IS NOT NULL OR NOT r.requires_management_approval OR r.amount_paid_cents<>0
    OR r.payment_status NOT IN ('unpaid','deposit_pending') OR r.deposit_required_cents<=0
    OR r.deposit_required_cents>r.grand_total_cents OR r.remaining_balance_cents<>r.grand_total_cents THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_status'); END IF;
  IF h.id IS NULL OR h.state<>'held' OR h.released_at IS NOT NULL OR h.party_size<>r.party_size
    OR h.capacity_resource_id IS DISTINCT FROM public.resolve_capacity_resource_for_reservation(r.id) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_capacity'); END IF;
  SELECT btrim(restaurant_timezone) INTO tz FROM public.payment_policy WHERE id=1;
  IF tz IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=tz) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_configuration'); END IF;
  SELECT (s.date+st.start_time::time) AT TIME ZONE tz INTO current_start
    FROM public.sunday_services s JOIN public.seating_times st ON st.sunday_service_id=s.id
    WHERE s.id=r.sunday_service_id AND st.id=r.seating_time_id
      AND s.is_active AND s.status='open' AND st.is_active;
  starts:=h.seating_start;
  IF current_start IS DISTINCT FROM starts OR starts<=clock_timestamp()
    OR h.seating_end IS DISTINCT FROM starts+interval '150 minutes'
    OR (r.approval_seating_start IS NOT NULL AND r.approval_seating_start<>starts) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_capacity'); END IF;
  PERFORM 1 FROM public.reservation_checkout_attempts WHERE reservation_id=r.id FOR UPDATE;
  IF FOUND THEN RETURN jsonb_build_object('ok',false,'code','checkout_requires_review'); END IF;
  stamp:=clock_timestamp();
  due:=CASE p_balance_deadline_type WHEN 'default' THEN starts-interval '72 hours'
    WHEN 'hours_before' THEN starts-make_interval(hours=>p_custom_hours)
    WHEN 'custom' THEN p_custom_deadline ELSE starts END;
  IF due<=stamp OR due>starts THEN
    RETURN jsonb_build_object('ok',false,'code',CASE WHEN p_balance_deadline_type='default'
      THEN 'default_deadline_passed' ELSE 'invalid_deadline' END); END IF;
  INSERT INTO public.reservation_balance_overrides(reservation_id,deadline_type,custom_hours,
    custom_deadline,balance_deadline,deposit_deadline,approved_at,approved_by,reason,created_by)
  VALUES(r.id,p_balance_deadline_type,p_custom_hours,p_custom_deadline,due,stamp+interval '2 hours',stamp,p_actor_user_id,reason,p_actor_user_id);
  UPDATE public.reservation_capacity_holds SET hold_deadline=stamp+interval '2 hours',updated_by=p_actor_user_id WHERE id=h.id;
  UPDATE public.reservations SET approved_at=stamp,approved_by=p_actor_user_id,
    balance_deadline=due,updated_by=p_actor_user_id WHERE id=r.id RETURNING * INTO r;
  RETURN jsonb_build_object('ok',true,'reservation_id',r.id,'reservation_updated_at',r.updated_at,
    'approved_at',stamp,'deposit_deadline',stamp+interval '2 hours','balance_deadline',due,
    'balance_deadline_type',p_balance_deadline_type,'already_approved',false);
EXCEPTION WHEN serialization_failure OR deadlock_detected OR lock_not_available THEN
  RETURN jsonb_build_object('ok',false,'code','conflict');
WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'code','unexpected');
END $$;

-- Private originals retain all reviewed 0020 checks. Their direct grants are
-- removed; callers keep using the original public RPC names below.
ALTER FUNCTION public.prepare_checkout_session_atomic(uuid,uuid,text,text) RENAME TO prepare_checkout_before_0022;
ALTER FUNCTION public.record_checkout_session(uuid,uuid,varchar,text) RENAME TO record_checkout_before_0022;
ALTER FUNCTION public.confirm_reservation_atomic(uuid,timestamptz,uuid) RENAME TO confirm_reservation_before_0022;
ALTER FUNCTION public.confirm_reservation_capacity_atomic(uuid,uuid) RENAME TO confirm_capacity_before_0022;

CREATE FUNCTION public.confirm_reservation_capacity_atomic(p_reservation_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.reservations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  PERFORM public.capacity_lock_0019();
  IF NOT public.deposit_approval_ok_0022(r) THEN
    RETURN jsonb_build_object('ok',false,'code','approval_required'); END IF;
  RETURN public.confirm_capacity_before_0022(p_reservation_id,p_actor_user_id);
EXCEPTION WHEN serialization_failure OR deadlock_detected OR lock_not_available THEN
  RETURN jsonb_build_object('ok',false,'code','conflict');
WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'code','unexpected');
END $$;

CREATE FUNCTION public.prepare_checkout_session_atomic(p_reservation_id uuid,p_actor_user_id uuid,p_success_url text,p_cancel_url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.reservations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  PERFORM public.capacity_lock_0019();
  IF NOT public.deposit_approval_ok_0022(r) THEN
    RETURN jsonb_build_object('ok',false,'code','approval_required'); END IF;
  RETURN public.prepare_checkout_before_0022(p_reservation_id,p_actor_user_id,p_success_url,p_cancel_url);
EXCEPTION WHEN serialization_failure OR deadlock_detected OR lock_not_available THEN
  RETURN jsonb_build_object('ok',false,'code','conflict');
WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'code','unexpected');
END $$;

CREATE FUNCTION public.record_checkout_session(p_attempt_id uuid,p_actor_user_id uuid,p_stripe_session_id varchar,p_stripe_session_url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE rid uuid; r public.reservations%ROWTYPE; result jsonb;
BEGIN
  SELECT reservation_id INTO rid FROM public.reservation_checkout_attempts WHERE id=p_attempt_id;
  SELECT * INTO r FROM public.reservations WHERE id=rid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  PERFORM public.capacity_lock_0019();
  result:=public.record_checkout_before_0022(p_attempt_id,p_actor_user_id,p_stripe_session_id,p_stripe_session_url);
  -- Preserve Stripe identity even if approval is absent; never return a payable link.
  IF NOT public.deposit_approval_ok_0022(r) THEN
    RETURN jsonb_build_object('ok',false,'code','approval_required'); END IF;
  RETURN result;
EXCEPTION WHEN serialization_failure OR deadlock_detected OR lock_not_available THEN
  RETURN jsonb_build_object('ok',false,'code','conflict');
WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'code','unexpected');
END $$;

CREATE FUNCTION public.confirm_reservation_atomic(p_reservation_id uuid,p_expected_updated_at timestamptz,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.reservations%ROWTYPE; result jsonb; allocation jsonb;
BEGIN
  IF NOT public.management_actor_0022(p_actor_user_id) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_actor'); END IF;
  SELECT * INTO r FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  IF r.status='confirmed' THEN
    RETURN public.confirm_reservation_before_0022(p_reservation_id,p_expected_updated_at,p_actor_user_id); END IF;
  IF NOT public.deposit_approval_ok_0022(r) OR r.deposit_required_cents<=0
    OR r.amount_paid_cents<r.deposit_required_cents
    OR r.payment_status NOT IN ('deposit_paid','partially_paid','balance_due','paid_in_full') THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_status'); END IF;
  PERFORM public.capacity_lock_0019();
  result:=public.confirm_reservation_before_0022(p_reservation_id,p_expected_updated_at,p_actor_user_id);
  IF result->>'ok'='true' THEN
    allocation:=public.confirm_reservation_capacity_atomic(r.id,p_actor_user_id);
    IF allocation->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Capacity allocation failed'; END IF;
  END IF;
  RETURN result;
EXCEPTION WHEN serialization_failure OR deadlock_detected OR lock_not_available THEN
  RETURN jsonb_build_object('ok',false,'code','conflict');
WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'code','unexpected');
END $$;

CREATE OR REPLACE FUNCTION public.apply_verified_reservation_deposit_atomic(
  p_event_id text, p_event_type text,
  p_attempt_id uuid, p_reservation_id uuid,
  p_stripe_session_id text, p_payment_intent_id text,
  p_amount_cents integer, p_currency text, p_livemode boolean,
  p_payment_status text, p_payment_intent_status text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  r public.reservations%ROWTYPE;
  h public.reservation_capacity_holds%ROWTYPE;
  a public.reservation_checkout_attempts%ROWTYPE;
  receipt public.reservation_deposit_payments%ROWTYPE;
  v_balance_safe boolean;
  v_reason text;
  v_status varchar(40);
  v_allocation jsonb;
BEGIN
  IF p_event_id IS NULL OR p_event_id !~ '^evt_[A-Za-z0-9_]+$' OR length(p_event_id)>255
     OR p_event_type IS NULL OR p_event_type NOT IN
       ('checkout.session.completed','checkout.session.async_payment_succeeded')
     OR p_attempt_id IS NULL OR p_reservation_id IS NULL
     OR p_stripe_session_id IS NULL OR p_stripe_session_id !~ '^cs_test_[A-Za-z0-9_]+$'
     OR length(p_stripe_session_id)>200
     OR p_payment_intent_id IS NULL OR p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$'
     OR length(p_payment_intent_id)>255 OR p_amount_cents IS NULL OR p_amount_cents<=0
     OR p_currency IS DISTINCT FROM 'usd' OR p_livemode IS DISTINCT FROM false
     OR p_payment_status IS DISTINCT FROM 'paid'
     OR p_payment_intent_status IS DISTINCT FROM 'succeeded' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_data');
  END IF;
  SELECT * INTO r FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  -- Reservation -> capacity mutex -> hold -> attempt. No external network calls.
  PERFORM public.capacity_lock_0019();
  SELECT * INTO h FROM public.reservation_capacity_holds WHERE reservation_id=r.id FOR UPDATE;
  SELECT * INTO a FROM public.reservation_checkout_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND OR a.reservation_id<>r.id THEN
    RETURN jsonb_build_object('ok',false,'code','identity_mismatch');
  END IF;
  IF a.deposit_amount_cents<>p_amount_cents OR a.currency<>p_currency
     OR (a.stripe_session_id IS NOT NULL AND a.stripe_session_id<>p_stripe_session_id) THEN
    RETURN jsonb_build_object('ok',false,'code','payment_mismatch');
  END IF;

  IF EXISTS(SELECT 1 FROM public.reservation_deposit_payments d
    WHERE d.first_event_id=p_event_id AND
      ROW(d.attempt_id,d.reservation_id,d.stripe_session_id,d.payment_intent_id,d.first_event_type)
      IS DISTINCT FROM ROW(a.id,r.id,p_stripe_session_id,p_payment_intent_id,p_event_type)) THEN
    RETURN jsonb_build_object('ok',false,'code','payment_mismatch');
  END IF;
  SELECT * INTO receipt FROM public.reservation_deposit_payments
    WHERE attempt_id=a.id OR first_event_id=p_event_id
       OR stripe_session_id=p_stripe_session_id OR payment_intent_id=p_payment_intent_id;
  IF FOUND THEN
    IF receipt.attempt_id<>a.id OR receipt.reservation_id<>r.id
       OR receipt.stripe_session_id<>p_stripe_session_id
       OR receipt.payment_intent_id<>p_payment_intent_id
       OR receipt.amount_cents<>p_amount_cents OR receipt.currency<>p_currency
       OR receipt.livemode IS DISTINCT FROM p_livemode
       OR (receipt.first_event_id=p_event_id AND receipt.first_event_type<>p_event_type) THEN
      RETURN jsonb_build_object('ok',false,'code','payment_mismatch');
    END IF;
    -- Return the original recorded outcome, not a claim about current status.
    RETURN jsonb_build_object('ok',true,'reservation_id',r.id,'attempt_id',a.id,
      'payment_id',receipt.id,'outcome',receipt.outcome,'review_reason',receipt.review_reason,
      'balance_applied',receipt.balance_applied,'already_processed',true);
  END IF;

  v_balance_safe:=r.amount_paid_cents=0
    AND r.payment_status IN ('unpaid','deposit_pending')
    AND r.deposit_required_cents=a.deposit_amount_cents
    AND r.grand_total_cents>=p_amount_cents
    AND r.remaining_balance_cents=r.grand_total_cents;
  IF NOT v_balance_safe THEN v_reason:='financial_state_requires_review';
  ELSIF NOT public.deposit_approval_ok_0022(r) THEN v_reason:='approval_required';
  ELSIF r.status NOT IN ('pending_review','confirmed','balance_due','ready_for_service') THEN
    v_reason:='reservation_status_requires_review';
  ELSIF h.id IS NULL OR h.id<>a.capacity_hold_id THEN v_reason:='capacity_hold_requires_review';
  ELSIF h.released_at IS NOT NULL OR h.state<>'held' THEN v_reason:='capacity_not_held';
  ELSIF h.hold_deadline<>a.hold_deadline_at OR h.party_size<>r.party_size THEN
    v_reason:='capacity_snapshot_mismatch';
  ELSIF h.seating_end<=clock_timestamp() THEN v_reason:='service_has_ended';
  ELSIF a.state<>'open' THEN v_reason:='attempt_state_requires_review';
  END IF;
  -- Deadline passage alone does not free capacity: a paid, unreleased hold
  -- may still be allocated. Cancelled/released reservations never reopen.
  INSERT INTO public.reservation_deposit_payments
    (reservation_id,attempt_id,stripe_session_id,payment_intent_id,first_event_id,
     first_event_type,amount_cents,currency,livemode,outcome,review_reason,balance_applied)
  VALUES (r.id,a.id,p_stripe_session_id,p_payment_intent_id,p_event_id,p_event_type,
    p_amount_cents,p_currency,p_livemode,
    CASE WHEN v_reason IS NULL THEN 'applied' ELSE 'review_required' END,
    v_reason,v_balance_safe) RETURNING * INTO receipt;

  UPDATE public.reservation_checkout_attempts
    SET stripe_session_id=p_stripe_session_id,state='succeeded',updated_by=NULL WHERE id=a.id;
  IF v_balance_safe THEN
    v_status:=CASE WHEN v_reason IS NULL AND r.status='pending_review'
      THEN 'confirmed' ELSE r.status END;
    UPDATE public.reservations SET
      amount_paid_cents=p_amount_cents,
      remaining_balance_cents=grand_total_cents-p_amount_cents,
      payment_status=CASE WHEN p_amount_cents=grand_total_cents THEN 'paid_in_full' ELSE 'deposit_paid' END,
      status=v_status,updated_by=NULL WHERE id=r.id;
    IF v_status<>r.status THEN
      INSERT INTO public.reservation_status_history
        (reservation_id,previous_status,new_status,reason,created_by)
      VALUES(r.id,r.status,v_status,'Deposit verified by Stripe.',NULL);
    END IF;
  END IF;
  IF v_reason IS NULL THEN
    v_allocation:=public.confirm_reservation_capacity_atomic(r.id,NULL);
    IF (v_allocation->>'ok') IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Capacity allocation failed';
    END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'reservation_id',r.id,'attempt_id',a.id,
    'payment_id',receipt.id,'outcome',receipt.outcome,'review_reason',receipt.review_reason,
    'balance_applied',receipt.balance_applied,'already_processed',false);
EXCEPTION
  WHEN unique_violation OR serialization_failure OR deadlock_detected OR lock_not_available THEN
    RETURN jsonb_build_object('ok',false,'code','conflict');
  WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'code','unexpected');
END $$;


ALTER TABLE public.reservation_balance_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_balance_overrides FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.reservation_balance_overrides TO service_role;
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN (
      'management_actor_0022','deposit_approval_ok_0022','set_approval_requirement_0022',
      'immutable_approval_0022','guard_reservation_approval_0022',
      'prepare_checkout_before_0022','record_checkout_before_0022','confirm_reservation_before_0022',
      'confirm_capacity_before_0022','confirm_reservation_capacity_atomic',
      'approve_reservation_for_payment_atomic','prepare_checkout_session_atomic',
      'record_checkout_session','confirm_reservation_atomic','apply_verified_reservation_deposit_atomic')
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f); END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.approve_reservation_for_payment_atomic(uuid,uuid,timestamptz,text,integer,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_checkout_session_atomic(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_checkout_session(uuid,uuid,varchar,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_reservation_atomic(uuid,timestamptz,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_reservation_capacity_atomic(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_verified_reservation_deposit_atomic(text,text,uuid,uuid,text,text,integer,text,boolean,text,text) TO service_role;
COMMENT ON TABLE public.reservation_balance_overrides IS
  'Immutable management approval and effective balance deadline. At-check-in means due at seating start, not payment received. Changes after approval require explicit reconciliation. No email or balance-collection integration.';
COMMIT;