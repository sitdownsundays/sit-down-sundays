-- 0025: save per-package child/senior rules after 0024.
-- Apply ONCE. No prices/rules are seeded; no bookings or payments are changed.
-- Server callers must resolve the authenticated actor via resolveOrderingActor.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Package-only replacement: other ordering tables retain their current trigger.
-- now() is fixed for a transaction; use a strictly advancing server timestamp.
CREATE FUNCTION public.set_package_updated_at_0025()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.updated_at IS NULL OR NOT isfinite(OLD.updated_at) THEN
    RAISE EXCEPTION 'Invalid package timestamp' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
  RETURN NEW;
END;
$$;

DROP TRIGGER trg_meal_packages_updated_at ON public.meal_packages;
CREATE TRIGGER trg_meal_packages_updated_at
BEFORE UPDATE ON public.meal_packages
FOR EACH ROW EXECUTE FUNCTION public.set_package_updated_at_0025();

-- All six rule fields are REQUIRED arguments, including explicit NULLs.
-- This replaces both category configurations together; it is not a partial patch.
CREATE FUNCTION public.update_package_guest_pricing_atomic(
  p_package_id uuid,
  p_expected_updated_at timestamptz,
  p_actor uuid,
  p_child_rule_type text,
  p_child_fixed_price_cents integer,
  p_child_discount_basis_points integer,
  p_senior_rule_type text,
  p_senior_fixed_price_cents integer,
  p_senior_discount_basis_points integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public.meal_packages%ROWTYPE;
BEGIN
  -- Defense in depth; the browser cannot select the actor or call this RPC.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.revoked_at IS NULL
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions pm ON pm.id = rp.permission_id
    WHERE p.id = p_actor AND p.status = 'active' AND pm.key = 'menus.manage'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized');
  END IF;

  IF p_package_id IS NULL OR p_expected_updated_at IS NULL
     OR NOT isfinite(p_expected_updated_at) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_value');
  END IF;

  SELECT * INTO v_row FROM public.meal_packages
  WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'conflict');
  END IF;

  -- Exact no-op: no timestamp bump or extra audit row. Still checks concurrency.
  IF ROW(v_row.child_rule_type, v_row.child_fixed_price_cents,
         v_row.child_discount_basis_points, v_row.senior_rule_type,
         v_row.senior_fixed_price_cents, v_row.senior_discount_basis_points)
     IS NOT DISTINCT FROM
     ROW(p_child_rule_type, p_child_fixed_price_cents,
         p_child_discount_basis_points, p_senior_rule_type,
         p_senior_fixed_price_cents, p_senior_discount_basis_points) THEN
    RETURN jsonb_build_object('ok', true, 'row', to_jsonb(v_row));
  END IF;

  -- 0024 CHECK constraints validate each complete rule against the locked base
  -- price. Invalid combinations roll back the entire UPDATE and its audit.
  UPDATE public.meal_packages SET
    child_rule_type = p_child_rule_type,
    child_fixed_price_cents = p_child_fixed_price_cents,
    child_discount_basis_points = p_child_discount_basis_points,
    senior_rule_type = p_senior_rule_type,
    senior_fixed_price_cents = p_senior_fixed_price_cents,
    senior_discount_basis_points = p_senior_discount_basis_points,
    updated_by = p_actor
  WHERE id = p_package_id RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'row', to_jsonb(v_row));
EXCEPTION
  WHEN check_violation OR not_null_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_value');
  WHEN serialization_failure OR deadlock_detected OR lock_not_available THEN
    RETURN jsonb_build_object('ok', false, 'code', 'conflict');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unexpected');
END;
$$;

REVOKE ALL ON FUNCTION public.set_package_updated_at_0025()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_package_updated_at_0025() TO service_role;

REVOKE ALL ON FUNCTION public.update_package_guest_pricing_atomic(
  uuid,timestamptz,uuid,text,integer,integer,text,integer,integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_package_guest_pricing_atomic(
  uuid,timestamptz,uuid,text,integer,integer,text,integer,integer
) TO service_role;

-- Existing table RLS/grants and audit trigger are unchanged. Existing package
-- create/update RPCs, eligible items, global rules and stored prices are intact.
NOTIFY pgrst, 'reload schema';
COMMIT;

SELECT
  to_regprocedure('public.update_package_guest_pricing_atomic(uuid,timestamp with time zone,uuid,text,integer,integer,text,integer,integer)') IS NOT NULL AS save_function_exists,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.meal_packages'::regclass
      AND tgname = 'trg_meal_packages_updated_at'
      AND tgfoid = 'public.set_package_updated_at_0025()'::regprocedure
      AND NOT tgisinternal AND tgenabled = 'O'
  ) AS package_timestamp_guard_installed;