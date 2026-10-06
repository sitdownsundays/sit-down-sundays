-- ============================================================================
-- Sit Down Sundays — 0009_ordering_model.sql
-- ============================================================================
-- Structured meal-package ordering model for fixed-price Sunday dining.
--
-- This is the ORDERING CONFIGURATION foundation only. It establishes:
--   * meal_packages        — per-person packages (Basic/Signature/Premium) with
--                            included selection counts and eligible dishes.
--   * meal_package_eligible_items — links a package to eligible menu_items by
--                            selection_category (meat/side/bread/drink).
--   * individual_addons    — per-guest extras priced separately.
--   * addon_eligible_packages — links an add-on to the packages it may be
--                            ordered with.
--   * shared_platters      — per-PLATTER (not per-guest) shared items.
--   * guest_pricing_rules  — single-row senior/child discount configuration.
--
-- It does NOT implement reservations, checkout, Stripe, capacity, or real
-- order persistence. Those come later and will reference these config tables.
--
-- KEY DESIGN RULES (per owner direction):
--   * Packages are priced PER PERSON. Included dishes are covered by the
--     package price and must NOT be charged again.
--   * Individual add-ons are priced per unit and attached to ONE guest.
--   * Shared platters are priced PER PLATTER with a quantity; they belong to
--     the table/party order and NEVER multiply by guest count.
--   * Senior discount is a confirmed 5%. Qualifying age and which charges
--     receive the discount are staff-configured.
--   * Child pricing uses an explicitly selected rule (fixed package price OR
--     percentage discount). Missing rules stay visibly unconfigured — never
--     silently free or full-price. Ages are not invented.
--   * Senior/child discounts do NOT apply to shared platters automatically.
--
-- ELIGIBLE DISHES reuse existing menu_items (0003). A package's eligible items
-- are classified by selection_category (meat/side/bread/drink), which is
-- independent of the menu_item's own category column. A menu_item can be
-- eligible for multiple packages.
--
-- ATOMIC OPERATIONS:
--   Package and add-on CREATION and UPDATE, plus platter and guest-pricing-rules
--   UPDATE, are performed by service-role-only PostgreSQL RPCs so the
--   parent-row insert/update, child-link replacement, and audit-log trigger
--   all succeed or fail in ONE transaction. This fixes the previous non-atomic
--   two-statement creation pattern that could leave an orphaned parent row
--   with no eligible items when the eligibility insert failed. Optimistic
--   concurrency (expectedUpdatedAt) is enforced INSIDE the UPDATE RPCs via a
--   WHERE updated_at = p_expected_updated_at clause, so a stale edit updates
--   zero rows and the RPC returns a safe conflict — not a silent overwrite.
--   Eligibility-write errors are surfaced (the RPC returns a code), never
--   silently swallowed. Eligible-item JSON menuItemId values are explicitly
--   cast to uuid; invalid input raises a safe invalid_reference code.
--   Execution is revoked from PUBLIC, anon, and authenticated; only
--   service_role may call these RPCs.
--
-- SECURITY MODEL:
--   * These are INTERNAL configuration tables, not public content. anon and
--     authenticated get NO read access (like venue_spaces). Only the
--     service-role client, used inside authorized server functions after the
--     caller's role is verified, may read and mutate.
--   * RLS enabled with no anon/authenticated policies; service_role bypasses.
--   * Audit logging reuses public.audit_cms_change() (0004) → append-only
--     public.audit_logs (0001) in the SAME transaction as each mutation. The
--     audit trigger reads created_by on INSERT and updated_by on UPDATE, so
--     every audited table — including guest_pricing_rules — has both columns.
--
-- STATUS: DRAFT, NOT YET APPLIED.
-- Supabase should run this versioned migration exactly once, after
-- 0008_venue_spaces.sql. It does not modify or reapply 0001–0008.
-- Wrapped in BEGIN/COMMIT so it applies atomically.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- meal_packages
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meal_packages (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      varchar(120) NOT NULL,
  slug                      varchar(120) NOT NULL,
  description               text NOT NULL DEFAULT '',
  price_per_person_cents    integer NOT NULL DEFAULT 0,
  included_meats_count      integer NOT NULL DEFAULT 0,
  included_sides_count      integer NOT NULL DEFAULT 0,
  includes_bread            boolean NOT NULL DEFAULT false,
  includes_soft_drink       boolean NOT NULL DEFAULT false,
  is_active                 boolean NOT NULL DEFAULT true,
  display_order             integer NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- meal_package_eligible_items
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meal_package_eligible_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id          uuid NOT NULL REFERENCES public.meal_packages(id) ON DELETE CASCADE,
  menu_item_id        uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  selection_category  varchar(20) NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- individual_addons
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.individual_addons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          varchar(120) NOT NULL,
  slug          varchar(120) NOT NULL,
  description   text NOT NULL DEFAULT '',
  price_cents   integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- addon_eligible_packages
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.addon_eligible_packages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_id    uuid NOT NULL REFERENCES public.individual_addons(id) ON DELETE CASCADE,
  package_id  uuid NOT NULL REFERENCES public.meal_packages(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- shared_platters
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shared_platters (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    varchar(120) NOT NULL,
  slug                    varchar(120) NOT NULL,
  description             text NOT NULL DEFAULT '',
  price_per_platter_cents integer NOT NULL DEFAULT 0,
  serving_guidance        text,
  is_active               boolean NOT NULL DEFAULT true,
  display_order           integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- guest_pricing_rules  (single-row configuration table)
-- ----------------------------------------------------------------------------
-- Singleton: only one row (id = 1) is permitted, enforced by a simple
-- CHECK (id = 1) constraint (NOT a subquery, which PostgreSQL forbids in a
-- column CHECK constraint). created_by is present so the audit trigger
-- (audit_cms_change, 0004) can read new.created_by on INSERT.
CREATE TABLE IF NOT EXISTS public.guest_pricing_rules (
  id                                  smallint PRIMARY KEY DEFAULT 1,
  senior_discount_percent             integer,
  senior_min_age                      integer,
  senior_applies_to_packages          boolean NOT NULL DEFAULT true,
  senior_applies_to_addons            boolean NOT NULL DEFAULT false,
  senior_applies_to_platters          boolean NOT NULL DEFAULT false,
  child_rule_type                     varchar(40) NOT NULL DEFAULT 'none',
  child_discount_percent              integer,
  child_fixed_package_price_cents     integer,
  child_max_age                       integer,
  child_applies_to_packages           boolean NOT NULL DEFAULT true,
  child_applies_to_addons             boolean NOT NULL DEFAULT false,
  child_applies_to_platters           boolean NOT NULL DEFAULT false,
  created_at                          timestamptz NOT NULL DEFAULT now(),
  updated_at                          timestamptz NOT NULL DEFAULT now(),
  created_by                          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by                          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT guest_pricing_rules_single_row CHECK (id = 1)
);

-- ----------------------------------------------------------------------------
-- Constraints — meal_packages
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meal_packages_slug_key' AND conrelid = 'public.meal_packages'::regclass) THEN
    ALTER TABLE public.meal_packages ADD CONSTRAINT meal_packages_slug_key UNIQUE (slug);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_meal_packages_slug_format' AND conrelid = 'public.meal_packages'::regclass) THEN
    ALTER TABLE public.meal_packages ADD CONSTRAINT check_meal_packages_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_meal_packages_price' AND conrelid = 'public.meal_packages'::regclass) THEN
    ALTER TABLE public.meal_packages ADD CONSTRAINT check_meal_packages_price CHECK (price_per_person_cents >= 0 AND price_per_person_cents <= 1000000);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_meal_packages_counts' AND conrelid = 'public.meal_packages'::regclass) THEN
    ALTER TABLE public.meal_packages ADD CONSTRAINT check_meal_packages_counts CHECK (included_meats_count >= 0 AND included_sides_count >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_meal_packages_display_order' AND conrelid = 'public.meal_packages'::regclass) THEN
    ALTER TABLE public.meal_packages ADD CONSTRAINT check_meal_packages_display_order CHECK (display_order >= 0);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Constraints — meal_package_eligible_items
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_mpei_selection_category' AND conrelid = 'public.meal_package_eligible_items'::regclass) THEN
    ALTER TABLE public.meal_package_eligible_items ADD CONSTRAINT check_mpei_selection_category
      CHECK (selection_category IN ('meat','side','bread','drink'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meal_package_eligible_items_package_item_key' AND conrelid = 'public.meal_package_eligible_items'::regclass) THEN
    ALTER TABLE public.meal_package_eligible_items ADD CONSTRAINT meal_package_eligible_items_package_item_key UNIQUE (package_id, menu_item_id);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Constraints — individual_addons
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'individual_addons_slug_key' AND conrelid = 'public.individual_addons'::regclass) THEN
    ALTER TABLE public.individual_addons ADD CONSTRAINT individual_addons_slug_key UNIQUE (slug);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_individual_addons_slug_format' AND conrelid = 'public.individual_addons'::regclass) THEN
    ALTER TABLE public.individual_addons ADD CONSTRAINT check_individual_addons_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_individual_addons_price' AND conrelid = 'public.individual_addons'::regclass) THEN
    ALTER TABLE public.individual_addons ADD CONSTRAINT check_individual_addons_price CHECK (price_cents >= 0 AND price_cents <= 1000000);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_individual_addons_display_order' AND conrelid = 'public.individual_addons'::regclass) THEN
    ALTER TABLE public.individual_addons ADD CONSTRAINT check_individual_addons_display_order CHECK (display_order >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'addon_eligible_packages_addon_package_key' AND conrelid = 'public.addon_eligible_packages'::regclass) THEN
    ALTER TABLE public.addon_eligible_packages ADD CONSTRAINT addon_eligible_packages_addon_package_key UNIQUE (addon_id, package_id);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Constraints — shared_platters
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shared_platters_slug_key' AND conrelid = 'public.shared_platters'::regclass) THEN
    ALTER TABLE public.shared_platters ADD CONSTRAINT shared_platters_slug_key UNIQUE (slug);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_shared_platters_slug_format' AND conrelid = 'public.shared_platters'::regclass) THEN
    ALTER TABLE public.shared_platters ADD CONSTRAINT check_shared_platters_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_shared_platters_price' AND conrelid = 'public.shared_platters'::regclass) THEN
    ALTER TABLE public.shared_platters ADD CONSTRAINT check_shared_platters_price CHECK (price_per_platter_cents >= 0 AND price_per_platter_cents <= 1000000);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_shared_platters_display_order' AND conrelid = 'public.shared_platters'::regclass) THEN
    ALTER TABLE public.shared_platters ADD CONSTRAINT check_shared_platters_display_order CHECK (display_order >= 0);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Constraints — guest_pricing_rules
-- ----------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_gpr_child_rule_type' AND conrelid = 'public.guest_pricing_rules'::regclass) THEN
    ALTER TABLE public.guest_pricing_rules ADD CONSTRAINT check_gpr_child_rule_type
      CHECK (child_rule_type IN ('none','fixed_package_price','percentage_discount'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_gpr_senior_discount' AND conrelid = 'public.guest_pricing_rules'::regclass) THEN
    ALTER TABLE public.guest_pricing_rules ADD CONSTRAINT check_gpr_senior_discount
      CHECK (senior_discount_percent IS NULL OR (senior_discount_percent >= 0 AND senior_discount_percent <= 100));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_gpr_child_discount' AND conrelid = 'public.guest_pricing_rules'::regclass) THEN
    ALTER TABLE public.guest_pricing_rules ADD CONSTRAINT check_gpr_child_discount
      CHECK (child_discount_percent IS NULL OR (child_discount_percent >= 0 AND child_discount_percent <= 100));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_gpr_child_fixed_price' AND conrelid = 'public.guest_pricing_rules'::regclass) THEN
    ALTER TABLE public.guest_pricing_rules ADD CONSTRAINT check_gpr_child_fixed_price
      CHECK (child_fixed_package_price_cents IS NULL OR (child_fixed_package_price_cents >= 0 AND child_fixed_package_price_cents <= 1000000));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_gpr_ages' AND conrelid = 'public.guest_pricing_rules'::regclass) THEN
    ALTER TABLE public.guest_pricing_rules ADD CONSTRAINT check_gpr_ages
      CHECK (
        (senior_min_age IS NULL OR senior_min_age >= 0) AND
        (child_max_age IS NULL OR child_max_age >= 0)
      );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_meal_packages_display_order ON public.meal_packages (display_order);
CREATE INDEX IF NOT EXISTS idx_meal_packages_active ON public.meal_packages (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_mpei_package ON public.meal_package_eligible_items (package_id);
CREATE INDEX IF NOT EXISTS idx_mpei_item ON public.meal_package_eligible_items (menu_item_id);
CREATE INDEX IF NOT EXISTS idx_individual_addons_display_order ON public.individual_addons (display_order);
CREATE INDEX IF NOT EXISTS idx_addon_eligible_addon ON public.addon_eligible_packages (addon_id);
CREATE INDEX IF NOT EXISTS idx_shared_platters_display_order ON public.shared_platters (display_order);

-- ----------------------------------------------------------------------------
-- updated_at triggers (SECURITY INVOKER: runs with the invoking role's
-- privileges, NOT automatically the table owner's privileges)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_ordering_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meal_packages_updated_at ON public.meal_packages;
CREATE TRIGGER trg_meal_packages_updated_at BEFORE UPDATE ON public.meal_packages
  FOR EACH ROW EXECUTE FUNCTION public.set_ordering_updated_at();

DROP TRIGGER IF EXISTS trg_individual_addons_updated_at ON public.individual_addons;
CREATE TRIGGER trg_individual_addons_updated_at BEFORE UPDATE ON public.individual_addons
  FOR EACH ROW EXECUTE FUNCTION public.set_ordering_updated_at();

DROP TRIGGER IF EXISTS trg_shared_platters_updated_at ON public.shared_platters;
CREATE TRIGGER trg_shared_platters_updated_at BEFORE UPDATE ON public.shared_platters
  FOR EACH ROW EXECUTE FUNCTION public.set_ordering_updated_at();

DROP TRIGGER IF EXISTS trg_gpr_updated_at ON public.guest_pricing_rules;
CREATE TRIGGER trg_gpr_updated_at BEFORE UPDATE ON public.guest_pricing_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_ordering_updated_at();

-- ----------------------------------------------------------------------------
-- Audit logging triggers (reuse public.audit_cms_change() from 0004)
-- Actor = created_by (INSERT) or updated_by (UPDATE). Safe old/new JSON only.
-- If the audit insert fails, the mutation rolls back. Every audited table has
-- both created_by and updated_by so the trigger can resolve the actor.
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_meal_packages_audit ON public.meal_packages;
CREATE TRIGGER trg_meal_packages_audit AFTER INSERT OR UPDATE ON public.meal_packages
  FOR EACH ROW EXECUTE FUNCTION public.audit_cms_change();

DROP TRIGGER IF EXISTS trg_individual_addons_audit ON public.individual_addons;
CREATE TRIGGER trg_individual_addons_audit AFTER INSERT OR UPDATE ON public.individual_addons
  FOR EACH ROW EXECUTE FUNCTION public.audit_cms_change();

DROP TRIGGER IF EXISTS trg_shared_platters_audit ON public.shared_platters;
CREATE TRIGGER trg_shared_platters_audit AFTER INSERT OR UPDATE ON public.shared_platters
  FOR EACH ROW EXECUTE FUNCTION public.audit_cms_change();

DROP TRIGGER IF EXISTS trg_gpr_audit ON public.guest_pricing_rules;
CREATE TRIGGER trg_gpr_audit AFTER INSERT OR UPDATE ON public.guest_pricing_rules
  FOR EACH ROW EXECUTE FUNCTION public.audit_cms_change();

-- ============================================================================
-- Atomic save RPCs (service-role only)
-- ============================================================================
-- These RPCs perform a parent-row INSERT/UPDATE AND its child-link replacement
-- in ONE transaction, with optimistic concurrency enforced INSIDE the write
-- (for updates) via WHERE updated_at = p_expected_updated_at. A stale edit
-- updates zero rows, so the RPC returns a safe conflict instead of silently
-- overwriting newer data. The audit triggers fire within the same
-- transaction, so mutation and audit succeed or roll back together. p_actor
-- is validated against auth.users before any mutation. Eligible-item JSON
-- menuItemId values are explicitly cast to uuid; invalid input raises a safe
-- invalid_reference code. Execution is revoked from PUBLIC, anon, and
-- authenticated; only service_role may call these RPCs.
--
-- NOTE: SECURITY DEFINER is used so the RPC runs with the function owner's
-- privileges, allowing it to write the RLS-protected config tables. The caller
-- is still the service-role client inside an authorized server function; this
-- does NOT weaken authorization. A leaked service-role key bypasses RLS
-- regardless of these RPCs — RLS protects against browser roles, not a leaked
-- service-role key.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- create_package_atomic
-- ----------------------------------------------------------------------------
-- Inserts a meal_packages row and its eligible-item set in one transaction.
-- If the eligible insert fails, the parent insert rolls back (no orphan).
-- Returns the new row as JSON.
CREATE OR REPLACE FUNCTION public.create_package_atomic(
  p_actor                  uuid,
  p_name                   varchar,
  p_slug                   varchar,
  p_description            text,
  p_price_per_person_cents integer,
  p_included_meats_count   integer,
  p_included_sides_count   integer,
  p_includes_bread         boolean,
  p_includes_soft_drink    boolean,
  p_is_active              boolean,
  p_display_order          integer,
  p_eligible_items         jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row       record;
  v_item      jsonb;
  v_uuid      uuid;
  v_seen      uuid[]   := ARRAY[]::uuid[];
  v_new_links jsonb;
BEGIN
  -- Validate actor before any mutation.
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_actor) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Validate the eligible-items JSON shape and pre-cast every UUID BEFORE any
  -- write, so a malformed collection or reference rolls back nothing. A cast
  -- failure raises invalid_text_representation, caught by the outer handler,
  -- which rolls back the entire function body and returns invalid_reference.
  -- Duplicate menuItemId values (compared as normalized UUIDs) are rejected
  -- with invalid_value; they are NOT silently deduplicated.
  IF p_eligible_items IS NOT NULL THEN
    IF jsonb_typeof(p_eligible_items) <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
    END IF;
    v_seen := ARRAY[]::uuid[];
    FOR v_item IN SELECT jsonb_array_elements(p_eligible_items) LOOP
      IF NOT (v_item ? 'menuItemId') OR NOT (v_item ? 'selectionCategory') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
      END IF;
      IF jsonb_typeof(v_item->'menuItemId') <> 'string'
         OR jsonb_typeof(v_item->'selectionCategory') <> 'string'
         OR v_item->>'menuItemId' IS NULL OR v_item->>'selectionCategory' IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
      END IF;
      v_uuid := (v_item->>'menuItemId')::uuid;
      IF v_uuid = ANY(v_seen) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_value');
      END IF;
      v_seen := array_append(v_seen, v_uuid);
    END LOOP;
  END IF;

  -- Insert the parent row. The AFTER INSERT audit trigger fires in this txn.
  INSERT INTO public.meal_packages
    (name, slug, description, price_per_person_cents, included_meats_count,
     included_sides_count, includes_bread, includes_soft_drink, is_active,
     display_order, created_by, updated_by)
  VALUES
    (p_name, p_slug, p_description, p_price_per_person_cents, p_included_meats_count,
     p_included_sides_count, p_includes_bread, p_includes_soft_drink, p_is_active,
     p_display_order, p_actor, p_actor)
  RETURNING * INTO v_row;

  -- Insert eligible items. UUIDs were pre-validated above; a nonexistent
  -- menu_item raises foreign_key_violation -> outer handler -> invalid_reference,
  -- rolling back the parent insert in the same transaction.
  IF p_eligible_items IS NOT NULL THEN
    FOR v_item IN SELECT jsonb_array_elements(p_eligible_items) LOOP
      v_uuid := (v_item->>'menuItemId')::uuid;
      INSERT INTO public.meal_package_eligible_items (package_id, menu_item_id, selection_category)
      VALUES (v_row.id, v_uuid, v_item->>'selectionCategory');
    END LOOP;
  END IF;

  -- Eligibility audit evidence: the link table has no audit trigger, so write a
  -- supplementary audit_logs row in THIS transaction capturing the new
  -- eligibility set. previous_values is null (create); new_values holds the
  -- assigned links. This preserves the shared audit function for the parent
  -- row while recording the eligibility assignment as transactional evidence.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'menuItemId', menu_item_id, 'selectionCategory', selection_category
  )), '[]'::jsonb) INTO v_new_links
  FROM public.meal_package_eligible_items WHERE package_id = v_row.id;

  INSERT INTO public.audit_logs
    (actor_user_id, action, entity_type, entity_id, previous_values, new_values)
  VALUES
    (p_actor, 'meal_package_eligible_items.insert', 'meal_packages', v_row.id::text,
     null, jsonb_build_object('eligibleItems', v_new_links));

  RETURN jsonb_build_object('ok', true, 'row', to_jsonb(v_row));
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'duplicate_slug');
  WHEN check_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_value');
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
  WHEN insufficient_privilege THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized');
END;
$$;

-- ----------------------------------------------------------------------------
-- update_package_atomic
-- ----------------------------------------------------------------------------
-- Updates a meal_packages row (concurrency-guarded) and replaces its
-- eligible-item set in one transaction. Returns the updated row as JSON.
CREATE OR REPLACE FUNCTION public.update_package_atomic(
  p_package_id             uuid,
  p_expected_updated_at    timestamptz,
  p_actor                  uuid,
  p_name                   varchar DEFAULT NULL,
  p_slug                   varchar DEFAULT NULL,
  p_description            text    DEFAULT NULL,
  p_price_per_person_cents integer DEFAULT NULL,
  p_included_meats_count   integer DEFAULT NULL,
  p_included_sides_count   integer DEFAULT NULL,
  p_includes_bread         boolean DEFAULT NULL,
  p_includes_soft_drink    boolean DEFAULT NULL,
  p_is_active              boolean DEFAULT NULL,
  p_display_order          integer DEFAULT NULL,
  p_eligible_items         jsonb   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row        record;
  v_item       jsonb;
  v_uuid       uuid;
  v_seen       uuid[]   := ARRAY[]::uuid[];
  v_old_links  jsonb;
  v_new_links  jsonb;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_actor) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Lock + concurrency check in one statement. Zero rows => stale.
  SELECT * INTO v_row
  FROM public.meal_packages
  WHERE id = p_package_id AND updated_at = p_expected_updated_at
  FOR UPDATE;
  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.meal_packages WHERE id = p_package_id) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'not_found');
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'conflict');
  END IF;

  -- Validate the replacement eligible-items JSON shape and pre-cast every UUID
  -- BEFORE any mutation (UPDATE/DELETE/INSERT), so a malformed collection or
  -- reference rolls back the original parent and its complete original
  -- eligibility set. A cast failure raises invalid_text_representation, caught
  -- by the outer handler, which rolls back the entire function body.
  -- Duplicate menuItemId values (compared as normalized UUIDs) are rejected
  -- with invalid_value; they are NOT silently deduplicated.
  IF p_eligible_items IS NOT NULL THEN
    IF jsonb_typeof(p_eligible_items) <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
    END IF;
    v_seen := ARRAY[]::uuid[];
    FOR v_item IN SELECT jsonb_array_elements(p_eligible_items) LOOP
      IF NOT (v_item ? 'menuItemId') OR NOT (v_item ? 'selectionCategory') THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
      END IF;
      IF jsonb_typeof(v_item->'menuItemId') <> 'string'
         OR jsonb_typeof(v_item->'selectionCategory') <> 'string'
         OR v_item->>'menuItemId' IS NULL OR v_item->>'selectionCategory' IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
      END IF;
      v_uuid := (v_item->>'menuItemId')::uuid;
      IF v_uuid = ANY(v_seen) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_value');
      END IF;
      v_seen := array_append(v_seen, v_uuid);
    END LOOP;
  END IF;

  -- Snapshot the OLD eligibility set BEFORE replacing it, for audit evidence.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'menuItemId', menu_item_id, 'selectionCategory', selection_category
  )), '[]'::jsonb) INTO v_old_links
  FROM public.meal_package_eligible_items WHERE package_id = p_package_id;

  UPDATE public.meal_packages
  SET name = COALESCE(p_name, name),
      slug = COALESCE(p_slug, slug),
      description = COALESCE(p_description, description),
      price_per_person_cents = COALESCE(p_price_per_person_cents, price_per_person_cents),
      included_meats_count = COALESCE(p_included_meats_count, included_meats_count),
      included_sides_count = COALESCE(p_included_sides_count, included_sides_count),
      includes_bread = COALESCE(p_includes_bread, includes_bread),
      includes_soft_drink = COALESCE(p_includes_soft_drink, includes_soft_drink),
      is_active = COALESCE(p_is_active, is_active),
      display_order = COALESCE(p_display_order, display_order),
      updated_by = p_actor
  WHERE id = p_package_id
  RETURNING * INTO v_row;

  -- Replace eligible items only when a replacement set was supplied. UUIDs
  -- were pre-validated; a nonexistent menu_item raises foreign_key_violation ->
  -- outer handler -> invalid_reference, rolling back the UPDATE and DELETE.
  IF p_eligible_items IS NOT NULL THEN
    DELETE FROM public.meal_package_eligible_items WHERE package_id = p_package_id;
    FOR v_item IN SELECT jsonb_array_elements(p_eligible_items) LOOP
      v_uuid := (v_item->>'menuItemId')::uuid;
      INSERT INTO public.meal_package_eligible_items (package_id, menu_item_id, selection_category)
      VALUES (p_package_id, v_uuid, v_item->>'selectionCategory');
    END LOOP;

    -- Eligibility audit evidence: record the old -> new assignment in this txn.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'menuItemId', menu_item_id, 'selectionCategory', selection_category
    )), '[]'::jsonb) INTO v_new_links
    FROM public.meal_package_eligible_items WHERE package_id = p_package_id;

    INSERT INTO public.audit_logs
      (actor_user_id, action, entity_type, entity_id, previous_values, new_values)
    VALUES
      (p_actor, 'meal_package_eligible_items.update', 'meal_packages', p_package_id::text,
       jsonb_build_object('eligibleItems', v_old_links),
       jsonb_build_object('eligibleItems', v_new_links));
  END IF;

  RETURN jsonb_build_object('ok', true, 'row', to_jsonb(v_row));
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'duplicate_slug');
  WHEN check_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_value');
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
  WHEN insufficient_privilege THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized');
