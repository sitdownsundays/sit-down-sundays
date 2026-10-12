-- Sit Down Sundays: REPLACEMENT for the UNAPPLIED 0019 only.
-- Do not run on top of an already-applied 0019. Apply once as database owner.
-- Requires applied 0012, existing venue/service/seating tables and audit helpers.
-- Reuses the existing 29-argument submission RPC; does NOT copy/rewrite 0012.
-- Installation does NOT enable capacity enforcement. capacity_control.ready is
-- initially false. Reconcile existing future reservations before activation.
-- No Stripe, email, refunds, automatic expiry, or change to public room routing.
--
-- LOCK PROTOCOL: reservation row first (when one exists), then UPDATE the single
-- capacity_control row. The revision write serializes ALL capacity mutations,
-- including configuration, across rooms. This conservative MVP mutex also makes
-- repeatable-read stale writers fail with serialization_failure, not oversell.
-- It is held only for a short DB transaction, never across a Stripe/network call.
-- Same-key submissions additionally take a transaction advisory lock first.
-- Application permissions remain authoritative; RPCs are service-role-only.
-- NULL actor means trusted server/system, NOT anonymous direct database access.
BEGIN;

CREATE TABLE public.capacity_control (
  id smallint PRIMARY KEY CHECK (id = 1),
  ready boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0,
  activated_at timestamptz,
  activated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
INSERT INTO public.capacity_control(id) VALUES (1);

CREATE TABLE public.capacity_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid REFERENCES public.venue_spaces(id) ON DELETE RESTRICT,
  name varchar(120) NOT NULL CHECK (btrim(name) <> ''),
  total_capacity integer NOT NULL CHECK (total_capacity > 0),
  parent_id uuid REFERENCES public.capacity_resources(id) ON DELETE RESTRICT,
  resource_type varchar(20) NOT NULL CHECK (resource_type IN ('standalone','whole','section')),
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (id IS DISTINCT FROM parent_id),
  CHECK ((resource_type = 'section' AND parent_id IS NOT NULL AND space_id IS NOT NULL)
      OR (resource_type = 'standalone' AND parent_id IS NULL AND space_id IS NOT NULL)
      OR (resource_type = 'whole' AND parent_id IS NULL AND space_id IS NULL))
);
CREATE UNIQUE INDEX uniq_capacity_resources_space ON public.capacity_resources(space_id)
  WHERE space_id IS NOT NULL;
CREATE INDEX idx_capacity_resources_parent ON public.capacity_resources(parent_id);

CREATE TABLE public.reservation_capacity_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE RESTRICT,
  capacity_resource_id uuid NOT NULL REFERENCES public.capacity_resources(id) ON DELETE RESTRICT,
  party_size integer NOT NULL CHECK (party_size > 0),
  seating_start timestamptz NOT NULL,
  seating_end timestamptz NOT NULL,
  hold_deadline timestamptz NOT NULL CHECK (isfinite(hold_deadline)),
  state varchar(20) NOT NULL DEFAULT 'held' CHECK (state IN ('held','allocated','released')),
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK (isfinite(seating_start) AND isfinite(seating_end) AND seating_end > seating_start),
  CHECK ((state = 'released' AND released_at IS NOT NULL AND isfinite(released_at))
      OR (state <> 'released' AND released_at IS NULL)),
  -- A released request cannot silently acquire a fresh two-hour window.
  -- Moving/rebooking a released request needs a separate reviewed workflow.
  CONSTRAINT uniq_capacity_hold_reservation UNIQUE (reservation_id)
);
CREATE INDEX idx_capacity_holds_resource ON public.reservation_capacity_holds(capacity_resource_id);
CREATE INDEX idx_capacity_holds_active_interval ON public.reservation_capacity_holds
  USING gist (tstzrange(seating_start,seating_end,'[)')) WHERE released_at IS NULL;

-- Explicit WHOLE-versus-SECTION choice is service configuration, not an
-- invented party-size threshold. NULL uses the resource mapped to service.space_id.
-- An override may select the mapped section's whole parent, never another room.
ALTER TABLE public.sunday_services ADD COLUMN capacity_resource_id uuid
  REFERENCES public.capacity_resources(id) ON DELETE RESTRICT;

CREATE FUNCTION public.capacity_lock_0019() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.capacity_control SET revision = revision + 1 WHERE id = 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Capacity control missing'; END IF;
END $$;

