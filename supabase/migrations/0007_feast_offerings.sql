-- 0007_feast_offerings.sql
-- Independent, display-only "Choose Your Feast" showcase.
-- Does not modify existing menus or implement booking/pricing rules.
-- Requires migrations 0001–0006, including audit_cms_change().

BEGIN;

-- 1. Showcase table
CREATE TABLE IF NOT EXISTS public.feast_offerings (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   varchar(120) NOT NULL,
  slug                   varchar(120) NOT NULL,
  description            text NOT NULL DEFAULT '',
  price_per_person_cents integer,
  inclusions             text[] NOT NULL DEFAULT '{}'::text[],
  cover_image_url         text,
  cover_image_alt         varchar(300),
  is_published            boolean NOT NULL DEFAULT false,
  display_order           integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- 2. Constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'feast_offerings_slug_key'
      AND conrelid = 'public.feast_offerings'::regclass
  ) THEN
    ALTER TABLE public.feast_offerings
      ADD CONSTRAINT feast_offerings_slug_key UNIQUE (slug);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'check_feast_offerings_slug_format'
      AND conrelid = 'public.feast_offerings'::regclass
  ) THEN
    ALTER TABLE public.feast_offerings
      ADD CONSTRAINT check_feast_offerings_slug_format
      CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'check_feast_offerings_price_per_person_cents'
      AND conrelid = 'public.feast_offerings'::regclass
  ) THEN
    ALTER TABLE public.feast_offerings
      ADD CONSTRAINT check_feast_offerings_price_per_person_cents
      CHECK (
        price_per_person_cents IS NULL
        OR (
          price_per_person_cents >= 0
          AND price_per_person_cents <= 1000000
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'check_feast_offerings_display_order'
      AND conrelid = 'public.feast_offerings'::regclass
  ) THEN
    ALTER TABLE public.feast_offerings
      ADD CONSTRAINT check_feast_offerings_display_order
      CHECK (display_order >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'check_feast_offerings_cover_image_alt_required'
      AND conrelid = 'public.feast_offerings'::regclass
  ) THEN
    ALTER TABLE public.feast_offerings
      ADD CONSTRAINT check_feast_offerings_cover_image_alt_required
      CHECK (
        cover_image_url IS NULL
        OR length(trim(cover_image_url)) = 0
        OR (
          cover_image_alt IS NOT NULL
          AND length(trim(cover_image_alt)) > 0
        )
      );
  END IF;
END;
$$;

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_feast_offerings_display_order
  ON public.feast_offerings (display_order);

CREATE INDEX IF NOT EXISTS idx_feast_offerings_published
  ON public.feast_offerings (is_published)
  WHERE is_published = true;

-- 4. Automatically update updated_at
-- SECURITY INVOKER: runs with the invoking role's privileges.
CREATE OR REPLACE FUNCTION public.set_feast_offerings_updated_at()
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

DROP TRIGGER IF EXISTS trg_feast_offerings_updated_at
  ON public.feast_offerings;

CREATE TRIGGER trg_feast_offerings_updated_at
  BEFORE UPDATE ON public.feast_offerings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_feast_offerings_updated_at();

-- 5. Atomic audit logging
-- Reuse the existing audit function without changing its definition,
-- ownership, security mode, or privileges.
-- Audit INSERT and the content mutation share the same transaction.
-- Actor comes from created_by on INSERT and updated_by on UPDATE.
DROP TRIGGER IF EXISTS trg_feast_offerings_audit
  ON public.feast_offerings;

CREATE TRIGGER trg_feast_offerings_audit
  AFTER INSERT OR UPDATE ON public.feast_offerings
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_cms_change();

-- 6. Row-level security
ALTER TABLE public.feast_offerings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feast_offerings_public_read"
  ON public.feast_offerings;

CREATE POLICY "feast_offerings_public_read"
  ON public.feast_offerings
  FOR SELECT
  TO anon, authenticated
  USING (is_published = true);

-- No browser INSERT/UPDATE/DELETE policies.
-- Server-side authorization must precede service-role writes.

-- 7. Explicit table privileges
REVOKE ALL ON TABLE public.feast_offerings
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.feast_offerings
  TO anon, authenticated;

-- Remove any default grants before assigning server permissions.
REVOKE ALL ON TABLE public.feast_offerings
  FROM service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.feast_offerings
  TO service_role;

-- 8. Trigger helper privileges
REVOKE EXECUTE ON FUNCTION public.set_feast_offerings_updated_at()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_feast_offerings_updated_at()
  TO service_role;

-- 9. Documentation
COMMENT ON TABLE public.feast_offerings IS
  'Display-only Choose Your Feast showcase cards. Independent of the Menu CMS and future booking package engine.';

COMMENT ON COLUMN public.feast_offerings.price_per_person_cents IS
  'Display-only per-person price in integer cents. Null means no displayed price. Not a booking calculation input. Maximum 1000000 cents is an application safety limit, not a business price.';

COMMENT ON COLUMN public.feast_offerings.inclusions IS
  'Display-only inclusion statements. Not structured selection rules and never used to validate meal choices or calculate booking totals.';

COMMENT ON COLUMN public.feast_offerings.cover_image_url IS
  'Optional public cover photograph URL, including assets in the menu-images Storage bucket.';

COMMENT ON COLUMN public.feast_offerings.cover_image_alt IS
  'Accessible image description. Required whenever the cover image URL is nonblank.';

COMMENT ON COLUMN public.feast_offerings.is_published IS
  'Controls public visibility. No menu-item dependency or eligible-item publishing invariant.';

COMMIT;