END;
$$;

-- ----------------------------------------------------------------------------
-- create_addon_atomic
-- ----------------------------------------------------------------------------
-- Inserts an individual_addons row and its eligible-package links in one
-- transaction. Returns the new row and the saved link package IDs as JSON.
CREATE OR REPLACE FUNCTION public.create_addon_atomic(
  p_actor                  uuid,
  p_name                   varchar,
  p_slug                   varchar,
  p_description            text,
  p_price_cents            integer,
  p_is_active              boolean,
  p_display_order          integer,
  p_eligible_package_ids   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row record;
  v_pid_el jsonb;
  v_pid text;
  v_links uuid[] := ARRAY[]::uuid[];
  v_uuid uuid;
  v_new_links jsonb;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_actor) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Validate the eligible-package-ids JSON shape and pre-cast every UUID
  -- BEFORE any write, so a malformed collection or reference rolls back
  -- nothing. A cast failure raises invalid_text_representation, caught by the
  -- outer handler, which rolls back the entire function body.
  -- Validate the eligible-package-ids JSON shape BEFORE any write. Distinguish:
  --   * SQL NULL collection: existing omit/no-links semantics.
  --   * Empty array: valid empty eligibility set.
  --   * JSON null collection (jsonb 'null'): invalid -> invalid_reference.
  -- Every element must be a non-null JSON string holding a valid UUID; reject
  -- JSON null, numbers, booleans, arrays, and objects. Duplicate UUIDs are
  -- rejected with invalid_value (compared as normalized UUIDs, NOT deduped).
  -- UUID cast failures reach the enclosing exception handler and roll back
  -- the entire function body.
  IF p_eligible_package_ids IS NOT NULL THEN
    IF jsonb_typeof(p_eligible_package_ids) <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
    END IF;
    v_links := ARRAY[]::uuid[];
    FOR v_pid_el IN SELECT jsonb_array_elements(p_eligible_package_ids) LOOP
      IF jsonb_typeof(v_pid_el) <> 'string' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
      END IF;
      v_pid := v_pid_el#>>'{}';
      IF v_pid IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
      END IF;
      v_uuid := v_pid::uuid;
      IF v_uuid = ANY(v_links) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_value');
      END IF;
      v_links := array_append(v_links, v_uuid);
    END LOOP;
  END IF;

  INSERT INTO public.individual_addons
    (name, slug, description, price_cents, is_active, display_order, created_by, updated_by)
  VALUES
    (p_name, p_slug, p_description, p_price_cents, p_is_active, p_display_order, p_actor, p_actor)
  RETURNING * INTO v_row;

  -- Insert eligible-package links. UUIDs were pre-validated and collected into
  -- v_links during prevalidation above; do NOT append them again here, or the
  -- success response would return each supplied ID twice.
  IF p_eligible_package_ids IS NOT NULL THEN
    FOR v_pid IN SELECT jsonb_array_elements_text(p_eligible_package_ids) LOOP
      v_uuid := v_pid::uuid;
      INSERT INTO public.addon_eligible_packages (addon_id, package_id)
      VALUES (v_row.id, v_uuid);
    END LOOP;
  END IF;

  -- Eligibility audit evidence: the link table has no audit trigger, so write a
  -- supplementary audit_logs row in THIS transaction capturing the new link
  -- set. previous_values is null (create); new_values holds the assigned links.
  SELECT COALESCE(jsonb_agg(package_id::text), '[]'::jsonb) INTO v_new_links
  FROM public.addon_eligible_packages WHERE addon_id = v_row.id;

  INSERT INTO public.audit_logs
    (actor_user_id, action, entity_type, entity_id, previous_values, new_values)
  VALUES
    (p_actor, 'addon_eligible_packages.insert', 'individual_addons', v_row.id::text,
     null, jsonb_build_object('eligiblePackageIds', v_new_links));

  RETURN jsonb_build_object('ok', true, 'row', to_jsonb(v_row), 'links', to_jsonb(v_links));
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'duplicate_slug');
  WHEN check_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_value');
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
  WHEN insufficient_privilege THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized');
