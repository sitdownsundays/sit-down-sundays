-- ============================================================================
-- Sit Down Sundays — 0008_venue_spaces.sql
-- ============================================================================
-- Venue Spaces — the physical rooms that can host Sunday services.
--
-- This is the AVAILABILITY FOUNDATION only. It establishes the three confirmed
-- physical spaces and their saleability posture. It does NOT implement Sunday
-- services, seating times, table layouts, reservations, capacity calculations,
-- or booking. Those come in later phases and will reference venue_spaces.
--
-- KEY DESIGN RULES (per owner direction):
--   * reported_capacity is a PHYSICAL FACT (as reported), for display/audit
--     only. It is NEVER the number of seats offered for sale.
--   * online_booking_limit is the staff-controlled sales ceiling, defaulting
--     to NULL (nothing for sale). Setting a limit does NOT open bookings —
--     Sunday services and seating times must still be configured in a later
--     phase before any seat is bookable.
--   * Mayoral Rooms are request_only: no online self-booking, no shared
--     seating, no exclusivity promise, no capacity pooling. Staff approval
--     required (future phase).
--   * Suites are "coming soon" with an unknown count; NO suite row is seeded
--     and there is no suite-count column.
--   * Capacity is ultimately enforced per service x seating, not per room.
--     This migration only establishes the spaces; the per-service/seating
--     ceiling is a future migration linking a space to a service+seating.
--
-- SECURITY MODEL:
--   * venue_spaces is INTERNAL configuration, not public display content.
--     anon and authenticated get NO read access (unlike feast_offerings, which
--     is public showcase content). Only the service-role client, used inside
--     authorized server functions after the caller's role is verified to hold
--     availability.manage (ops_manager / administrator), may read and mutate.
--   * RLS is enabled with no anon/authenticated policies; service_role
--     bypasses RLS.
--   * Audit logging reuses the existing public.audit_cms_change() trigger
--     function (0004_menu_cms_atomic_operations.sql), which writes to the
--     append-only public.audit_logs table (0001_waitlist_foundation.sql) in
--     the SAME transaction as each mutation.
--
-- STATUS: DRAFT, NOT YET APPLIED.
-- Supabase should run this versioned migration exactly once, after
-- 0007_feast_offerings.sql. It does not modify or reapply 0001–0007.
--
-- The entire migration is wrapped in BEGIN/COMMIT so it applies atomically.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- venue_spaces
-- ----------------------------------------------------------------------------
-- One row per physical room (Grand Ballroom, Mayoral Room 1, Mayoral Room 2).
-- Display/config content only; no booking rules.
CREATE TABLE IF NOT EXISTS public.venue_spaces (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   varchar(120) NOT NULL,
  -- Canonical slug: lowercase letters/digits, single hyphens between segments,
  -- no leading/trailing hyphen, no whitespace. Matches the application's
  -- normalizeSlug()/isValidSlug() format.
  slug                   varchar(120) NOT NULL,
  description            text NOT NULL DEFAULT '',
  -- How this space participates in online booking.
  --   general_dining : open general dining (Ballroom). Bookings remain
  --                    DISABLED until staff configures online_booking_limit
  --                    AND Sunday services + seating times exist.
  --   request_only  : staff-approval-only for large gatherings (Mayoral
  --                    Rooms). No online self-booking, no shared seating,
  --                    no exclusivity promise, no capacity pooling.
  --   not_bookable  : not exposed for booking (e.g. suites, coming soon).
  space_type             varchar(40) NOT NULL DEFAULT 'general_dining',
  -- Physical reported capacity — a fact, for display/audit only. NEVER the
  -- number of seats sold.
  reported_capacity      integer NOT NULL DEFAULT 0,
  -- Staff-controlled sales ceiling. NULL means NOT FOR SALE. Setting a value
  -- does not open bookings until services + seating times are configured.
  online_booking_limit   integer,
  is_active              boolean NOT NULL DEFAULT true,
  display_order          integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- Constraints
-- ----------------------------------------------------------------------------

-- Unique slug (one space per slug).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'venue_spaces_slug_key'
      AND conrelid = 'public.venue_spaces'::regclass
  ) THEN
    ALTER TABLE public.venue_spaces
      ADD CONSTRAINT venue_spaces_slug_key UNIQUE (slug);
  END IF;
END $$;

-- Canonical slug format: mirrors the application's isValidSlug() regex.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_venue_spaces_slug_format'
      AND conrelid = 'public.venue_spaces'::regclass
  ) THEN
    ALTER TABLE public.venue_spaces
      ADD CONSTRAINT check_venue_spaces_slug_format
      CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
  END IF;
END $$;

-- Space type must be one of the supported values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_venue_spaces_space_type'
      AND conrelid = 'public.venue_spaces'::regclass
  ) THEN
    ALTER TABLE public.venue_spaces
      ADD CONSTRAINT check_venue_spaces_space_type
      CHECK (space_type IN ('general_dining', 'request_only', 'not_bookable'));
  END IF;
END $$;

-- Reported capacity is a non-negative physical fact.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_venue_spaces_reported_capacity'
      AND conrelid = 'public.venue_spaces'::regclass
  ) THEN
    ALTER TABLE public.venue_spaces
      ADD CONSTRAINT check_venue_spaces_reported_capacity
      CHECK (reported_capacity >= 0);
  END IF;
END $$;