-- Cross-row hierarchy validation: local CHECK constraints alone are NOT enough.
CREATE FUNCTION public.capacity_resource_guard_0019() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_parent public.capacity_resources%ROWTYPE; v_root uuid;
BEGIN
  PERFORM public.capacity_lock_0019();
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
       OR NEW.resource_type IS DISTINCT FROM OLD.resource_type
       OR NEW.space_id IS DISTINCT FROM OLD.space_id THEN
      RAISE EXCEPTION 'Resource identity and hierarchy require a reviewed migration';
    END IF;
    v_root := COALESCE(OLD.parent_id,OLD.id);
    IF (NEW.total_capacity < OLD.total_capacity OR (OLD.is_active AND NOT NEW.is_active))
       AND EXISTS (
         SELECT 1 FROM public.reservation_capacity_holds h
         JOIN public.capacity_resources c ON c.id=h.capacity_resource_id
         WHERE COALESCE(c.parent_id,c.id)=v_root AND h.released_at IS NULL
           AND h.seating_end > clock_timestamp()
       ) THEN
      RAISE EXCEPTION 'Reconcile current family reservations before reducing or disabling capacity';
    END IF;
  END IF;
  IF NEW.resource_type = 'section' THEN
    SELECT * INTO v_parent FROM public.capacity_resources WHERE id=NEW.parent_id;
    IF NOT FOUND OR v_parent.resource_type <> 'whole' OR v_parent.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'A section requires a whole-room parent';
    END IF;
    IF NEW.is_active AND NOT v_parent.is_active THEN
      RAISE EXCEPTION 'An active section requires an active parent';
    END IF;
    IF NEW.total_capacity::bigint + COALESCE((SELECT SUM(total_capacity)
         FROM public.capacity_resources WHERE parent_id=NEW.parent_id AND id<>NEW.id),0)
         > v_parent.total_capacity THEN
      RAISE EXCEPTION 'Section capacities exceed the whole room';
    END IF;
  ELSIF NEW.resource_type='whole' THEN
    IF COALESCE((SELECT SUM(total_capacity) FROM public.capacity_resources
                WHERE parent_id=NEW.id),0) > NEW.total_capacity THEN
      RAISE EXCEPTION 'Whole-room capacity is smaller than its sections';
    END IF;
    IF NOT NEW.is_active AND EXISTS(SELECT 1 FROM public.capacity_resources
                                   WHERE parent_id=NEW.id AND is_active) THEN
      RAISE EXCEPTION 'Disable sections before disabling their parent';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_capacity_resource_guard BEFORE INSERT OR UPDATE ON public.capacity_resources
  FOR EACH ROW EXECUTE FUNCTION public.capacity_resource_guard_0019();

CREATE TRIGGER trg_capacity_resources_updated_at BEFORE UPDATE ON public.capacity_resources
  FOR EACH ROW EXECUTE FUNCTION public.set_sundays_updated_at();
CREATE TRIGGER trg_capacity_resources_audit AFTER INSERT OR UPDATE ON public.capacity_resources
  FOR EACH ROW EXECUTE FUNCTION public.audit_cms_change();
CREATE TRIGGER trg_capacity_holds_updated_at BEFORE UPDATE ON public.reservation_capacity_holds
  FOR EACH ROW EXECUTE FUNCTION public.set_sundays_updated_at();
CREATE TRIGGER trg_capacity_holds_audit AFTER INSERT OR UPDATE ON public.reservation_capacity_holds
  FOR EACH ROW EXECUTE FUNCTION public.audit_cms_change();

DO $$
DECLARE b uuid; s1 uuid; s2 uuid; p uuid;
BEGIN
  SELECT id INTO STRICT b FROM public.venue_spaces WHERE slug='grand-ballroom';
  SELECT id INTO STRICT s1 FROM public.venue_spaces WHERE slug='mayoral-room-1';
  SELECT id INTO STRICT s2 FROM public.venue_spaces WHERE slug='mayoral-room-2';
  INSERT INTO public.capacity_resources(name,total_capacity,resource_type,display_order)
    VALUES ('Mayoral Room',120,'whole',2) RETURNING id INTO p;
  INSERT INTO public.capacity_resources(space_id,name,total_capacity,parent_id,resource_type,display_order)
    VALUES (b,'Grand Ballroom',950,NULL,'standalone',1),
           (s1,'Mayoral Room — Section 1',60,p,'section',3),
           (s2,'Mayoral Room — Section 2',60,p,'section',4);
EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION 'Expected exactly one existing room for each configured slug; inspect venue_spaces. Do not reapply 0008.';
END $$;

CREATE FUNCTION public.capacity_resource_for_service_0019(p_service_id uuid) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.sunday_services%ROWTYPE; m public.capacity_resources%ROWTYPE;
        c public.capacity_resources%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.sunday_services WHERE id=p_service_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO m FROM public.capacity_resources WHERE space_id=s.space_id;
  IF NOT FOUND OR NOT m.is_active THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.capacity_resources WHERE id=COALESCE(s.capacity_resource_id,m.id);
  IF NOT FOUND OR NOT c.is_active THEN RETURN NULL; END IF;
  IF c.id <> m.id AND NOT (c.resource_type='whole' AND m.parent_id=c.id) THEN RETURN NULL; END IF;
  IF c.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.capacity_resources WHERE id=c.parent_id AND resource_type='whole' AND is_active
  ) THEN RETURN NULL; END IF;
  RETURN c.id;
END $$;

CREATE FUNCTION public.resolve_capacity_resource_for_reservation(p_reservation_id uuid) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.capacity_resource_for_service_0019(sunday_service_id)
    FROM public.reservations WHERE id=p_reservation_id
$$;

-- Peak simultaneous usage, not the sum of all bookings touching the requested
-- interval. Group same-time start/end deltas so back-to-back is [start,end).
CREATE FUNCTION public.capacity_peak_0019(p_ids uuid[], p_start timestamptz,p_end timestamptz)
RETURNS bigint LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH events AS (
    SELECT greatest(seating_start,p_start) AS t, party_size::bigint AS delta
    FROM public.reservation_capacity_holds
    WHERE capacity_resource_id=ANY(p_ids) AND released_at IS NULL
      AND seating_start<p_end AND seating_end>p_start
    UNION ALL
    SELECT least(seating_end,p_end), -party_size::bigint
    FROM public.reservation_capacity_holds
    WHERE capacity_resource_id=ANY(p_ids) AND released_at IS NULL
      AND seating_start<p_end AND seating_end>p_start
  ), grouped AS (SELECT t,SUM(delta) AS delta FROM events GROUP BY t),
  running AS (SELECT SUM(delta) OVER (ORDER BY t) AS n FROM grouped)
  SELECT COALESCE(MAX(n),0)::bigint FROM running
$$;