END;
$$;

-- ----------------------------------------------------------------------------
-- update_addon_atomic
-- ----------------------------------------------------------------------------
-- Updates an individual_addons row (concurrency-guarded) and replaces its
-- eligible-package link set in one transaction. Returns the updated row and
-- the saved link package IDs as JSON (extracted server-side, not a separate
-- post-commit read).
CREATE OR REPLACE FUNCTION public.update_addon_atomic(
  p_addon_id              uuid,
  p_expected_updated_at   timestamptz,
  p_actor                 uuid,
  p_name                  varchar DEFAULT NULL,
  p_slug                  varchar DEFAULT NULL,
  p_description           text    DEFAULT NULL,
  p_price_cents           integer DEFAULT NULL,
  p_is_active             boolean DEFAULT NULL,
  p_display_order         integer DEFAULT NULL,
  p_eligible_package_ids  jsonb   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row   record;
  v_pid_el jsonb;
  v_pid   text;
  v_uuid  uuid;
  v_links uuid[] := ARRAY[]::uuid[];
  v_old_links jsonb;
  v_new_links jsonb;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_actor) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM public.individual_addons
  WHERE id = p_addon_id AND updated_at = p_expected_updated_at
  FOR UPDATE;
  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.individual_addons WHERE id = p_addon_id) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'not_found');
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'conflict');
  END IF;

  -- Validate the replacement eligible-package-ids JSON shape BEFORE any
  -- mutation (UPDATE/DELETE/INSERT), so a malformed collection or reference
  -- rolls back the original parent and its complete original link set.
  -- Distinguish:
  --   * SQL NULL collection: existing omit/no-links semantics.
  --   * Empty array: valid empty eligibility set.
  --   * JSON null collection (jsonb 'null'): invalid -> invalid_reference.
  -- Every element must be a non-null JSON string holding a valid UUID; reject
  -- JSON null, numbers, booleans, arrays, and objects. Duplicate UUIDs are
  -- rejected with invalid_value (compared as normalized UUIDs, NOT deduped).
  -- UUID cast failures reach the enclosing exception handler and roll back the
  -- entire function body.
  IF p_eligible_package_ids IS NOT NULL THEN
    IF jsonb_typeof(p_eligible_package_ids) <> 'array' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
    END IF;
    v_links := ARRAY[]::uuid[];
    FOR v_pid_el IN SELECT jsonb_array_elements(p_eligible_package_ids) LOOP
      IF jsonb_typeof(v_pid_el) <> 'string' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
      END IF;
      v_pid := v_pid_el#>>'{}';
      IF v_pid IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
      END IF;
      v_uuid := v_pid::uuid;
      IF v_uuid = ANY(v_links) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'invalid_value');
      END IF;
      v_links := array_append(v_links, v_uuid);
    END LOOP;
  END IF;

  -- Snapshot the OLD link set BEFORE replacing it, for audit evidence.
  SELECT COALESCE(jsonb_agg(package_id::text), '[]'::jsonb) INTO v_old_links
  FROM public.addon_eligible_packages WHERE addon_id = p_addon_id;

  UPDATE public.individual_addons
  SET name = COALESCE(p_name, name),
      slug = COALESCE(p_slug, slug),
      description = COALESCE(p_description, description),
      price_cents = COALESCE(p_price_cents, price_cents),
      is_active = COALESCE(p_is_active, is_active),
      display_order = COALESCE(p_display_order, display_order),
      updated_by = p_actor
  WHERE id = p_addon_id
  RETURNING * INTO v_row;

  -- Replace eligible-package links. UUIDs were pre-validated and collected
  -- into v_links during prevalidation above; do NOT append them again here, or
  -- the success response would return each supplied ID twice.
  IF p_eligible_package_ids IS NOT NULL THEN
    DELETE FROM public.addon_eligible_packages WHERE addon_id = p_addon_id;
    FOR v_pid IN SELECT jsonb_array_elements_text(p_eligible_package_ids) LOOP
      v_uuid := v_pid::uuid;
      INSERT INTO public.addon_eligible_packages (addon_id, package_id)
      VALUES (p_addon_id, v_uuid);
    END LOOP;

    -- Eligibility audit evidence: record the old -> new assignment in this txn.
    SELECT COALESCE(jsonb_agg(package_id::text), '[]'::jsonb) INTO v_new_links
    FROM public.addon_eligible_packages WHERE addon_id = p_addon_id;

    INSERT INTO public.audit_logs
      (actor_user_id, action, entity_type, entity_id, previous_values, new_values)
    VALUES
      (p_actor, 'addon_eligible_packages.update', 'individual_addons', p_addon_id::text,
       jsonb_build_object('eligiblePackageIds', v_old_links),
       jsonb_build_object('eligiblePackageIds', v_new_links));
  ELSE
    -- Return the existing links so the DTO reflects current state.
    SELECT array_agg(package_id) INTO v_links
    FROM public.addon_eligible_packages
    WHERE addon_id = p_addon_id;
    IF v_links IS NULL THEN v_links := ARRAY[]::uuid[]; END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'row', to_jsonb(v_row), 'links', to_jsonb(v_links));
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'duplicate_slug');
  WHEN check_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_value');
  WHEN foreign_key_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_reference');
  WHEN insufficient_privilege THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized');
