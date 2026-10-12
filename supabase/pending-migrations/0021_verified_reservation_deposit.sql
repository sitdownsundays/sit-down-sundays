-- Apply ONCE after the reviewed 0020. Sandbox payment recording only.
-- The trusted server MUST verify Stripe signature, Session and PaymentIntent.
-- This RPC never calls Stripe and is never callable by browser roles.
BEGIN;

-- A paid webhook can arrive before the Checkout-create response is recorded.
-- Stripe may no longer supply a URL for a completed Session. Permit ID-only
-- binding; keep the existing rule that succeeded attempts require an ID.
DO $$
DECLARE c record; n integer:=0;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid='public.reservation_checkout_attempts'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%stripe_session_id IS NULL%'
      AND pg_get_constraintdef(oid) LIKE '%stripe_session_url IS NULL%'
  LOOP
    EXECUTE format('ALTER TABLE public.reservation_checkout_attempts DROP CONSTRAINT %I',c.conname);
    n:=n+1;
  END LOOP;
  IF n<>1 THEN RAISE EXCEPTION 'Expected reviewed 0020 session-pair constraint'; END IF;
END $$;
ALTER TABLE public.reservation_checkout_attempts
  ADD CONSTRAINT checkout_url_requires_session_id
  CHECK (stripe_session_url IS NULL OR stripe_session_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.guard_checkout_attempt_0020()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF ROW(NEW.id,NEW.reservation_id,NEW.capacity_hold_id,
         NEW.stripe_idempotency_key,NEW.deposit_amount_cents,NEW.currency,
         NEW.success_url,NEW.cancel_url,NEW.hold_deadline_at,NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id,OLD.reservation_id,OLD.capacity_hold_id,
      OLD.stripe_idempotency_key,OLD.deposit_amount_cents,OLD.currency,
         OLD.success_url,OLD.cancel_url,OLD.hold_deadline_at,OLD.created_at) THEN
    RAISE EXCEPTION 'Checkout attempt parameters are immutable';
  END IF;
  IF OLD.stripe_session_id IS NOT NULL
     AND NEW.stripe_session_id IS DISTINCT FROM OLD.stripe_session_id THEN
    RAISE EXCEPTION 'Checkout session identity is immutable';
  END IF;
  IF OLD.stripe_session_url IS NOT NULL
     AND NEW.stripe_session_url IS DISTINCT FROM OLD.stripe_session_url THEN
    RAISE EXCEPTION 'Recorded Checkout URL is immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE public.reservation_deposit_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL UNIQUE REFERENCES public.reservation_checkout_attempts(id) ON DELETE RESTRICT,
  stripe_session_id text NOT NULL UNIQUE CHECK (stripe_session_id ~ '^cs_test_[A-Za-z0-9_]+$'),
  payment_intent_id text NOT NULL UNIQUE CHECK (payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  first_event_id text NOT NULL UNIQUE CHECK (first_event_id ~ '^evt_[A-Za-z0-9_]+$'),
  first_event_type text NOT NULL CHECK (first_event_type IN
    ('checkout.session.completed','checkout.session.async_payment_succeeded')),
  amount_cents integer NOT NULL CHECK (amount_cents>0),
  currency text NOT NULL CHECK (currency='usd'),
  livemode boolean NOT NULL CHECK (livemode=false),
  outcome text NOT NULL CHECK (outcome IN ('applied','review_required')),
  review_reason text,
  balance_applied boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK ((outcome='applied' AND review_reason IS NULL AND balance_applied)
      OR (outcome='review_required' AND review_reason IS NOT NULL))
);
CREATE FUNCTION public.protect_deposit_payment_0021()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN RAISE EXCEPTION 'Deposit payment receipts are append-only'; END $$;
CREATE TRIGGER trg_deposit_payment_immutable
  BEFORE UPDATE OR DELETE ON public.reservation_deposit_payments
  FOR EACH ROW EXECUTE FUNCTION public.protect_deposit_payment_0021();
CREATE TRIGGER trg_deposit_payment_audit
  AFTER INSERT ON public.reservation_deposit_payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_cms_change();

CREATE FUNCTION public.apply_verified_reservation_deposit_atomic(
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

ALTER TABLE public.reservation_deposit_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_deposit_payments FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.reservation_deposit_payments TO service_role;
REVOKE ALL ON FUNCTION public.protect_deposit_payment_0021() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.guard_checkout_attempt_0020() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.apply_verified_reservation_deposit_atomic(
  text,text,uuid,uuid,text,text,integer,text,boolean,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.apply_verified_reservation_deposit_atomic(
  text,text,uuid,uuid,text,text,integer,text,boolean,text,text) TO service_role;
COMMENT ON TABLE public.reservation_deposit_payments IS
  'Immutable verified sandbox deposit receipts. Review-required receipts retain payment evidence but never reopen cancelled reservations or reclaim released capacity. No refunds or emails are issued.';
COMMIT;