CREATE FUNCTION public.acquire_reservation_capacity_atomic(
  p_reservation_id uuid,p_capacity_resource_id uuid,p_actor_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.reservations%ROWTYPE; c public.capacity_resources%ROWTYPE;
  s public.sunday_services%ROWTYPE; st public.seating_times%ROWTYPE;
  h public.reservation_capacity_holds%ROWTYPE; ids uuid[]; root uuid;
  tz text; starts timestamptz; ends timestamptz; avail bigint; parent_cap integer;
BEGIN
  IF p_actor_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor_user_id) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_actor'); END IF;
  SELECT * INTO r FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  PERFORM public.capacity_lock_0019();
  SELECT * INTO h FROM public.reservation_capacity_holds WHERE reservation_id=r.id;
  IF FOUND THEN
    IF h.capacity_resource_id IS DISTINCT FROM p_capacity_resource_id THEN
      RETURN jsonb_build_object('ok',false,'code','resource_mismatch'); END IF;
    IF h.released_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','hold_released'); END IF;
    -- Original hold/deadline is authoritative on replay, including after expiry.
    RETURN jsonb_build_object('ok',true,'hold_id',h.id,'hold_deadline',h.hold_deadline,
      'state',h.state,'already_held',true,'seating_start',h.seating_start,'seating_end',h.seating_end);
  END IF;
  IF r.status NOT IN ('pending_review','confirmed','balance_due','paid_in_full','ready_for_service') THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_status'); END IF;
  IF p_capacity_resource_id IS NULL OR p_capacity_resource_id IS DISTINCT FROM
      public.resolve_capacity_resource_for_reservation(r.id) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_configuration'); END IF;
  SELECT * INTO c FROM public.capacity_resources WHERE id=p_capacity_resource_id;
  SELECT * INTO s FROM public.sunday_services WHERE id=r.sunday_service_id;
  IF NOT FOUND OR NOT s.is_active OR s.status<>'open' OR NOT EXISTS (
    SELECT 1 FROM public.venue_spaces WHERE id=s.space_id AND is_active AND space_type<>'not_bookable'
  ) THEN RETURN jsonb_build_object('ok',false,'code','invalid_configuration'); END IF;
  SELECT * INTO st FROM public.seating_times WHERE id=r.seating_time_id AND sunday_service_id=s.id;
  IF NOT FOUND OR NOT st.is_active THEN RETURN jsonb_build_object('ok',false,'code','invalid_configuration'); END IF;
  SELECT btrim(restaurant_timezone) INTO tz FROM public.payment_policy WHERE id=1;
  IF tz IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=tz) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_configuration'); END IF;
  starts := (s.date+st.start_time::time) AT TIME ZONE tz;
  ends := (s.date+st.end_time::time) AT TIME ZONE tz;
  IF NOT isfinite(starts) OR NOT isfinite(ends) OR ends<=starts OR starts<=clock_timestamp()
     OR r.party_size IS NULL OR r.party_size<=0 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_data'); END IF;
  root := COALESCE(c.parent_id,c.id);
  SELECT array_agg(id ORDER BY id) INTO ids FROM public.capacity_resources WHERE id=root OR parent_id=root;
  IF c.resource_type='whole' THEN
    -- Whole-room MODE and divided-section MODE cannot overlap. Parties using
    -- whole-room mode still share the 120-person inventory by actual headcount;
    -- a small party does not silently purchase exclusive use of the entire room.
    IF EXISTS(SELECT 1 FROM public.reservation_capacity_holds
      WHERE capacity_resource_id=ANY(ids) AND capacity_resource_id<>c.id
        AND released_at IS NULL AND seating_start<ends AND seating_end>starts) THEN
      RETURN jsonb_build_object('ok',false,'code','insufficient_capacity'); END IF;
    avail := c.total_capacity-public.capacity_peak_0019(ARRAY[c.id],starts,ends);
  ELSIF c.resource_type='section' THEN
    IF EXISTS(SELECT 1 FROM public.reservation_capacity_holds
      WHERE capacity_resource_id=root AND released_at IS NULL AND seating_start<ends AND seating_end>starts) THEN
      RETURN jsonb_build_object('ok',false,'code','insufficient_capacity'); END IF;
    SELECT total_capacity INTO parent_cap FROM public.capacity_resources WHERE id=root;
    avail := LEAST(c.total_capacity-public.capacity_peak_0019(ARRAY[c.id],starts,ends),
                  parent_cap-public.capacity_peak_0019(ids,starts,ends));
  ELSE
    avail := c.total_capacity-public.capacity_peak_0019(ARRAY[c.id],starts,ends);
  END IF;
  IF avail<r.party_size THEN RETURN jsonb_build_object('ok',false,'code','insufficient_capacity'); END IF;
  INSERT INTO public.reservation_capacity_holds(reservation_id,capacity_resource_id,party_size,
      seating_start,seating_end,hold_deadline,created_by,updated_by)
    VALUES(r.id,c.id,r.party_size,starts,ends,clock_timestamp()+interval '2 hours',p_actor_user_id,p_actor_user_id)
    RETURNING * INTO h;
  RETURN jsonb_build_object('ok',true,'hold_id',h.id,'hold_deadline',h.hold_deadline,
    'state',h.state,'already_held',false,'seating_start',h.seating_start,'seating_end',h.seating_end);
EXCEPTION
  WHEN serialization_failure OR deadlock_detected OR lock_not_available THEN
    RETURN jsonb_build_object('ok',false,'code','conflict');
  WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_parameter_value OR invalid_text_representation THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_configuration');
  WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'code','unexpected');
END $$;