END;
$$;

-- ----------------------------------------------------------------------------
-- update_platter_atomic
-- ----------------------------------------------------------------------------
-- Updates a shared_platters row (concurrency-guarded) in one transaction.
-- p_clear_serving_guidance distinguishes "clear to null" from "preserve".
CREATE OR REPLACE FUNCTION public.update_platter_atomic(
  p_platter_id                uuid,
  p_expected_updated_at       timestamptz,
  p_actor                     uuid,
  p_name                      varchar DEFAULT NULL,
  p_slug                      varchar DEFAULT NULL,
  p_description               text    DEFAULT NULL,
  p_price_per_platter_cents   integer DEFAULT NULL,
  p_clear_serving_guidance    boolean DEFAULT false,
  p_serving_guidance          text    DEFAULT NULL,
  p_is_active                 boolean DEFAULT NULL,
  p_display_order             integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row record;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_actor) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM public.shared_platters
  WHERE id = p_platter_id AND updated_at = p_expected_updated_at
  FOR UPDATE;
  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.shared_platters WHERE id = p_platter_id) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'not_found');
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'conflict');
  END IF;

  UPDATE public.shared_platters
  SET name = COALESCE(p_name, name),
      slug = COALESCE(p_slug, slug),
      description = COALESCE(p_description, description),
      price_per_platter_cents = COALESCE(p_price_per_platter_cents, price_per_platter_cents),
      serving_guidance = CASE
        WHEN p_clear_serving_guidance THEN NULL
        ELSE COALESCE(p_serving_guidance, serving_guidance)
      END,
      is_active = COALESCE(p_is_active, is_active),
      display_order = COALESCE(p_display_order, display_order),
      updated_by = p_actor
  WHERE id = p_platter_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'row', to_jsonb(v_row));
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'duplicate_slug');
  WHEN check_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_value');
  WHEN insufficient_privilege THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized');
