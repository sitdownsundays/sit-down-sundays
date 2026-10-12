-- 0024: independent child and senior pricing on each meal package.
-- Apply ONCE. Storage only: application pricing/editor wiring follows separately.
-- No package prices, global rules, reservations, or payment records are updated.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.meal_packages
  ADD COLUMN child_rule_type text,
  ADD COLUMN child_fixed_price_cents integer,
  ADD COLUMN child_discount_basis_points integer,
  ADD COLUMN senior_rule_type text,
  ADD COLUMN senior_fixed_price_cents integer,
  ADD COLUMN senior_discount_basis_points integer;

-- NULL rule + NULL amounts means no package override yet: retain the existing
-- global behavior until application wiring and explicit owner configuration.
-- 'none' is DIFFERENT: explicitly charge this package's regular price.
-- 100 basis points = 1%; 1250 = 12.50%. Money is stored in integer cents.
-- Fixed prices may not exceed this package's regular price (no surcharge).
ALTER TABLE public.meal_packages
  ADD CONSTRAINT check_package_child_pricing_0024 CHECK (
    CASE
      WHEN child_rule_type IS NULL THEN
        child_fixed_price_cents IS NULL AND child_discount_basis_points IS NULL
      WHEN child_rule_type = 'none' THEN
        child_fixed_price_cents IS NULL AND child_discount_basis_points IS NULL
      WHEN child_rule_type = 'fixed_package_price' THEN
        child_fixed_price_cents IS NOT NULL
        AND child_fixed_price_cents BETWEEN 0 AND price_per_person_cents
        AND child_discount_basis_points IS NULL
      WHEN child_rule_type = 'percentage_discount' THEN
        child_discount_basis_points IS NOT NULL
        AND child_discount_basis_points BETWEEN 0 AND 10000
        AND child_fixed_price_cents IS NULL
      ELSE false
    END
  ),
  ADD CONSTRAINT check_package_senior_pricing_0024 CHECK (
    CASE
      WHEN senior_rule_type IS NULL THEN
        senior_fixed_price_cents IS NULL AND senior_discount_basis_points IS NULL
      WHEN senior_rule_type = 'none' THEN
        senior_fixed_price_cents IS NULL AND senior_discount_basis_points IS NULL
      WHEN senior_rule_type = 'fixed_package_price' THEN
        senior_fixed_price_cents IS NOT NULL
        AND senior_fixed_price_cents BETWEEN 0 AND price_per_person_cents
        AND senior_discount_basis_points IS NULL
      WHEN senior_rule_type = 'percentage_discount' THEN
        senior_discount_basis_points IS NOT NULL
        AND senior_discount_basis_points BETWEEN 0 AND 10000
        AND senior_fixed_price_cents IS NULL
      ELSE false
    END
  );

COMMENT ON COLUMN public.meal_packages.child_rule_type IS
  'Package-specific child rule: NULL=legacy global behavior until configured; none=regular package price; fixed_package_price=explicit cents; percentage_discount=explicit basis points. Never stack this override with the global package discount. Age eligibility remains global. Does not affect extras or saved reservations.';
COMMENT ON COLUMN public.meal_packages.child_fixed_price_cents IS
  'Final child package price in integer cents, not an amount to subtract. Required only for fixed_package_price; between zero and regular package price. NULL otherwise.';
COMMENT ON COLUMN public.meal_packages.child_discount_basis_points IS
  'Child percentage reduction from the regular package price. Integer basis points: 100=1%, 1250=12.50%, 10000=100%. Required only for percentage_discount; NULL otherwise.';
COMMENT ON COLUMN public.meal_packages.senior_rule_type IS
  'Package-specific senior rule: NULL=legacy global behavior until configured; none=regular package price; fixed_package_price=explicit cents; percentage_discount=explicit basis points. Never stack this override with the global package discount. Age eligibility remains global. Does not affect extras or saved reservations.';
COMMENT ON COLUMN public.meal_packages.senior_fixed_price_cents IS
  'Final senior package price in integer cents, not an amount to subtract. Required only for fixed_package_price; between zero and regular package price. NULL otherwise.';
COMMENT ON COLUMN public.meal_packages.senior_discount_basis_points IS
  'Senior percentage reduction from the regular package price. Integer basis points: 100=1%, 1250=12.50%, 10000=100%. Required only for percentage_discount; NULL otherwise.';

-- Existing meal_packages RLS, grants, audit and timestamp triggers are retained.
-- Existing create/update RPCs are NOT extended by this storage-only migration.
-- No backfill: all six new fields start NULL. No configured discounts invented.
COMMIT;

-- Verification: six nullable columns and two validated CHECK constraints.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'meal_packages'
  AND column_name IN (
    'child_rule_type', 'child_fixed_price_cents', 'child_discount_basis_points',
    'senior_rule_type', 'senior_fixed_price_cents', 'senior_discount_basis_points'
  )
ORDER BY column_name;

SELECT conname AS constraint_name, convalidated AS validated,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.meal_packages'::regclass
  AND conname IN ('check_package_child_pricing_0024', 'check_package_senior_pricing_0024')
ORDER BY conname;