-- Release is ONLY for a cancelled reservation. Deadline passage or unpaid
-- status alone is not permission to release. Future expiry must reconcile
-- Stripe, then cancel atomically; the cancellation trigger below releases.
CREATE FUNCTION public.release_reservation_capacity_atomic(p_reservation_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.reservations%ROWTYPE; n integer;
BEGIN
  IF p_actor_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor_user_id) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_actor'); END IF;
  SELECT * INTO r FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  PERFORM public.capacity_lock_0019();
  IF r.status<>'cancelled' THEN RETURN jsonb_build_object('ok',false,'code','invalid_status'); END IF;
  UPDATE public.reservation_capacity_holds SET state='released',released_at=clock_timestamp(),updated_by=p_actor_user_id
    WHERE reservation_id=r.id AND released_at IS NULL;
  GET DIAGNOSTICS n=ROW_COUNT;
  RETURN jsonb_build_object('ok',true,'reservation_id',r.id,'released_count',n);
EXCEPTION WHEN serialization_failure OR deadlock_detected OR lock_not_available THEN
  RETURN jsonb_build_object('ok',false,'code','conflict');
WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'code','unexpected');
END $$;

-- This allocates CAPACITY, not reservation status or payment. Caller must
-- persist verified payment through a future authoritative payment workflow.
CREATE FUNCTION public.confirm_reservation_capacity_atomic(p_reservation_id uuid,p_actor_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.reservations%ROWTYPE; h public.reservation_capacity_holds%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor_user_id) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_actor'); END IF;
  SELECT * INTO r FROM public.reservations WHERE id=p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  PERFORM public.capacity_lock_0019();
  IF r.status NOT IN ('pending_review','confirmed','balance_due','paid_in_full','ready_for_service','checked_in','seated') THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_status'); END IF;
  SELECT * INTO h FROM public.reservation_capacity_holds WHERE reservation_id=r.id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','hold_not_found'); END IF;
  IF h.released_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','hold_released'); END IF;
  IF h.state='allocated' THEN RETURN jsonb_build_object('ok',true,'reservation_id',r.id,
    'confirmed_count',0,'already_allocated',true); END IF;
  IF r.payment_status NOT IN ('deposit_paid','partially_paid','balance_due','paid_in_full')
     OR r.amount_paid_cents<r.deposit_required_cents OR r.amount_paid_cents<=0 THEN
    RETURN jsonb_build_object('ok',false,'code','payment_not_verified'); END IF;
  -- Expired but unreleased holds still own their capacity, so verified late
  -- payment cannot steal resold capacity. Released holds were rejected above.
  UPDATE public.reservation_capacity_holds SET state='allocated',updated_by=p_actor_user_id WHERE id=h.id;
  RETURN jsonb_build_object('ok',true,'reservation_id',r.id,'confirmed_count',1,'already_allocated',false);
EXCEPTION WHEN serialization_failure OR deadlock_detected OR lock_not_available THEN
  RETURN jsonb_build_object('ok',false,'code','conflict');
WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'code','unexpected');
END $$;

-- Protect configuration against invalidating existing future hold snapshots.
CREATE FUNCTION public.capacity_schedule_guard_0019() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE blocked boolean; mapped uuid; ready_now boolean;
BEGIN
  PERFORM public.capacity_lock_0019();
  SELECT ready INTO ready_now FROM public.capacity_control WHERE id=1;
  IF TG_TABLE_NAME='sunday_services' THEN
    IF TG_OP='UPDATE' AND ROW(NEW.date,NEW.space_id,NEW.is_active,NEW.status,NEW.capacity_resource_id)
       IS DISTINCT FROM ROW(OLD.date,OLD.space_id,OLD.is_active,OLD.status,OLD.capacity_resource_id) THEN
      SELECT EXISTS(SELECT 1 FROM public.reservations r JOIN public.reservation_capacity_holds h ON h.reservation_id=r.id
        WHERE r.sunday_service_id=OLD.id AND h.released_at IS NULL AND h.seating_end>clock_timestamp()) INTO blocked;
    END IF;
    -- AFTER trigger: resolver sees the NEW service configuration.
    mapped := public.capacity_resource_for_service_0019(NEW.id);
    IF (NEW.capacity_resource_id IS NOT NULL OR (ready_now AND NEW.is_active AND NEW.status='open')) AND mapped IS NULL THEN
      RAISE EXCEPTION 'Bookable service requires a compatible active capacity resource'; END IF;
  ELSIF TG_TABLE_NAME='seating_times' THEN
    IF ROW(NEW.sunday_service_id,NEW.start_time,NEW.end_time,NEW.is_active)
       IS DISTINCT FROM ROW(OLD.sunday_service_id,OLD.start_time,OLD.end_time,OLD.is_active) THEN
      SELECT EXISTS(SELECT 1 FROM public.reservations r JOIN public.reservation_capacity_holds h ON h.reservation_id=r.id
        WHERE r.seating_time_id=OLD.id AND h.released_at IS NULL AND h.seating_end>clock_timestamp()) INTO blocked;
    END IF;
  ELSIF TG_TABLE_NAME='venue_spaces' THEN
    IF ROW(NEW.is_active,NEW.space_type) IS DISTINCT FROM ROW(OLD.is_active,OLD.space_type) THEN
      SELECT EXISTS(SELECT 1 FROM public.reservation_capacity_holds h JOIN public.capacity_resources c ON c.id=h.capacity_resource_id
        WHERE h.released_at IS NULL AND h.seating_end>clock_timestamp()
        AND (c.space_id=OLD.id OR c.id IN (SELECT parent_id FROM public.capacity_resources WHERE space_id=OLD.id))) INTO blocked;
    END IF;
  ELSIF TG_TABLE_NAME='payment_policy' THEN
    IF NEW.restaurant_timezone IS DISTINCT FROM OLD.restaurant_timezone THEN
      SELECT EXISTS(SELECT 1 FROM public.reservation_capacity_holds
        WHERE released_at IS NULL AND seating_end>clock_timestamp()) INTO blocked;
    END IF;
  END IF;
  IF COALESCE(blocked,false) THEN RAISE EXCEPTION 'Reconcile existing capacity holds before changing this configuration'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_capacity_service_guard AFTER INSERT OR UPDATE ON public.sunday_services
  FOR EACH ROW EXECUTE FUNCTION public.capacity_schedule_guard_0019();