END;
$$;

-- ----------------------------------------------------------------------------
-- update_guest_pricing_rules_atomic
-- ----------------------------------------------------------------------------
-- Updates the singleton guest_pricing_rules row (concurrency-guarded).
-- p_fields is a JSON object containing only the keys the caller supplied.
-- The RPC checks key presence (p_fields ? 'key') so an explicit null clears
-- the column while an absent key preserves the existing value. This
-- distinguishes omitted fields from explicit null for nullable values.
CREATE OR REPLACE FUNCTION public.update_guest_pricing_rules_atomic(
  p_expected_updated_at   timestamptz,
  p_actor                 uuid,
  p_fields                jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row record;
BEGIN
  IF p_actor IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_actor) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM public.guest_pricing_rules
  WHERE id = 1 AND updated_at = p_expected_updated_at
  FOR UPDATE;
  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.guest_pricing_rules WHERE id = 1) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'not_found');
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'conflict');
  END IF;

  UPDATE public.guest_pricing_rules
  SET senior_discount_percent = CASE WHEN p_fields ? 'seniorDiscountPercent' THEN (p_fields->>'seniorDiscountPercent')::integer ELSE senior_discount_percent END,
      senior_min_age = CASE WHEN p_fields ? 'seniorMinAge' THEN (p_fields->>'seniorMinAge')::integer ELSE senior_min_age END,
      senior_applies_to_packages = CASE WHEN p_fields ? 'seniorAppliesToPackages' THEN (p_fields->>'seniorAppliesToPackages')::boolean ELSE senior_applies_to_packages END,
      senior_applies_to_addons = CASE WHEN p_fields ? 'seniorAppliesToAddons' THEN (p_fields->>'seniorAppliesToAddons')::boolean ELSE senior_applies_to_addons END,
      senior_applies_to_platters = CASE WHEN p_fields ? 'seniorAppliesToPlatters' THEN (p_fields->>'seniorAppliesToPlatters')::boolean ELSE senior_applies_to_platters END,
      child_rule_type = CASE WHEN p_fields ? 'childRuleType' THEN (p_fields->>'childRuleType')::varchar ELSE child_rule_type END,
      child_discount_percent = CASE WHEN p_fields ? 'childDiscountPercent' THEN (p_fields->>'childDiscountPercent')::integer ELSE child_discount_percent END,
      child_fixed_package_price_cents = CASE WHEN p_fields ? 'childFixedPackagePriceCents' THEN (p_fields->>'childFixedPackagePriceCents')::integer ELSE child_fixed_package_price_cents END,
      child_max_age = CASE WHEN p_fields ? 'childMaxAge' THEN (p_fields->>'childMaxAge')::integer ELSE child_max_age END,
      child_applies_to_packages = CASE WHEN p_fields ? 'childAppliesToPackages' THEN (p_fields->>'childAppliesToPackages')::boolean ELSE child_applies_to_packages END,
      child_applies_to_addons = CASE WHEN p_fields ? 'childAppliesToAddons' THEN (p_fields->>'childAppliesToAddons')::boolean ELSE child_applies_to_addons END,
      child_applies_to_platters = CASE WHEN p_fields ? 'childAppliesToPlatters' THEN (p_fields->>'childAppliesToPlatters')::boolean ELSE child_applies_to_platters END,
      updated_by = p_actor
  WHERE id = 1
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'row', to_jsonb(v_row));
EXCEPTION
  WHEN check_violation THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_value');
  WHEN insufficient_privilege THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized');