-- Online booking limit is null (not for sale) or a non-negative ceiling.
-- Deliberately NOT bounded by reported_capacity: the two are independent
-- concepts and reported capacity may be uncertain/uncorroborated.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_venue_spaces_online_booking_limit'
      AND conrelid = 'public.venue_spaces'::regclass
  ) THEN
    ALTER TABLE public.venue_spaces
      ADD CONSTRAINT check_venue_spaces_online_booking_limit
      CHECK (online_booking_limit IS NULL OR online_booking_limit >= 0);
  END IF;
END $$;

-- Display order is non-negative.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_venue_spaces_display_order'
      AND conrelid = 'public.venue_spaces'::regclass
  ) THEN
    ALTER TABLE public.venue_spaces
      ADD CONSTRAINT check_venue_spaces_display_order
      CHECK (display_order >= 0);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_venue_spaces_display_order
  ON public.venue_spaces (display_order);

CREATE INDEX IF NOT EXISTS idx_venue_spaces_active
  ON public.venue_spaces (is_active)
  WHERE is_active = true;

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
-- SECURITY INVOKER: runs with the invoking statement's role's privileges,
-- NOT automatically the table owner's privileges.
CREATE OR REPLACE FUNCTION public.set_venue_spaces_updated_at()
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

DROP TRIGGER IF EXISTS trg_venue_spaces_updated_at ON public.venue_spaces;
CREATE TRIGGER trg_venue_spaces_updated_at
  BEFORE UPDATE ON public.venue_spaces
  FOR EACH ROW
  EXECUTE FUNCTION public.set_venue_spaces_updated_at();

-- ----------------------------------------------------------------------------
-- Audit logging trigger
-- ----------------------------------------------------------------------------
-- Reuses the existing public.audit_cms_change() function (0004), which writes
-- a safe audit_logs row in the SAME transaction as each INSERT/UPDATE. The
-- actor is taken from created_by (INSERT) or updated_by (UPDATE). Only safe
-- old/new row JSON is recorded; these columns contain no secrets. If the
-- audit insert fails, the entire transaction (including the mutation) rolls
-- back. CREATE OR REPLACE FUNCTION preserves existing ownership/privileges;
-- the explicit REVOKE/GRANT statements are reapplied defensively.
DROP TRIGGER IF EXISTS trg_venue_spaces_audit ON public.venue_spaces;
CREATE TRIGGER trg_venue_spaces_audit
  AFTER INSERT OR UPDATE ON public.venue_spaces
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_cms_change();

-- ----------------------------------------------------------------------------
-- Row-level security
-- ----------------------------------------------------------------------------
-- venue_spaces is INTERNAL configuration, not public content. anon and
-- authenticated get NO read access. Only the service-role client (used inside
-- authorized server functions after verifying availability.manage) may read
-- and mutate; service_role bypasses RLS.
ALTER TABLE public.venue_spaces ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE/DELETE policies for anon or authenticated.
-- Server-side authorization must precede service-role writes.

-- ----------------------------------------------------------------------------
-- Explicit table privileges
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.venue_spaces
  FROM PUBLIC, anon, authenticated;

-- Remove any default grants before assigning server permissions.
REVOKE ALL ON TABLE public.venue_spaces
  FROM service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.venue_spaces
  TO service_role;

-- ----------------------------------------------------------------------------
-- Trigger helper privileges
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.set_venue_spaces_updated_at()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_venue_spaces_updated_at()
  TO service_role;

-- ----------------------------------------------------------------------------
-- Seed the three confirmed physical spaces
-- ----------------------------------------------------------------------------
-- Idempotent via ON CONFLICT (slug) DO NOTHING. Suites are intentionally NOT
-- seeded (count unknown, coming soon). online_booking_limit defaults to NULL
-- so nothing is for sale until staff explicitly configures it.
INSERT INTO public.venue_spaces
  (id, name, slug, description, space_type, reported_capacity, online_booking_limit, is_active, display_order)
VALUES
  ('v1000000-0000-0000-0000-000000000001',
   'Grand Ballroom',
   'grand-ballroom',
   'The main general dining hall.',
   'general_dining', 950, NULL, true, 1),
  ('v1000000-0000-0000-0000-000000000002',
   'Mayoral Room 1',
   'mayoral-room-1',
   'Request-only private room for large gatherings. Staff approval required.',
   'request_only', 60, NULL, true, 2),
  ('v1000000-0000-0000-0000-000000000003',
   'Mayoral Room 2',
   'mayoral-room-2',
   'Request-only private room for large gatherings. Staff approval required.',
   'request_only', 60, NULL, true, 3)
ON CONFLICT (slug) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Documentation
-- ----------------------------------------------------------------------------
COMMENT ON TABLE public.venue_spaces IS
  'Physical venue spaces and their saleability posture. Availability foundation only; booking requires Sunday services and seating times (future phase).';

COMMENT ON COLUMN public.venue_spaces.reported_capacity IS
  'Physical reported capacity — a fact for display/audit only. Never the number of seats sold.';

COMMENT ON COLUMN public.venue_spaces.online_booking_limit IS
  'Staff-controlled sales ceiling. NULL means not for sale. Setting a value does NOT open bookings until Sunday services and seating times are configured.';

COMMENT ON COLUMN public.venue_spaces.space_type IS
  'general_dining = open dining (bookings disabled until configured); request_only = staff-approval-only (no online self-booking); not_bookable = not exposed for booking.';

COMMIT;