CREATE TRIGGER trg_capacity_seating_guard AFTER UPDATE ON public.seating_times
  FOR EACH ROW EXECUTE FUNCTION public.capacity_schedule_guard_0019();
CREATE TRIGGER trg_capacity_space_guard AFTER UPDATE ON public.venue_spaces
  FOR EACH ROW EXECUTE FUNCTION public.capacity_schedule_guard_0019();
CREATE TRIGGER trg_capacity_timezone_guard AFTER UPDATE ON public.payment_policy
  FOR EACH ROW EXECUTE FUNCTION public.capacity_schedule_guard_0019();

CREATE FUNCTION public.capacity_reservation_guard_0019() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.capacity_lock_0019();
  IF ROW(NEW.sunday_service_id,NEW.seating_time_id,NEW.party_size,NEW.experience_type,NEW.private_room_id)
     IS DISTINCT FROM ROW(OLD.sunday_service_id,OLD.seating_time_id,OLD.party_size,OLD.experience_type,OLD.private_room_id)
     AND EXISTS(SELECT 1 FROM public.reservation_capacity_holds WHERE reservation_id=OLD.id) THEN
    RAISE EXCEPTION 'Reservation move/resize requires an atomic capacity reallocation workflow'; END IF;
  IF OLD.status='cancelled' AND NEW.status<>'cancelled' AND EXISTS (
    SELECT 1 FROM public.reservation_capacity_holds WHERE reservation_id=OLD.id
  ) THEN RAISE EXCEPTION 'Do not reactivate a cancelled capacity reservation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_capacity_reservation_guard BEFORE UPDATE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.capacity_reservation_guard_0019();

-- On activation, this also protects callers still using the old 0012 RPC:
-- every new reservation must acquire capacity in its insert transaction.
CREATE FUNCTION public.capacity_reservation_after_0019() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result jsonb; enabled boolean;
BEGIN
  PERFORM public.capacity_lock_0019();
  IF TG_OP='INSERT' THEN
    SELECT ready INTO enabled FROM public.capacity_control WHERE id=1;
    IF NOT enabled THEN RETURN NEW; END IF;
    result := public.acquire_reservation_capacity_atomic(NEW.id,
      public.resolve_capacity_resource_for_reservation(NEW.id),NEW.created_by);
  ELSIF NEW.status='cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
    result := public.release_reservation_capacity_atomic(NEW.id,NEW.updated_by);
  ELSE RETURN NEW;
  END IF;
  IF result->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION USING ERRCODE='P0019',MESSAGE='Capacity operation failed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_capacity_reservation_after AFTER INSERT OR UPDATE OF status ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.capacity_reservation_after_0019();