END;
$$;

-- ----------------------------------------------------------------------------
-- Row-level security (internal config — no public access)
-- ----------------------------------------------------------------------------
ALTER TABLE public.meal_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_package_eligible_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.individual_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addon_eligible_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_platters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_pricing_rules ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies. Server-side authorization precedes
-- service-role writes; service_role bypasses RLS.

-- ----------------------------------------------------------------------------
-- Explicit table privileges
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.meal_packages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.meal_package_eligible_items FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.individual_addons FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.addon_eligible_packages FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.shared_platters FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guest_pricing_rules FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE public.meal_packages FROM service_role;
REVOKE ALL ON TABLE public.meal_package_eligible_items FROM service_role;
REVOKE ALL ON TABLE public.individual_addons FROM service_role;
REVOKE ALL ON TABLE public.addon_eligible_packages FROM service_role;
REVOKE ALL ON TABLE public.shared_platters FROM service_role;
REVOKE ALL ON TABLE public.guest_pricing_rules FROM service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.meal_packages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meal_package_eligible_items TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.individual_addons TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.addon_eligible_packages TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.shared_platters TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.guest_pricing_rules TO service_role;

-- ----------------------------------------------------------------------------
-- Trigger helper + RPC execution privileges
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.set_ordering_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_ordering_updated_at() TO service_role;

