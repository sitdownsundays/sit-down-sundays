BEGIN;

-- Coordinate with the earlier Basic seed and concurrent runs of this seed.
SELECT pg_advisory_xact_lock(
  hashtext('sit-down-sundays'),
  hashtext('seed-basic-meal-package-v1')
);

SELECT pg_advisory_xact_lock(
  hashtext('sit-down-sundays'),
  hashtext('seed-signature-premium-v1')
);

-- Temporary working data; automatically removed at commit.
CREATE TEMP TABLE sds_feast_seed_items (
  dish_name text PRIMARY KEY,
  selection_category text NOT NULL,
  minimum_tier integer NOT NULL,
  sort_order integer NOT NULL,
  item_id uuid
) ON COMMIT DROP;

-- Tier 1 records are reused from the existing Basic container.
-- Tier 2 records are available to Signature and Premium.
-- Tier 3 records are exclusive to Premium.
INSERT INTO sds_feast_seed_items (
  dish_name,
  selection_category,
  minimum_tier,
  sort_order
)
VALUES
  ('Slow Roasted Beef',                 'meat',  1, 10),
  ('Beef Meatballs with Gravy',         'meat',  1, 20),
  ('D.A.''s Fried or Baked Chicken',    'meat',  1, 30),

  ('Fried or Baked Tilapia Fillet',     'meat',  2, 40),
  ('Fried or Baked Catfish Fillet',     'meat',  2, 50),
  ('Fried Catfish Steak',               'meat',  2, 60),
  ('Turkey Meat Loaf',                  'meat',  2, 70),
  ('Smothered Porkchops',               'meat',  2, 80),

  ('Short Ribs',                       'meat',  3, 90),
  ('Corn Beef',                        'meat',  3, 100),
  ('Salmon Croquettes',                'meat',  3, 110),
  ('Turkey Wings',                     'meat',  3, 120),
  ('Roasted Turkey Wing Flats',        'meat',  3, 130),
  ('Smothered Turkey Wing Flats W/Gravy','meat', 3, 140),

  ('Green Beans',                      'side',  1, 150),
  ('Steamed Cabbage',                   'side',  1, 160),
  ('Fried Corn',                        'side',  1, 170),
  ('Homestyle Mashed Potatoes',         'side',  1, 180),

  ('Collard Greens',                   'side',  2, 190),
  ('Macaroni & Cheese',                'side',  2, 200),
  ('Sweet Potatoes',                   'side',  2, 210),
  ('Spaghetti with Marinara Sauce',    'side',  2, 220),

  ('Rice',                            'side',  3, 230),
  ('Cornbread Dressing',               'side',  3, 240),
  ('Baked Mostaccioli',                'side',  3, 250),

  ('Dinner Rolls',                     'bread', 1, 260),
  ('Cornbread',                        'bread', 1, 270);

DO $seed$
DECLARE
  v_basic_menu_id uuid;
  v_extra_menu_id uuid;
  v_target_menu_id uuid;
  v_package_id uuid;
  v_item_id uuid;
  v_course text;
  v_count integer;
  v_expected_count integer;
  v_dish record;
  v_package_spec record;
  v_menu public.menus%ROWTYPE;
  v_item public.menu_items%ROWTYPE;
  v_package public.meal_packages%ROWTYPE;