CREATE FUNCTION public.submit_reservation_request_with_capacity_atomic(
  p_reservation_number varchar,p_contact_first_name varchar,p_contact_last_name varchar,
  p_contact_email varchar,p_contact_phone varchar,p_sunday_service_id uuid,p_seating_time_id uuid,
  p_experience_type varchar,p_private_room_id uuid,p_party_size integer,p_adults integer,
  p_seniors integer,p_children integer,p_guest_notes text,p_dietary_notes text,
  p_accessibility_requests text,p_occasion varchar,p_subtotal_cents integer,
  p_deposit_required_cents integer,p_grand_total_cents integer,p_remaining_balance_cents integer,
  p_balance_deadline timestamptz,p_pricing_snapshot jsonb,p_policy_snapshot jsonb,
  p_guests jsonb,p_platters jsonb,p_idempotency_key varchar,p_payload_hash varchar,p_actor_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.reservations%ROWTYPE; h public.reservation_capacity_holds%ROWTYPE;
        result jsonb; capacity_result jsonb; rid uuid;
BEGIN
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key)='' OR p_payload_hash IS NULL OR btrim(p_payload_hash)='' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_data'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sds-capacity-submit:'||p_idempotency_key,19));
  SELECT * INTO r FROM public.reservations WHERE idempotency_key=p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF r.payload_hash IS DISTINCT FROM p_payload_hash THEN
      RETURN jsonb_build_object('ok',false,'code','idempotency_key_mismatch'); END IF;
    SELECT * INTO h FROM public.reservation_capacity_holds WHERE reservation_id=r.id;
    -- Never manufacture a new hold/deadline for a historical replay.
    RETURN jsonb_build_object('ok',true,'reservation_id',r.id,'reservation_number',r.reservation_number,
      'status',r.status,'payment_status',r.payment_status,'idempotent_replay',true,
      'hold_id',h.id,'hold_deadline',h.hold_deadline,'capacity_state',h.state);
  END IF;
  -- Do not take the capacity mutex before the insert's reservation/FK locks.
  -- The AFTER INSERT trigger takes it in reservation-first order and checks
  -- readiness again. This avoids an inversion with a racing legacy RPC.
  IF NOT (SELECT ready FROM public.capacity_control WHERE id=1) THEN
    RETURN jsonb_build_object('ok',false,'code','capacity_not_ready'); END IF;
  -- Delegate unchanged validation/inserts to the actually-installed 0012 RPC.
  -- Its insert trigger acquires capacity; any error rolls back its own writes.
  result := public.submit_reservation_request_atomic(
    p_reservation_number,p_contact_first_name,p_contact_last_name,p_contact_email,p_contact_phone,
    p_sunday_service_id,p_seating_time_id,p_experience_type,p_private_room_id,p_party_size,
    p_adults,p_seniors,p_children,p_guest_notes,p_dietary_notes,p_accessibility_requests,p_occasion,
    p_subtotal_cents,p_deposit_required_cents,p_grand_total_cents,p_remaining_balance_cents,
    p_balance_deadline,p_pricing_snapshot,p_policy_snapshot,p_guests,p_platters,
    p_idempotency_key,p_payload_hash,p_actor_user_id);
  IF result->>'ok' IS DISTINCT FROM 'true' THEN RETURN result; END IF;
  rid := (result->>'reservation_id')::uuid;
  -- If the old RPC encountered a racing saved request, preserve its replay.
  IF COALESCE((result->>'idempotent_replay')::boolean,false) THEN
    SELECT * INTO h FROM public.reservation_capacity_holds WHERE reservation_id=rid;
  ELSE
    capacity_result := public.acquire_reservation_capacity_atomic(rid,
      public.resolve_capacity_resource_for_reservation(rid),p_actor_user_id);
    IF capacity_result->>'ok' IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION USING ERRCODE='P0019',MESSAGE='Capacity acquisition failed'; END IF;
    SELECT * INTO STRICT h FROM public.reservation_capacity_holds WHERE reservation_id=rid;
  END IF;
  RETURN result||jsonb_build_object('hold_id',h.id,'hold_deadline',h.hold_deadline,'capacity_state',h.state);
EXCEPTION WHEN SQLSTATE 'P0019' THEN
  RETURN jsonb_build_object('ok',false,'code','capacity_unavailable');
