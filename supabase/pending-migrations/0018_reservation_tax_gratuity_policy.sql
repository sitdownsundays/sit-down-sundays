-- ============================================================================
-- Sit Down Sundays — 0018_reservation_tax_gratuity_policy.sql
-- ============================================================================
-- ADDITIVE migration: tax & gratuity policy STORAGE ONLY on the existing
-- public.payment_policy singleton (defined in 0010).
--
-- Adds three NULLABLE configuration columns:
--   * tax_rate_basis_points        integer   (0–10000 inclusive, or NULL)
--   * gratuity_rate_basis_points   integer   (0–10000 inclusive, or NULL)
--   * tax_on_gratuity              boolean   (true/false, or NULL)
--
-- NULL means NOT CONFIGURED — not zero, not tax-exempt, and not an implicit
-- default. This migration does NOT backfill any values and does NOT activate a
-- tax policy. The proposed 10% tax / 18% gratuity rates are deliberately NOT
-- set here; staff configure them in /admin/settings after owner/accountant
-- confirmation. Wiring the pure calculateReservationCharges helper into
-- authoritative pricing, snapshots, and customer displays is a SUBSEQUENT
-- bounded task.
--
-- DESIGN NOTES:
--   * The existing deposit_percent applies to the DISCOUNTED food subtotal
--     only. These three new settings determine ADDITIONAL charges (gratuity,
--     tax) layered on top of that subtotal. The deposit base is unchanged and
--     explicitly never includes tax or gratuity.
--   * No calculation, pricing, payment-status, reservation, or order-snapshot
--     changes are made in this migration. It is storage only.
--   * Preserves every existing payment_policy column, constraint, RLS policy,
--     grant, audit trigger (trg_payment_policy_audit → audit_cms_change),
--     and timestamp trigger (trg_payment_policy_updated_at →
--     set_sundays_updated_at). No trigger or grant is redefined here.
--
-- STATUS: REVIEWED DRAFT / UNAPPLIED. PostgreSQL execution has NOT been
-- performed. Apply as database owner after 0017. Does NOT modify or reapply
-- 0001–0017. Wrapped in BEGIN/COMMIT so it applies atomically.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Add the three nullable policy columns
-- ----------------------------------------------------------------------------
-- No default: NULL means "not configured". Existing rows keep their current
-- values and remain valid (the new columns are simply absent → NULL).
ALTER TABLE public.payment_policy
  ADD COLUMN IF NOT EXISTS tax_rate_basis_points integer;

ALTER TABLE public.payment_policy
  ADD COLUMN IF NOT EXISTS gratuity_rate_basis_points integer;

ALTER TABLE public.payment_policy
  ADD COLUMN IF NOT EXISTS tax_on_gratuity boolean;

-- ----------------------------------------------------------------------------
-- 2. Constraints — rate ranges (0–10000 inclusive when supplied)
-- ----------------------------------------------------------------------------
-- NULL is allowed (not configured). A supplied value must be a valid basis
-- point rate. 10000 = 100%. These mirror the calculateReservationCharges
-- helper's validation, but at the database layer for defense in depth.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_payment_policy_tax_rate_basis_points'
      AND conrelid = 'public.payment_policy'::regclass
  ) THEN
    ALTER TABLE public.payment_policy
      ADD CONSTRAINT check_payment_policy_tax_rate_basis_points
      CHECK (
        tax_rate_basis_points IS NULL
        OR (tax_rate_basis_points >= 0 AND tax_rate_basis_points <= 10000)
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_payment_policy_gratuity_rate_basis_points'
      AND conrelid = 'public.payment_policy'::regclass
  ) THEN
    ALTER TABLE public.payment_policy
      ADD CONSTRAINT check_payment_policy_gratuity_rate_basis_points
      CHECK (
        gratuity_rate_basis_points IS NULL
        OR (gratuity_rate_basis_points >= 0 AND gratuity_rate_basis_points <= 10000)
      );
  END IF;
END $$;

-- tax_on_gratuity is a plain nullable boolean. No range constraint is needed;
-- NULL means "taxability of gratuity not yet decided". The application pricing
-- helper treats a missing taxOnGratuity as a hard failure (no implicit
-- default), so the authoritative path will reject unconfigured tax scenarios
-- rather than guessing.