BEGIN
  -- ================================================================
  -- 1. Verify the already-seeded Basic container. Never modify it.
  -- ================================================================

  SELECT count(*)
  INTO v_count
  FROM public.menus
  WHERE slug = 'basic-meal-package';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'Seed stopped: expected exactly one existing basic-meal-package menu.';
  END IF;

  SELECT *
  INTO v_menu
  FROM public.menus
  WHERE slug = 'basic-meal-package'
  FOR UPDATE;

  IF v_menu.name IS DISTINCT FROM 'Basic Meal Package'
     OR v_menu.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION
      'Seed stopped: Basic Meal Package must remain the intended draft container.';
  END IF;

  v_basic_menu_id := v_menu.id;

  -- ================================================================
  -- 2. Dedicated draft container for additional package components.
  -- ================================================================

  SELECT count(*)
  INTO v_count
  FROM public.menus
  WHERE slug = 'feast-package-components';

  IF v_count > 1 THEN
    RAISE EXCEPTION
      'Seed stopped: duplicate feast-package-components menu slug.';
  END IF;

  IF v_count = 1 THEN
    SELECT *
    INTO v_menu
    FROM public.menus
    WHERE slug = 'feast-package-components'
    FOR UPDATE;

    IF v_menu.name IS DISTINCT FROM 'Feast Package Components'
       OR v_menu.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION
        'Seed stopped: existing Feast Package Components menu conflicts with this seed.';
    END IF;

    v_extra_menu_id := v_menu.id;
  ELSE
    INSERT INTO public.menus (
      name, slug, description, status, display_order,
      created_by, updated_by
    )
    VALUES (
      'Feast Package Components',
      'feast-package-components',
      'Additional included dishes for Signature and Premium meal packages.',
      'draft',
      110,
      auth.uid(),
      auth.uid()
    )
    RETURNING id INTO v_extra_menu_id;
  END IF;

  -- ================================================================
  -- 3. Reuse Basic dishes; create only additional approved dishes.
  -- ================================================================

  FOR v_dish IN
    SELECT *
    FROM sds_feast_seed_items
    ORDER BY sort_order
  LOOP
    v_target_menu_id :=
      CASE WHEN v_dish.minimum_tier = 1
        THEN v_basic_menu_id
        ELSE v_extra_menu_id
      END;

    v_course :=
      CASE WHEN v_dish.selection_category = 'meat'
        THEN 'main'
        ELSE 'side'
      END;

    SELECT count(*)
    INTO v_count
    FROM public.menu_items
    WHERE menu_id = v_target_menu_id
      AND lower(btrim(name)) = lower(v_dish.dish_name);

    IF v_count > 1 THEN
      RAISE EXCEPTION
        'Seed stopped: duplicate dish records for %.',
        v_dish.dish_name;
    END IF;

    IF v_count = 1 THEN
      SELECT *
      INTO v_item
      FROM public.menu_items
      WHERE menu_id = v_target_menu_id
        AND lower(btrim(name)) = lower(v_dish.dish_name)
      FOR UPDATE;

      IF v_item.name IS DISTINCT FROM v_dish.dish_name
         OR v_item.category IS DISTINCT FROM v_course
         OR v_item.price_cents IS DISTINCT FROM 0
         OR v_item.is_active IS DISTINCT FROM true
         OR v_item.is_featured IS DISTINCT FROM false
         OR v_item.section_id IS NOT NULL THEN
        RAISE EXCEPTION
          'Seed stopped: existing dish % has conflicting values.',
          v_dish.dish_name;
      END IF;

      v_item_id := v_item.id;
    ELSE
      IF v_dish.minimum_tier = 1 THEN
        RAISE EXCEPTION
          'Seed stopped: approved Basic dish % is missing. Basic was not modified.',
          v_dish.dish_name;
      END IF;

      INSERT INTO public.menu_items (
        menu_id, name, description, price_cents, category,
        is_active, is_featured, display_order,
        created_by, updated_by
      )
      VALUES (
        v_target_menu_id,
        v_dish.dish_name,
        '',
        0,
        v_course,
        true,
        false,
        v_dish.sort_order,
        auth.uid(),
        auth.uid()
      )
      RETURNING id INTO v_item_id;
    END IF;

    UPDATE sds_feast_seed_items
    SET item_id = v_item_id
    WHERE dish_name = v_dish.dish_name;
  END LOOP;

  -- Do not silently adopt a container with unrelated dishes.
  IF EXISTS (
    SELECT 1
    FROM public.menu_items AS i
    WHERE i.menu_id = v_extra_menu_id
      AND NOT EXISTS (
        SELECT 1
        FROM sds_feast_seed_items AS expected
        WHERE expected.item_id = i.id
          AND expected.minimum_tier > 1
      )
  ) THEN
    RAISE EXCEPTION
      'Seed stopped: Feast Package Components contains unexpected dishes.';
  END IF;

  -- ================================================================
  -- 4. Create or validate Signature and Premium, then assign dishes.
  -- ================================================================

  FOR v_package_spec IN
    SELECT *
    FROM (
      VALUES
        (
          'Signature Meal',
          'signature-meal',
          3450,
          2,
          2,
          20,
          'Choice of 2 meats and 2 sides, with rolls or cornbread and a free soft drink.'
        ),
        (
          'Premium Meal',
          'premium-meal',
          4450,
          3,
          3,
          30,
          'Choice of 2 meats and 3 sides, with rolls or cornbread and a free soft drink.'
        )
    ) AS packages(
      package_name,
      package_slug,
      price_cents,
      side_count,
      tier,
      sort_order,
      description
    )
  LOOP
    SELECT count(*)
    INTO v_count
    FROM public.meal_packages
    WHERE slug = v_package_spec.package_slug;

    IF v_count > 1 THEN
      RAISE EXCEPTION
        'Seed stopped: duplicate package slug %.',
        v_package_spec.package_slug;
    END IF;

    IF v_count = 1 THEN
      SELECT *
      INTO v_package
      FROM public.meal_packages
      WHERE slug = v_package_spec.package_slug
      FOR UPDATE;

      IF v_package.name IS DISTINCT FROM v_package_spec.package_name
         OR v_package.price_per_person_cents
              IS DISTINCT FROM v_package_spec.price_cents
         OR v_package.included_meats_count IS DISTINCT FROM 2
         OR v_package.included_sides_count
              IS DISTINCT FROM v_package_spec.side_count
         OR v_package.includes_bread IS DISTINCT FROM true
         OR v_package.includes_soft_drink IS DISTINCT FROM true
         OR v_package.is_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION
          'Seed stopped: existing package % conflicts with approved settings.',
          v_package_spec.package_name;
      END IF;

      v_package_id := v_package.id;
    ELSE
      -- Detect an existing same-name package under a different slug.
      IF EXISTS (
        SELECT 1
        FROM public.meal_packages
        WHERE lower(btrim(name)) =
              lower(v_package_spec.package_name)
      ) THEN
        RAISE EXCEPTION
          'Seed stopped: % already exists under another slug.',
          v_package_spec.package_name;
      END IF;

      INSERT INTO public.meal_packages (
        name, slug, description, price_per_person_cents,
        included_meats_count, included_sides_count,
        includes_bread, includes_soft_drink,
        is_active, display_order, created_by, updated_by
      )
      VALUES (
        v_package_spec.package_name,
        v_package_spec.package_slug,
        v_package_spec.description,
        v_package_spec.price_cents,
        2,
        v_package_spec.side_count,
        true,
        true,
        true,
        v_package_spec.sort_order,
        auth.uid(),
        auth.uid()
      )
      RETURNING id INTO v_package_id;
    END IF;

    -- Reject extra dishes or incorrect classifications.
    IF EXISTS (
      SELECT 1
      FROM public.meal_package_eligible_items AS e
      WHERE e.package_id = v_package_id
        AND NOT EXISTS (
          SELECT 1
          FROM sds_feast_seed_items AS expected
          WHERE expected.minimum_tier <= v_package_spec.tier
            AND expected.item_id = e.menu_item_id
            AND expected.selection_category = e.selection_category
        )
    ) THEN
      RAISE EXCEPTION
        'Seed stopped: % has unexpected or misclassified eligible dishes.',
        v_package_spec.package_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.meal_package_eligible_items
      WHERE package_id = v_package_id
      GROUP BY menu_item_id
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION
        'Seed stopped: % has duplicate eligible-item assignments.',
        v_package_spec.package_name;
    END IF;

    INSERT INTO public.meal_package_eligible_items (
      package_id, menu_item_id, selection_category
    )
    SELECT
      v_package_id,
      expected.item_id,
      expected.selection_category
    FROM sds_feast_seed_items AS expected
    WHERE expected.minimum_tier <= v_package_spec.tier
      AND NOT EXISTS (
        SELECT 1
        FROM public.meal_package_eligible_items AS e
        WHERE e.package_id = v_package_id
          AND e.menu_item_id = expected.item_id
      );

    SELECT count(*)
    INTO v_expected_count
    FROM sds_feast_seed_items
    WHERE minimum_tier <= v_package_spec.tier;

    SELECT count(*)
    INTO v_count
    FROM public.meal_package_eligible_items
    WHERE package_id = v_package_id;

    IF v_count <> v_expected_count THEN
      RAISE EXCEPTION
        'Seed stopped: incorrect eligible-item count for %.',
        v_package_spec.package_name;
    END IF;
  END LOOP;
