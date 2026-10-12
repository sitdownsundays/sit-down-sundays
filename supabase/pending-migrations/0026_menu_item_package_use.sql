-- 0026: explicit menu-item package-use classification.
-- Apply ONCE. Storage only; admin controls and selector wiring follow separately.
-- No inferred classification, price changes, or package-assignment changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.menu_items
  ADD COLUMN package_use_categories text[] NOT NULL DEFAULT '{}'::text[];

-- Multiple uses are allowed. Nonempty arrays must be one-dimensional,
-- one-based, contain only recognized values, and contain no NULLs/duplicates.
ALTER TABLE public.menu_items
  ADD CONSTRAINT check_menu_item_package_use_0026 CHECK (
    CASE
      WHEN cardinality(package_use_categories) = 0 THEN true
      WHEN array_ndims(package_use_categories) IS DISTINCT FROM 1
        OR array_lower(package_use_categories, 1) IS DISTINCT FROM 1 THEN false
      ELSE
        cardinality(package_use_categories) BETWEEN 1 AND 4
        AND array_position(package_use_categories, NULL::text) IS NULL
        AND package_use_categories <@ ARRAY['meat','side','bread','drink']::text[]
        AND cardinality(package_use_categories) = (
          CASE WHEN 'meat' = ANY(package_use_categories) THEN 1 ELSE 0 END
          + CASE WHEN 'side' = ANY(package_use_categories) THEN 1 ELSE 0 END
          + CASE WHEN 'bread' = ANY(package_use_categories) THEN 1 ELSE 0 END
          + CASE WHEN 'drink' = ANY(package_use_categories) THEN 1 ELSE 0 END
        )
    END
  );

COMMENT ON COLUMN public.menu_items.package_use_categories IS
  'Explicit package-use designations: meat=meat/protein selection, side=side selection, bread=bread/rolls selection, drink=included beverage selection. Multiple distinct values allowed. Empty array means no package use explicitly assigned, not automatic eligibility or inheritance from the course category. The existing category remains a separate course classification. Existing package eligible-item links are unchanged; application/admin wiring follows separately. Optional party-level pitchers remain in the shared-platter catalog.';

-- Existing items receive an empty array. No categories or names are used to
-- guess their intended use. No links are copied, removed, or reclassified.
-- Existing RLS, grants, timestamp/audit triggers, and RPCs remain unchanged.
NOTIFY pgrst, 'reload schema';
COMMIT;

SELECT column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'menu_items'
  AND column_name = 'package_use_categories';

SELECT conname AS constraint_name, convalidated AS validated,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.menu_items'::regclass
  AND conname = 'check_menu_item_package_use_0026';
