-- Replacement 0020. Apply ONCE, only if no version of 0020 was applied.
-- Requires 0019. Does not activate capacity or collect/confirm payments.
-- MVP: one permanent deposit attempt per reservation. No automatic replacement.
BEGIN;

CREATE TABLE public.reservation_checkout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL UNIQUE
    REFERENCES public.reservations(id) ON DELETE RESTRICT,
  capacity_hold_id uuid NOT NULL UNIQUE
    REFERENCES public.reservation_capacity_holds(id) ON DELETE RESTRICT,
  stripe_idempotency_key varchar(200) NOT NULL UNIQUE
    CHECK (btrim(stripe_idempotency_key) <> ''),
  deposit_amount_cents integer NOT NULL CHECK (deposit_amount_cents > 0),
  currency varchar(3) NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  success_url text NOT NULL CHECK (success_url ~ '^https://[^[:space:]]+$'),
  cancel_url text NOT NULL CHECK (cancel_url ~ '^https://[^[:space:]]+$'),
  hold_deadline_at timestamptz NOT NULL CHECK (isfinite(hold_deadline_at)),
  state varchar(20) NOT NULL DEFAULT 'open'
    CHECK (state IN ('open','succeeded','expired','cancelled')),
  stripe_session_id varchar(200) UNIQUE
    CHECK (stripe_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  stripe_session_url text
    CHECK (stripe_session_url ~ '^https://checkout[.]stripe[.]com/[^[:space:]]+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK ((stripe_session_id IS NULL) = (stripe_session_url IS NULL)),
  CHECK (state <> 'succeeded' OR stripe_session_id IS NOT NULL)
);

CREATE FUNCTION public.guard_checkout_attempt_0020()
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
  IF OLD.stripe_session_id IS NOT NULL AND
     ROW(NEW.stripe_session_id,NEW.stripe_session_url)
       IS DISTINCT FROM ROW(OLD.stripe_session_id,OLD.stripe_session_url) THEN
    RAISE EXCEPTION 'Checkout session identity is immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_checkout_attempts_immutable
  BEFORE UPDATE ON public.reservation_checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION public.guard_checkout_attempt_0020();
CREATE TRIGGER trg_checkout_attempts_updated_at
  BEFORE UPDATE ON public.reservation_checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION public.set_sundays_updated_at();
CREATE TRIGGER trg_checkout_attempts_audit
  AFTER INSERT OR UPDATE ON public.reservation_checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION public.audit_cms_change();

CREATE FUNCTION public.prepare_checkout_session_atomic(
  p_reservation_id uuid, p_actor_user_id uuid,
  p_success_url text, p_cancel_url text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  r public.reservations%ROWTYPE;
  h public.reservation_capacity_holds%ROWTYPE;
  a public.reservation_checkout_attempts%ROWTYPE;
  v_existing boolean;
  v_id uuid;
BEGIN
  IF p_actor_user_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM auth.users WHERE id=p_actor_user_id) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_actor');
  END IF;
  -- Same reservation-first lock order as capacity/cancellation operations.
  SELECT * INTO r FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  IF r.status NOT IN ('pending_review','confirmed','balance_due','ready_for_service') THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_status');
  END IF;
  IF r.deposit_required_cents=0 OR r.amount_paid_cents>=r.deposit_required_cents THEN
    RETURN jsonb_build_object('ok',false,'code','already_satisfied');
  END IF;
  -- Do not collect the full deposit again after an unexplained partial payment.
  IF r.amount_paid_cents<>0 OR r.payment_status NOT IN ('unpaid','deposit_pending') THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_status');
  END IF;
  IF r.deposit_required_cents IS NULL OR r.deposit_required_cents<=0
     OR r.deposit_required_cents>r.grand_total_cents THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_amount');
  END IF;
  SELECT * INTO h FROM public.reservation_capacity_holds
    WHERE reservation_id=r.id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','hold_not_found'); END IF;
  IF h.released_at IS NOT NULL OR h.state='released' THEN
    RETURN jsonb_build_object('ok',false,'code','hold_released');
  END IF;
  IF h.state<>'held' THEN RETURN jsonb_build_object('ok',false,'code','invalid_status'); END IF;
  IF h.hold_deadline<=clock_timestamp() THEN
    RETURN jsonb_build_object('ok',false,'code','insufficient_time');
  END IF;

  SELECT * INTO a FROM public.reservation_checkout_attempts
    WHERE reservation_id=r.id FOR UPDATE;
  v_existing:=FOUND;
  IF v_existing THEN
    IF a.state='succeeded' THEN
      RETURN jsonb_build_object('ok',false,'code','already_satisfied');
    END IF;
    IF a.state<>'open' THEN RETURN jsonb_build_object('ok',false,'code','invalid_status'); END IF;
    IF a.capacity_hold_id<>h.id OR a.hold_deadline_at<>h.hold_deadline
       OR a.deposit_amount_cents<>r.deposit_required_cents OR a.currency<>'usd' THEN
      RETURN jsonb_build_object('ok',false,'code','conflict');
    END IF;
    -- Preserve saved URLs/key/amount/deadline even if current config changed.
    -- An existing session may be reused with less than 30 minutes remaining.
  ELSE
    IF p_success_url IS NULL OR p_cancel_url IS NULL
       OR length(p_success_url)>4096 OR length(p_cancel_url)>4096
       OR p_success_url !~ '^https://[^[:space:]]+$'
       OR p_cancel_url !~ '^https://[^[:space:]]+$' THEN
      RETURN jsonb_build_object('ok',false,'code','invalid_data');
    END IF;
    IF to_timestamp(floor(extract(epoch FROM h.hold_deadline)))
         <=clock_timestamp()+interval '30 minutes'
       OR h.hold_deadline>clock_timestamp()+interval '24 hours' THEN
      RETURN jsonb_build_object('ok',false,'code','insufficient_time');
    END IF;
    v_id:=gen_random_uuid();
    INSERT INTO public.reservation_checkout_attempts
      (id,reservation_id,capacity_hold_id,stripe_idempotency_key,
       deposit_amount_cents,currency,success_url,cancel_url,hold_deadline_at,
       created_by,updated_by)
    VALUES (v_id,r.id,h.id,'sds-deposit:'||v_id::text,
      r.deposit_required_cents,'usd',p_success_url,p_cancel_url,h.hold_deadline,
      p_actor_user_id,p_actor_user_id) RETURNING * INTO a;
  END IF;
  RETURN jsonb_build_object('ok',true,'attempt_id',a.id,
    'reservation_id',a.reservation_id,'capacity_hold_id',a.capacity_hold_id,
    'stripe_idempotency_key',a.stripe_idempotency_key,
    'deposit_amount_cents',a.deposit_amount_cents,'currency',a.currency,
    'success_url',a.success_url,'cancel_url',a.cancel_url,
    'hold_deadline_at',a.hold_deadline_at,'stripe_session_id',a.stripe_session_id,
    'stripe_session_url',a.stripe_session_url,'state',a.state,
    'already_prepared',v_existing);
EXCEPTION
  WHEN unique_violation OR serialization_failure OR deadlock_detected OR lock_not_available THEN
    RETURN jsonb_build_object('ok',false,'code','conflict');
  WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'code','unexpected');