END;
$seed$;

COMMIT;

-- Verification:
-- Basic:     2950 cents, choose 2/2, options 3 meats / 4 sides / 2 breads.
-- Signature: 3450 cents, choose 2/2, options 8 meats / 8 sides / 2 breads.
-- Premium:   4450 cents, choose 2/3, options 14 meats / 11 sides / 2 breads.

SELECT
  p.name AS package_name,
  p.price_per_person_cents,
  p.included_meats_count AS choose_meats,
  p.included_sides_count AS choose_sides,
  p.includes_bread,
  p.includes_soft_drink,
  p.is_active,
  count(*) FILTER (
    WHERE e.selection_category = 'meat'
  ) AS available_meats,
  count(*) FILTER (
    WHERE e.selection_category = 'side'
  ) AS available_sides,
  count(*) FILTER (
    WHERE e.selection_category = 'bread'
  ) AS available_breads
FROM public.meal_packages AS p
LEFT JOIN public.meal_package_eligible_items AS e
  ON e.package_id = p.id
WHERE p.slug IN ('basic-meal', 'signature-meal', 'premium-meal')
GROUP BY
  p.id, p.name, p.price_per_person_cents,
  p.included_meats_count, p.included_sides_count,
  p.includes_bread, p.includes_soft_drink,
  p.is_active, p.display_order
ORDER BY p.display_order, p.name;