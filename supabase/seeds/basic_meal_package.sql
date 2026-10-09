BEGIN;

-- Serialize repeated/concurrent executions of this seed.
SELECT pg_advisory_xact_lock(
  hashtext('sit-down-sundays'),
  hashtext('seed-basic-meal-package-v1')
);

DO $seed$
DECLARE
  v_menu_id uuid;
  v_package_id uuid;
  v_item_id uuid;
  v_count integer;
  v_expected record;
  v_menu public.menus%ROWTYPE;
  v_package public.meal_packages%ROWTYPE;
  v_item public.menu_items%ROWTYPE;
  v_expected_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  -- ================================================================
  -- 1. Dedicated DRAFT menu container
  -- ================================================================

  SELECT count(*)
  INTO v_count
  FROM public.menus
  WHERE slug = 'basic-meal-package';

  IF v_count > 1 THEN
    RAISE EXCEPTION
      'Seed stopped: multiple menus use basic-meal-package.';
  END IF;

  IF v_count = 1 THEN
    SELECT *
    INTO v_menu
    FROM public.menus
    WHERE slug = 'basic-meal-package'
    FOR UPDATE;

    IF v_menu.status IS DISTINCT FROM 'draft'
       OR v_menu.name IS DISTINCT FROM 'Basic Meal Package' THEN
      RAISE EXCEPTION
        'Seed stopped: existing basic-meal-package must be the intended draft menu named Basic Meal Package.';
    END IF;

    v_menu_id := v_menu.id;
  ELSE
    INSERT INTO public.menus (
      name,
      slug,
      description,
      status,
      display_order,
      created_by,
      updated_by
    )
    VALUES (
      'Basic Meal Package',
      'basic-meal-package',
      'Dishes included in the Basic Meal package.',
      'draft',
      100,
      auth.uid(),
      auth.uid()
    )
    RETURNING id INTO v_menu_id;
  END IF;

  -- ================================================================
  -- 2. Basic Meal package
  -- ================================================================

  SELECT count(*)
  INTO v_count
  FROM public.meal_packages
  WHERE slug = 'basic-meal';

  IF v_count > 1 THEN
    RAISE EXCEPTION
      'Seed stopped: multiple packages use basic-meal.';
  END IF;

  IF v_count = 1 THEN
    SELECT *
    INTO v_package
    FROM public.meal_packages
    WHERE slug = 'basic-meal'
    FOR UPDATE;

    IF v_package.name IS DISTINCT FROM 'Basic Meal'
       OR v_package.price_per_person_cents IS DISTINCT FROM 2950
       OR v_package.included_meats_count IS DISTINCT FROM 2
       OR v_package.included_sides_count IS DISTINCT FROM 2
       OR v_package.includes_bread IS DISTINCT FROM true
       OR v_package.includes_soft_drink IS DISTINCT FROM true
       OR v_package.is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION
        'Seed stopped: existing Basic Meal conflicts with the approved price, inclusions, name, or active status.';
    END IF;

    v_package_id := v_package.id;
  ELSE
    INSERT INTO public.meal_packages (
      name,
      slug,
      description,
      price_per_person_cents,
      included_meats_count,
      included_sides_count,
      includes_bread,
      includes_soft_drink,
      is_active,
      display_order,
      created_by,
      updated_by
    )
    VALUES (
      'Basic Meal',
      'basic-meal',
      'Choice of 2 meats and 2 sides, with rolls or cornbread and a free soft drink.',
      2950,
      2,
      2,
      true,
      true,
      true,
      10,
      auth.uid(),
      auth.uid()
    )
    RETURNING id INTO v_package_id;
  END IF;

  -- ================================================================
  -- 3. Approved dishes and eligible-item assignments
  --
  -- menu_items.category describes the course.
  -- selection_category describes its role within the package.
  -- Bread uses course category "side" and selection category "bread".
  -- ================================================================

  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        ('Slow Roasted Beef',              'main', 'meat',  10),
        ('Beef Meatballs with Gravy',      'main', 'meat',  20),
        ('D.A.''s Fried or Baked Chicken', 'main', 'meat',  30),
        ('Green Beans',                    'side', 'side',  40),
        ('Steamed Cabbage',                'side', 'side',  50),
        ('Fried Corn',                     'side', 'side',  60),
        ('Homestyle Mashed Potatoes',      'side', 'side',  70),
        ('Dinner Rolls',                   'side', 'bread', 80),
        ('Cornbread',                      'side', 'bread', 90)
    ) AS approved(
      dish_name,
      course_category,
      selection_category,
      sort_order
    )
  LOOP
    -- Detect case/whitespace variants instead of creating duplicates.
    SELECT count(*)
    INTO v_count
    FROM public.menu_items
    WHERE menu_id = v_menu_id
      AND lower(btrim(name)) = lower(v_expected.dish_name);

    IF v_count > 1 THEN
      RAISE EXCEPTION
        'Seed stopped: duplicate dish records for %.',
        v_expected.dish_name;
    END IF;

    IF v_count = 1 THEN
      SELECT *
      INTO v_item
      FROM public.menu_items
      WHERE menu_id = v_menu_id
        AND lower(btrim(name)) = lower(v_expected.dish_name)
      FOR UPDATE;

      IF v_item.name IS DISTINCT FROM v_expected.dish_name
         OR v_item.category IS DISTINCT FROM v_expected.course_category
         OR v_item.price_cents IS DISTINCT FROM 0
         OR v_item.is_active IS DISTINCT FROM true
         OR v_item.is_featured IS DISTINCT FROM false
         OR v_item.section_id IS NOT NULL THEN
        RAISE EXCEPTION
          'Seed stopped: existing dish % has conflicting values.',
          v_expected.dish_name;
      END IF;

      v_item_id := v_item.id;
    ELSE
      INSERT INTO public.menu_items (
        menu_id,
        name,
        description,
        price_cents,
        category,
        is_active,
        is_featured,
        display_order,
        created_by,
        updated_by
      )
      VALUES (
        v_menu_id,
        v_expected.dish_name,
        '',
        0,
        v_expected.course_category,
        true,
        false,
        v_expected.sort_order,
        auth.uid(),
        auth.uid()
      )
      RETURNING id INTO v_item_id;
    END IF;

    v_expected_ids := array_append(v_expected_ids, v_item_id);

    SELECT count(*)
    INTO v_count
    FROM public.meal_package_eligible_items
    WHERE package_id = v_package_id
      AND menu_item_id = v_item_id;

    IF v_count > 1 THEN
      RAISE EXCEPTION
        'Seed stopped: duplicate package assignments for %.',
        v_expected.dish_name;
    END IF;

    IF v_count = 1 THEN
      IF EXISTS (
        SELECT 1
        FROM public.meal_package_eligible_items
        WHERE package_id = v_package_id
          AND menu_item_id = v_item_id
          AND selection_category
              IS DISTINCT FROM v_expected.selection_category
      ) THEN
        RAISE EXCEPTION
          'Seed stopped: incorrect selection category for %.',
          v_expected.dish_name;
      END IF;
    ELSE
      INSERT INTO public.meal_package_eligible_items (
        package_id,
        menu_item_id,
        selection_category
      )
      VALUES (
        v_package_id,
        v_item_id,
        v_expected.selection_category
      );
    END IF;
  END LOOP;

  -- ================================================================
  -- 4. Final assertions: reject unexpected data, never delete it
  -- ================================================================

  IF EXISTS (
    SELECT 1
    FROM public.menu_items
    WHERE menu_id = v_menu_id
      AND NOT (id = ANY(v_expected_ids))
  ) THEN
    RAISE EXCEPTION
      'Seed stopped: the dedicated menu contains unexpected dishes.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.meal_package_eligible_items
    WHERE package_id = v_package_id
      AND NOT (menu_item_id = ANY(v_expected_ids))
  ) THEN
    RAISE EXCEPTION
      'Seed stopped: Basic Meal has unexpected eligible dishes.';
  END IF;

  IF (
    SELECT count(*)
    FROM public.meal_package_eligible_items
    WHERE package_id = v_package_id
  ) <> 9
  OR (
    SELECT count(*)
    FROM public.meal_package_eligible_items
    WHERE package_id = v_package_id
      AND selection_category = 'meat'
  ) <> 3
  OR (
    SELECT count(*)
    FROM public.meal_package_eligible_items
    WHERE package_id = v_package_id
      AND selection_category = 'side'
  ) <> 4
  OR (
    SELECT count(*)
    FROM public.meal_package_eligible_items
    WHERE package_id = v_package_id
      AND selection_category = 'bread'
  ) <> 2 THEN
    RAISE EXCEPTION
      'Seed stopped: expected exactly 3 meats, 4 sides, and 2 breads.';
  END IF;
END;
$seed$;

COMMIT;

-- Verification: expect nine rows.
SELECT
  p.name AS package_name,
  p.price_per_person_cents,
  p.included_meats_count,
  p.included_sides_count,
  p.includes_bread,
  p.includes_soft_drink,
  p.is_active AS package_active,
  e.selection_category,
  i.name AS dish_name,
  i.price_cents AS component_price_cents,
  i.is_active AS dish_active,
  m.status AS parent_menu_status
FROM public.meal_packages AS p
JOIN public.meal_package_eligible_items AS e
  ON e.package_id = p.id
JOIN public.menu_items AS i
  ON i.id = e.menu_item_id
JOIN public.menus AS m
  ON m.id = i.menu_id
WHERE p.slug = 'basic-meal'
ORDER BY i.display_order, i.name;