END $$;

CREATE FUNCTION public.record_checkout_session(
  p_attempt_id uuid, p_actor_user_id uuid,
  p_stripe_session_id varchar, p_stripe_session_url text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_reservation_id uuid;
  r public.reservations%ROWTYPE;
  h public.reservation_capacity_holds%ROWTYPE;
  a public.reservation_checkout_attempts%ROWTYPE;
  v_recorded boolean;
BEGIN
  IF p_actor_user_id IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM auth.users WHERE id=p_actor_user_id) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_actor');
  END IF;
  IF p_stripe_session_id IS NULL OR length(p_stripe_session_id)>200
     OR p_stripe_session_id !~ '^cs_[A-Za-z0-9_]+$'
     OR p_stripe_session_url IS NULL OR length(p_stripe_session_url)>8192
     OR p_stripe_session_url !~ '^https://checkout[.]stripe[.]com/[^[:space:]]+$' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_data');
  END IF;
  -- Read identity first, then acquire locks in the same order as prepare.
  SELECT reservation_id INTO v_reservation_id
    FROM public.reservation_checkout_attempts WHERE id=p_attempt_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  SELECT * INTO r FROM public.reservations WHERE id=v_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  SELECT * INTO h FROM public.reservation_capacity_holds
    WHERE reservation_id=r.id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','hold_not_found'); END IF;
  SELECT * INTO a FROM public.reservation_checkout_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  IF a.stripe_session_id IS NOT NULL AND
     ROW(a.stripe_session_id,a.stripe_session_url)
       IS DISTINCT FROM ROW(p_stripe_session_id,p_stripe_session_url) THEN
    RETURN jsonb_build_object('ok',false,'code','session_mismatch');
  END IF;
  v_recorded:=a.stripe_session_id IS NOT NULL;
  IF NOT v_recorded THEN
    UPDATE public.reservation_checkout_attempts
      SET stripe_session_id=p_stripe_session_id,stripe_session_url=p_stripe_session_url,
          updated_by=p_actor_user_id WHERE id=a.id RETURNING * INTO a;
  END IF;
  -- Preserve Stripe identity even if eligibility changed during the network call.
  -- These returns COMMIT the identity, but do not offer an unsafe payment link.
  -- No Stripe expiry/refund/reconciliation is performed by this migration.
  IF a.state='succeeded' OR r.amount_paid_cents>=r.deposit_required_cents THEN
    RETURN jsonb_build_object('ok',false,'code','already_satisfied');
  END IF;
  IF a.state<>'open'
     OR r.status NOT IN ('pending_review','confirmed','balance_due','ready_for_service')
     OR r.amount_paid_cents<>0 OR r.payment_status NOT IN ('unpaid','deposit_pending') THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_status');
  END IF;
  IF h.released_at IS NOT NULL OR h.state='released' THEN
    RETURN jsonb_build_object('ok',false,'code','hold_released');
  END IF;
  IF h.state<>'held' OR h.id<>a.capacity_hold_id
     OR h.hold_deadline<>a.hold_deadline_at
     OR r.deposit_required_cents<>a.deposit_amount_cents THEN
    RETURN jsonb_build_object('ok',false,'code','conflict');
  END IF;
  IF h.hold_deadline<=clock_timestamp() THEN
    RETURN jsonb_build_object('ok',false,'code','insufficient_time');
  END IF;
  RETURN jsonb_build_object('ok',true,'attempt_id',a.id,'state',a.state,
    'stripe_session_id',a.stripe_session_id,'stripe_session_url',a.stripe_session_url,
    'already_recorded',v_recorded);
EXCEPTION
  WHEN unique_violation OR serialization_failure OR deadlock_detected OR lock_not_available THEN
    RETURN jsonb_build_object('ok',false,'code','conflict');
  WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'code','unexpected');
END $$;

ALTER TABLE public.reservation_checkout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reservation_checkout_attempts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.reservation_checkout_attempts TO service_role;
REVOKE ALL ON FUNCTION public.guard_checkout_attempt_0020() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.prepare_checkout_session_atomic(uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.record_checkout_session(uuid,uuid,varchar,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_checkout_session_atomic(uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_checkout_session(uuid,uuid,varchar,text) TO service_role;

COMMENT ON TABLE public.reservation_checkout_attempts IS
  'One durable deposit attempt per reservation. Immutable retry inputs. Session creation/recording is not proof of payment. Terminal attempts are not automatically replaced.';
COMMIT;