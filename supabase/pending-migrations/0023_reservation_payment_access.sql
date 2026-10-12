-- 0023: initial guest payment-access binding. Apply ONCE after 0022.
-- Additive/staged: existing submission functions remain unchanged.
-- The application must explicitly adopt the new 30-argument RPC later.
-- No public endpoint, activation, Checkout, email, or payment/status changes.
BEGIN;

CREATE TABLE public.reservation_payment_access (
  reservation_id uuid PRIMARY KEY REFERENCES public.reservations(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  revoked_at timestamptz CHECK (revoked_at IS NULL OR isfinite(revoked_at)),
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

COMMENT ON TABLE public.reservation_payment_access IS
  'Initial guest bearer-credential hashes, bound only during new atomic submission. No raw tokens. No legacy backfill. Binding is not approval, payment, or authorization by reservation ID. Server must verify the raw token, expiry, revocation, and current payment eligibility before returning any Checkout link.';
COMMENT ON COLUMN public.reservation_payment_access.expires_at IS
  'Fixed from the capacity hold seating_end at creation; independent of the two-hour deposit deadline. An approval waiting period does not renew this credential. Checkout still enforces its own approval and hold deadline.';

ALTER TABLE public.reservation_payment_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reservation_payment_access FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.reservation_payment_access TO service_role;

CREATE FUNCTION public.guard_payment_access_0023() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment-access bindings cannot be deleted';
  END IF;
  IF ROW(NEW.reservation_id, NEW.token_hash, NEW.created_at, NEW.expires_at)
     IS DISTINCT FROM
     ROW(OLD.reservation_id, OLD.token_hash, OLD.created_at, OLD.expires_at)
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'Payment-access binding is immutable; revocation cannot be undone';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payment_access_immutable BEFORE UPDATE OR DELETE
  ON public.reservation_payment_access FOR EACH ROW
  EXECUTE FUNCTION public.guard_payment_access_0023();
REVOKE ALL ON FUNCTION public.guard_payment_access_0023()
  FROM PUBLIC, anon, authenticated, service_role;

-- This is not an ownership-claim or token-issuance endpoint.
-- Only a trusted server can call it; the raw credential must be generated
-- and retained BEFORE submission, and the same credential retained on retry.
-- The 29 established arguments and financial payload hash keep their meaning.
CREATE FUNCTION public.submit_reservation_request_with_payment_access_atomic(
  p_reservation_number varchar, p_contact_first_name varchar, p_contact_last_name varchar,
  p_contact_email varchar, p_contact_phone varchar, p_sunday_service_id uuid, p_seating_time_id uuid,
  p_experience_type varchar, p_private_room_id uuid, p_party_size integer, p_adults integer,
  p_seniors integer, p_children integer, p_guest_notes text, p_dietary_notes text,
  p_accessibility_requests text, p_occasion varchar, p_subtotal_cents integer,
  p_deposit_required_cents integer, p_grand_total_cents integer, p_remaining_balance_cents integer,
  p_balance_deadline timestamptz, p_pricing_snapshot jsonb, p_policy_snapshot jsonb,
  p_guests jsonb, p_platters jsonb, p_idempotency_key varchar, p_payload_hash varchar,
  p_actor_user_id uuid, p_payment_access_token_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  result jsonb;
  r public.reservations%ROWTYPE;
  h public.reservation_capacity_holds%ROWTYPE;
  access_row public.reservation_payment_access%ROWTYPE;
  rid uuid;
BEGIN
  IF p_payment_access_token_hash IS NULL
     OR p_payment_access_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_payment_access');
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = ''
     OR p_payload_hash IS NULL OR btrim(p_payload_hash) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_data');
  END IF;

  -- Same lock namespace/order as 0019; concurrent same-key calls serialize.
  PERFORM pg_advisory_xact_lock(hashtextextended('sds-capacity-submit:' || p_idempotency_key, 19));
  result := public.submit_reservation_request_with_capacity_atomic(
    p_reservation_number, p_contact_first_name, p_contact_last_name, p_contact_email, p_contact_phone,
    p_sunday_service_id, p_seating_time_id, p_experience_type, p_private_room_id, p_party_size,
    p_adults, p_seniors, p_children, p_guest_notes, p_dietary_notes, p_accessibility_requests,
    p_occasion, p_subtotal_cents, p_deposit_required_cents, p_grand_total_cents,
    p_remaining_balance_cents, p_balance_deadline, p_pricing_snapshot, p_policy_snapshot,
    p_guests, p_platters, p_idempotency_key, p_payload_hash, p_actor_user_id);

  IF result->'ok' = 'false'::jsonb THEN RETURN result; END IF;
  IF result->'ok' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'Submission response could not be verified';
  END IF;
  rid := (result->>'reservation_id')::uuid;
  SELECT * INTO STRICT r FROM public.reservations WHERE id = rid FOR UPDATE;
  IF r.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR r.payload_hash IS DISTINCT FROM p_payload_hash THEN
    RAISE EXCEPTION 'Submission identity could not be verified';
  END IF;

  IF result->'idempotent_replay' = 'true'::jsonb THEN
    SELECT * INTO access_row FROM public.reservation_payment_access WHERE reservation_id = rid;
    -- Never attach/replace a credential on replay, including historical rows.
    IF NOT FOUND OR access_row.token_hash IS DISTINCT FROM p_payment_access_token_hash THEN
      RETURN jsonb_build_object('ok', false, 'code', 'payment_access_mismatch');
    END IF;
  ELSE
    IF result ? 'idempotent_replay' AND result->'idempotent_replay' IS DISTINCT FROM 'false'::jsonb THEN
      RAISE EXCEPTION 'Submission replay state could not be verified';
    END IF;
    SELECT * INTO STRICT h FROM public.reservation_capacity_holds WHERE reservation_id = rid;
    IF h.state <> 'held' OR h.released_at IS NOT NULL
       OR NOT isfinite(h.seating_end) OR h.seating_end <= clock_timestamp() THEN
      RAISE EXCEPTION 'New reservation capacity could not be verified';
    END IF;
    INSERT INTO public.reservation_payment_access(reservation_id, token_hash, expires_at)
      VALUES (rid, p_payment_access_token_hash, h.seating_end);
  END IF;

  -- Means the original binding matches, NOT that payment is currently allowed.
  -- Replay never extends expiry, clears revocation, or renews a capacity hold.
  RETURN result || jsonb_build_object('payment_access_bound', true);
EXCEPTION
  WHEN serialization_failure OR deadlock_detected OR lock_not_available THEN
    RETURN jsonb_build_object('ok', false, 'code', 'conflict');
  WHEN OTHERS THEN
    -- This exception block rolls back new reservation/guest/history/hold/access
    -- writes together. Never return raw SQL diagnostics or credential hashes.
    RETURN jsonb_build_object('ok', false, 'code', 'unexpected');
END $$;

REVOKE ALL ON FUNCTION public.submit_reservation_request_with_payment_access_atomic(
  varchar,varchar,varchar,varchar,varchar,uuid,uuid,varchar,uuid,integer,integer,integer,integer,
  text,text,text,varchar,integer,integer,integer,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,
  varchar,varchar,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_reservation_request_with_payment_access_atomic(
  varchar,varchar,varchar,varchar,varchar,uuid,uuid,varchar,uuid,integer,integer,integer,integer,
  text,text,text,varchar,integer,integer,integer,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,
  varchar,varchar,uuid,text) TO service_role;

COMMIT;