-- ----------------------------------------------------------------------------
-- 3. Documentation
-- ----------------------------------------------------------------------------
COMMENT ON COLUMN public.payment_policy.tax_rate_basis_points IS
  'Sales-tax rate in basis points (1000 = 10%). NULL means not configured — NOT zero and NOT tax-exempt. Staff configure after owner/accountant confirmation. Determines tax on the taxable amount; does not change the deposit base.';

COMMENT ON COLUMN public.payment_policy.gratuity_rate_basis_points IS
  'Mandatory gratuity rate in basis points (1800 = 18%). NULL means not configured — NOT zero and NOT waived. Staff configure after owner/accountant confirmation. Determined additional charge only; never included in the deposit base.';

COMMENT ON COLUMN public.payment_policy.tax_on_gratuity IS
  'When true, gratuity is included in the taxable amount; when false, tax applies to the food subtotal only. NULL means not configured — the authoritative pricing path must reject an unconfigured tax scenario rather than guessing. Explicit configuration choice pending owner/accountant confirmation.';

COMMENT ON TABLE public.payment_policy IS
  'Singleton payment policy: deposit percentage, default balance deadline hours, restaurant timezone, and optional tax/gratuity rates. Confirmed defaults are 50% deposit and 72-hour balance deadline. tax_rate_basis_points, gratuity_rate_basis_points, and tax_on_gratuity are NULL until staff configure them. The deposit applies to the discounted food subtotal only; tax and gratuity are additional charges and are never part of the deposit base. Per-reservation overrides are a future phase.';

-- ----------------------------------------------------------------------------
-- 4. No RLS / grant / trigger changes
-- ----------------------------------------------------------------------------
-- payment_policy already has RLS enabled with no anon/authenticated policies
-- (0010) and service_role has SELECT, INSERT, UPDATE (0010). The existing
-- timestamp trigger (trg_payment_policy_updated_at → set_sundays_updated_at)
-- and audit trigger (trg_payment_policy_audit → audit_cms_change) already
-- fire on UPDATE of any column and will cover the new columns automatically.
-- No new grants, policies, or triggers are added or redefined here.

COMMIT;

-- ============================================================================
-- READ-ONLY VERIFICATION QUERY (run separately after applying)
-- ============================================================================
-- Shows the three new columns, their constraints, and the existing policy
-- values. The three new columns should be NULL until staff configure them.
--
-- SELECT
--   pp.id,
--   pp.deposit_percent,
--   pp.default_balance_deadline_hours,
--   pp.restaurant_timezone,
--   pp.tax_rate_basis_points,
--   pp.gratuity_rate_basis_points,
--   pp.tax_on_gratuity,
--   pp.created_at,
--   pp.updated_at
-- FROM public.payment_policy pp;
--
-- -- Confirm the three new constraints exist on the table:
-- SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
-- FROM pg_constraint con
-- JOIN pg_class rel ON rel.oid = con.conrelid
-- JOIN pg_namespace nsp ON nsp.oid = connamespace
-- WHERE nsp.nspname = 'public'
--   AND rel.relname = 'payment_policy'
--   AND con.conname IN (
--     'check_payment_policy_tax_rate_basis_points',
--     'check_payment_policy_gratuity_rate_basis_points',
--     'check_payment_policy_deposit_percent',
--     'check_payment_policy_deadline_hours',
--     'payment_policy_single_row'
--   )
-- ORDER BY con.conname;
--
-- -- Confirm the three new columns are nullable and have no default:
-- SELECT
--   a.attname AS column_name,
--   format_type(a.atttypid, a.atttypmod) AS data_type,
--   a.attnotnull AS not_null,
--   pg_get_expr(d.adbin, d.adrelid) AS default_value
-- FROM pg_attribute a
-- JOIN pg_class rel ON rel.oid = a.attrelid
-- JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
-- LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
-- WHERE nsp.nspname = 'public'
--   AND rel.relname = 'payment_policy'
--   AND a.attname IN (
--     'tax_rate_basis_points',
--     'gratuity_rate_basis_points',
--     'tax_on_gratuity'
--   )
-- ORDER BY a.attname;
-- ============================================================================