-- RPCs are service-role only. Revoke from browser roles so a leaked anon/
-- authenticated session cannot call them directly.
REVOKE EXECUTE ON FUNCTION public.create_package_atomic(uuid, varchar, varchar, text, integer, integer, integer, boolean, boolean, boolean, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_package_atomic(uuid, timestamptz, uuid, varchar, varchar, text, integer, integer, integer, boolean, boolean, boolean, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_addon_atomic(uuid, varchar, varchar, text, integer, boolean, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_addon_atomic(uuid, timestamptz, uuid, varchar, varchar, text, integer, boolean, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_platter_atomic(uuid, timestamptz, uuid, varchar, varchar, text, integer, boolean, text, boolean, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_guest_pricing_rules_atomic(timestamptz, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_package_atomic(uuid, varchar, varchar, text, integer, integer, integer, boolean, boolean, boolean, integer, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.update_package_atomic(uuid, timestamptz, uuid, varchar, varchar, text, integer, integer, integer, boolean, boolean, boolean, integer, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_addon_atomic(uuid, varchar, varchar, text, integer, boolean, integer, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.update_addon_atomic(uuid, timestamptz, uuid, varchar, varchar, text, integer, boolean, integer, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.update_platter_atomic(uuid, timestamptz, uuid, varchar, varchar, text, integer, boolean, text, boolean, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.update_guest_pricing_rules_atomic(timestamptz, uuid, jsonb)
  TO service_role;

-- ----------------------------------------------------------------------------
-- Seed the guest_pricing_rules singleton (senior 5% confirmed; child = none)
-- ----------------------------------------------------------------------------
INSERT INTO public.guest_pricing_rules
  (id, senior_discount_percent, senior_min_age, senior_applies_to_packages,
   senior_applies_to_addons, senior_applies_to_platters,
   child_rule_type, child_discount_percent, child_fixed_package_price_cents,
   child_max_age, child_applies_to_packages, child_applies_to_addons, child_applies_to_platters)
VALUES
  (1, 5, NULL, true, false, false,
   'none', NULL, NULL, NULL, true, false, false)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Documentation
-- ----------------------------------------------------------------------------
COMMENT ON TABLE public.meal_packages IS
  'Per-person meal packages (Basic/Signature/Premium) with included selection counts and eligible dishes. Price is per person; included dishes are not charged again.';

COMMENT ON COLUMN public.meal_packages.price_per_person_cents IS
  'Per-person package price in integer cents. Included dishes are covered by this price and must not be charged again.';

COMMENT ON TABLE public.meal_package_eligible_items IS
  'Links a package to the menu_items a guest may choose as an included selection, classified by selection_category (meat/side/bread/drink).';

COMMENT ON TABLE public.individual_addons IS
  'Per-guest extras priced per unit. Attached to one guest, never multiplied by party size.';

COMMENT ON TABLE public.shared_platters IS
  'Shared items priced PER PLATTER with a quantity. Belong to the party order; never multiplied by guest count.';

COMMENT ON COLUMN public.shared_platters.price_per_platter_cents IS
  'Price per platter in integer cents (never per guest). Senior/child discounts do not apply automatically.';

COMMENT ON TABLE public.guest_pricing_rules IS
  'Singleton guest pricing rules: senior discount (confirmed 5%), child rule (explicitly selected). Missing rules stay visibly unconfigured.';

COMMENT ON COLUMN public.guest_pricing_rules.senior_applies_to_platters IS
  'Senior discount never applies to shared platters automatically.';

COMMENT ON COLUMN public.guest_pricing_rules.child_applies_to_platters IS
  'Child discount never applies to shared platters automatically.';

COMMENT ON FUNCTION public.create_package_atomic IS
  'Service-role-only atomic creation of a meal package and its eligible-item set. Parent, links, and audit commit or roll back together.';

COMMENT ON FUNCTION public.update_package_atomic IS
  'Service-role-only atomic update of a meal package and its eligible-item set, with optimistic concurrency enforced inside the write.';

COMMENT ON FUNCTION public.create_addon_atomic IS
  'Service-role-only atomic creation of an individual add-on and its eligible-package links. Parent, links, and audit commit or roll back together.';

COMMENT ON FUNCTION public.update_addon_atomic IS
  'Service-role-only atomic update of an individual add-on and its eligible-package links, with optimistic concurrency enforced inside the write.';

COMMENT ON FUNCTION public.update_platter_atomic IS
  'Service-role-only atomic update of a shared platter, with optimistic concurrency enforced inside the write. p_clear_serving_guidance distinguishes clear-to-null from preserve.';

COMMENT ON FUNCTION public.update_guest_pricing_rules_atomic IS
  'Service-role-only atomic update of the singleton guest pricing rules, with optimistic concurrency enforced inside the write. p_fields key presence distinguishes omit from clear-to-null.';

COMMIT;