WHEN serialization_failure OR deadlock_detected OR lock_not_available THEN
  RETURN jsonb_build_object('ok',false,'code','conflict');
WHEN OTHERS THEN RETURN jsonb_build_object('ok',false,'code','unexpected');
END $$;

-- Explicit activation gate. DO NOT CALL until application readiness and a
-- reviewed reconciliation of existing bookings. No automatic backfill/cancel.
CREATE FUNCTION public.activate_reservation_capacity_atomic(p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE tz text; today date; missing bigint;
BEGIN
  IF p_actor_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor_user_id) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_actor'); END IF;
  PERFORM public.capacity_lock_0019();
  SELECT btrim(restaurant_timezone) INTO tz FROM public.payment_policy WHERE id=1;
  IF tz IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=tz) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_configuration'); END IF;
  today := (clock_timestamp() AT TIME ZONE tz)::date;
  SELECT count(*) INTO missing FROM public.sunday_services s
    WHERE s.is_active AND s.status='open' AND s.date>=today
      AND public.capacity_resource_for_service_0019(s.id) IS NULL;
  IF missing>0 THEN RETURN jsonb_build_object('ok',false,'code','unmapped_services','count',missing); END IF;
  SELECT count(*) INTO missing FROM public.reservations r
    JOIN public.sunday_services s ON s.id=r.sunday_service_id
    WHERE s.date>=today AND r.status NOT IN ('cancelled','completed','no_show','refund_review')
      AND NOT EXISTS(SELECT 1 FROM public.reservation_capacity_holds h
                     WHERE h.reservation_id=r.id AND h.released_at IS NULL);
  IF missing>0 THEN RETURN jsonb_build_object('ok',false,'code','unreconciled_reservations','count',missing); END IF;
  UPDATE public.capacity_control SET ready=true,activated_at=COALESCE(activated_at,clock_timestamp()),
    activated_by=COALESCE(activated_by,p_actor_user_id) WHERE id=1;
  RETURN jsonb_build_object('ok',true,'ready',true);
END $$;

ALTER TABLE public.capacity_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capacity_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_capacity_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.capacity_control,public.capacity_resources,public.reservation_capacity_holds
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.capacity_control,public.capacity_resources,public.reservation_capacity_holds TO service_role;
-- Resource edits are protected by the global-lock/cross-row trigger above.
GRANT INSERT,UPDATE ON public.capacity_resources TO service_role;

-- Revoke default EXECUTE, including Supabase default grants, for every new
-- internal function. Only the five intentional RPCs + resolver are callable.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND (p.proname IN (
      'capacity_lock_0019','capacity_resource_guard_0019','capacity_resource_for_service_0019',
      'capacity_peak_0019','capacity_schedule_guard_0019','capacity_reservation_guard_0019',
      'capacity_reservation_after_0019','resolve_capacity_resource_for_reservation',
      'acquire_reservation_capacity_atomic','release_reservation_capacity_atomic',
      'confirm_reservation_capacity_atomic','activate_reservation_capacity_atomic',
      'submit_reservation_request_with_capacity_atomic'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.resolve_capacity_resource_for_reservation(uuid),
  public.acquire_reservation_capacity_atomic(uuid,uuid,uuid),
  public.release_reservation_capacity_atomic(uuid,uuid),
  public.confirm_reservation_capacity_atomic(uuid,uuid),
  public.activate_reservation_capacity_atomic(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_reservation_request_with_capacity_atomic(
  varchar,varchar,varchar,varchar,varchar,uuid,uuid,varchar,uuid,
  integer,integer,integer,integer,text,text,text,varchar,integer,integer,integer,integer,
  timestamptz,jsonb,jsonb,jsonb,jsonb,varchar,varchar,uuid) TO service_role;

COMMENT ON TABLE public.capacity_control IS
  'Global transaction mutex and explicit activation gate. Installed disabled. Reconcile existing bookings before activation.';
COMMENT ON TABLE public.reservation_capacity_holds IS
  'Unreleased holds consume capacity even after their fixed deadline. Release only via cancellation after appropriate payment reconciliation. No Stripe integration is implemented here.';
COMMENT ON COLUMN public.sunday_services.capacity_resource_id IS
  'Optional explicit override to the mapped section whole-room parent. NULL uses this service room resource. Does not alter public eligibility, party-size limits, or request-only room policy.';
COMMIT;