-- ============================================================================
-- Sit Down Sundays — 0010_sundays_seating_payment.sql
-- ============================================================================
-- Sundays & Seating + Payment Policy — the operating configuration that the
-- /admin/sundays and /admin/settings screens depend on.
--
-- This migration is ADDITIVE. It creates three new tables that the Sundays and
-- Settings Supabase repositories already read/write but that no prior migration
-- defines:
--   * sunday_services  — a Sunday service hosted in a venue space.
--   * seating_times    — a seating window within a Sunday service.
--   * payment_policy   — singleton deposit/balance-deadline/timezone config.
--
-- It does NOT modify or reapply 0001–0009. It does NOT implement reservations,
-- capacity enforcement, table layouts, booking, or checkout. Capacity is
-- ultimately enforced per service x seating in a future phase; this migration
-- only stores the staff-configured ceilings.
--
-- KEY DESIGN RULES (per owner direction):
--   * Sunday services are Sundays only (enforced by a CHECK constraint on the
--     date column). The service window is noon–7 PM, dining duration exactly
--     150 minutes (2.5 hours), latest permitted reservation start 4:30 PM.
--     These are enforced by database CHECK constraints AND mirrored in the
--     application validation layer (src/lib/sundays/constants.ts).
--   * online_booking_limit is a staff-controlled sales ceiling, separate from
--     the venue space's reported_capacity. NULL means NOT FOR SALE. Setting a
--     limit does NOT open bookings — capacity enforcement is a future phase.
--   * Overlapping seating starts are NOT independent room capacity pools. This
--     migration stores the data; it does NOT enforce non-overlap or capacity.
--     That enforcement is explicitly deferred (see "CAPACITY — NOT ENFORCED").
--   * payment_policy is a single-row configuration table. The confirmed
--     defaults are a 50% deposit and a 72-hour balance deadline. Per-reservation
--     overrides (including pay-at-check-in) are a future phase and will be
--     audited. Changing the global default does NOT retroactively change
--     existing reservations (future reservations snapshot the agreed terms).
--
-- SECURITY MODEL:
--   * These are INTERNAL configuration tables, not public content. anon and
--     authenticated get NO read access (like venue_spaces). Only the
--     service-role client, used inside authorized server functions after the
--     caller's role is verified to hold availability.manage (ops_manager /
--     administrator) for services/seating and settings.manage (administrator)
--     for payment policy, may read and mutate.
--   * RLS enabled with no anon/authenticated policies; service_role bypasses.
--   * Audit logging reuses public.audit_cms_change() (0004) → append-only
--     public.audit_logs (0001) in the SAME transaction as each mutation. The
--     audit trigger reads created_by on INSERT and updated_by on UPDATE, so
--     every audited table has both columns.
--
-- STATUS: DRAFT, NOT YET APPLIED.
-- Supabase should run this versioned migration exactly once, after
-- 0009_ordering_model.sql. It does not modify or reapply 0001–0009.
-- Wrapped in BEGIN/COMMIT so it applies atomically.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- sunday_services
-- ----------------------------------------------------------------------------
-- One row per Sunday service (a date hosted in a venue space).
CREATE TABLE IF NOT EXISTS public.sunday_services (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date                   date NOT NULL,
  label                  varchar(120) NOT NULL DEFAULT '',
  status                 varchar(40) NOT NULL DEFAULT 'scheduled',
  space_id               uuid NOT NULL REFERENCES public.venue_spaces(id) ON DELETE RESTRICT,
  online_booking_limit   integer,
  is_active              boolean NOT NULL DEFAULT true,
  display_order          integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- seating_times
-- ----------------------------------------------------------------------------
-- A seating window within a Sunday service. start_time/end_time are HH:MM
-- (24h) within the service window (noon–7 PM). The dining duration is exactly
-- 150 minutes (2.5h); the latest permitted reservation start is 4:30 PM.
CREATE TABLE IF NOT EXISTS public.seating_times (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sunday_service_id      uuid NOT NULL REFERENCES public.sunday_services(id) ON DELETE CASCADE,
  label                  varchar(120) NOT NULL DEFAULT '',
  start_time             varchar(5) NOT NULL,
  end_time               varchar(5) NOT NULL,
  online_booking_limit   integer,
  is_active              boolean NOT NULL DEFAULT true,
  display_order          integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- payment_policy  (single-row configuration table)
-- ----------------------------------------------------------------------------
-- Singleton: only one row (id = 1) is permitted. The confirmed defaults are a
-- 50% deposit and a 72-hour balance deadline. The restaurant timezone is
-- required for scheduling Sunday services and seating times. created_by is
-- present so the audit trigger can read new.created_by on INSERT (the initial
-- seed insert is audited).
CREATE TABLE IF NOT EXISTS public.payment_policy (
  id                                  smallint PRIMARY KEY DEFAULT 1,
  deposit_percent                     integer NOT NULL DEFAULT 50,
  default_balance_deadline_hours      integer NOT NULL DEFAULT 72,
  restaurant_timezone                 varchar(120),
  created_at                          timestamptz NOT NULL DEFAULT now(),
  updated_at                          timestamptz NOT NULL DEFAULT now(),
  created_by                          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by                          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT payment_policy_single_row CHECK (id = 1)
);

-- ----------------------------------------------------------------------------
-- Constraints — sunday_services
-- ----------------------------------------------------------------------------

-- Sunday-only service dates.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_sunday_services_sunday_only'
      AND conrelid = 'public.sunday_services'::regclass
  ) THEN
    ALTER TABLE public.sunday_services
      ADD CONSTRAINT check_sunday_services_sunday_only
      CHECK (EXTRACT(dow FROM date) = 0);
  END IF;
END $$;

-- Status must be one of the supported values.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_sunday_services_status'
      AND conrelid = 'public.sunday_services'::regclass
  ) THEN
    ALTER TABLE public.sunday_services
      ADD CONSTRAINT check_sunday_services_status
      CHECK (status IN ('scheduled', 'open', 'sold_out', 'closed'));
  END IF;
END $$;

-- online_booking_limit is null (not for sale) or a non-negative ceiling.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_sunday_services_online_booking_limit'
      AND conrelid = 'public.sunday_services'::regclass
  ) THEN
    ALTER TABLE public.sunday_services
      ADD CONSTRAINT check_sunday_services_online_booking_limit
      CHECK (online_booking_limit IS NULL OR online_booking_limit >= 0);
  END IF;
END $$;

-- display_order is non-negative.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_sunday_services_display_order'
      AND conrelid = 'public.sunday_services'::regclass
  ) THEN
    ALTER TABLE public.sunday_services
      ADD CONSTRAINT check_sunday_services_display_order
      CHECK (display_order >= 0);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Constraints — seating_times
-- ----------------------------------------------------------------------------

-- start_time and end_time must be HH:MM (24h).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_seating_times_start_time_format'
      AND conrelid = 'public.seating_times'::regclass
  ) THEN
    ALTER TABLE public.seating_times
      ADD CONSTRAINT check_seating_times_start_time_format
      CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_seating_times_end_time_format'
      AND conrelid = 'public.seating_times'::regclass
  ) THEN
    ALTER TABLE public.seating_times
      ADD CONSTRAINT check_seating_times_end_time_format
      CHECK (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
END $$;

-- End time must be later than start time (lexicographic works for HH:MM).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_seating_times_end_after_start'
      AND conrelid = 'public.seating_times'::regclass
  ) THEN
    ALTER TABLE public.seating_times
      ADD CONSTRAINT check_seating_times_end_after_start
      CHECK (end_time > start_time);
  END IF;
END $$;

-- Service window: start >= 12:00 (noon).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_seating_times_start_at_or_after_noon'
      AND conrelid = 'public.seating_times'::regclass
  ) THEN
    ALTER TABLE public.seating_times
      ADD CONSTRAINT check_seating_times_start_at_or_after_noon
      CHECK (start_time >= '12:00');
  END IF;
END $$;

-- Latest permitted reservation start: 16:30 (4:30 PM).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_seating_times_latest_start'
      AND conrelid = 'public.seating_times'::regclass
  ) THEN
    ALTER TABLE public.seating_times
      ADD CONSTRAINT check_seating_times_latest_start
      CHECK (start_time <= '16:30');
  END IF;
END $$;

-- Service ends at 19:00 (7 PM).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_seating_times_end_within_window'
      AND conrelid = 'public.seating_times'::regclass
  ) THEN
    ALTER TABLE public.seating_times
      ADD CONSTRAINT check_seating_times_end_within_window
      CHECK (end_time <= '19:00');
  END IF;
END $$;

-- Dining duration is exactly 150 minutes (2.5 hours). Computed from HH:MM.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_seating_times_duration_150_minutes'
      AND conrelid = 'public.seating_times'::regclass
  ) THEN
    ALTER TABLE public.seating_times
      ADD CONSTRAINT check_seating_times_duration_150_minutes
      CHECK (
        (extract(hour FROM (end_time || ':00')::time) * 60
         + extract(minute FROM (end_time || ':00')::time))
        -
        (extract(hour FROM (start_time || ':00')::time) * 60
         + extract(minute FROM (start_time || ':00')::time))
        = 150
      );
  END IF;
END $$;

-- online_booking_limit is null (not for sale) or a non-negative ceiling.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_seating_times_online_booking_limit'
      AND conrelid = 'public.seating_times'::regclass
  ) THEN
    ALTER TABLE public.seating_times
      ADD CONSTRAINT check_seating_times_online_booking_limit
      CHECK (online_booking_limit IS NULL OR online_booking_limit >= 0);
  END IF;
END $$;

-- display_order is non-negative.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_seating_times_display_order'
      AND conrelid = 'public.seating_times'::regclass
  ) THEN
    ALTER TABLE public.seating_times
      ADD CONSTRAINT check_seating_times_display_order
      CHECK (display_order >= 0);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Constraints — payment_policy
-- ----------------------------------------------------------------------------

-- deposit_percent between 0 and 100.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_payment_policy_deposit_percent'
      AND conrelid = 'public.payment_policy'::regclass
  ) THEN
    ALTER TABLE public.payment_policy
      ADD CONSTRAINT check_payment_policy_deposit_percent
      CHECK (deposit_percent >= 0 AND deposit_percent <= 100);
  END IF;
END $$;

-- default_balance_deadline_hours is a non-negative whole number.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_payment_policy_deadline_hours'
      AND conrelid = 'public.payment_policy'::regclass
  ) THEN
    ALTER TABLE public.payment_policy
      ADD CONSTRAINT check_payment_policy_deadline_hours
      CHECK (default_balance_deadline_hours >= 0 AND default_balance_deadline_hours <= 720);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sunday_services_display_order
  ON public.sunday_services (display_order);

CREATE INDEX IF NOT EXISTS idx_sunday_services_date
  ON public.sunday_services (date);

CREATE INDEX IF NOT EXISTS idx_sunday_services_space
  ON public.sunday_services (space_id);

CREATE INDEX IF NOT EXISTS idx_seating_times_service
  ON public.seating_times (sunday_service_id);

CREATE INDEX IF NOT EXISTS idx_seating_times_display_order
  ON public.seating_times (display_order);

-- ----------------------------------------------------------------------------
-- updated_at trigger
-- ----------------------------------------------------------------------------
-- SECURITY INVOKER: runs with the invoking statement's role's privileges,
-- NOT automatically the table owner's privileges.
CREATE OR REPLACE FUNCTION public.set_sundays_updated_at()
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

DROP TRIGGER IF EXISTS trg_sunday_services_updated_at ON public.sunday_services;
CREATE TRIGGER trg_sunday_services_updated_at
  BEFORE UPDATE ON public.sunday_services
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sundays_updated_at();

DROP TRIGGER IF EXISTS trg_seating_times_updated_at ON public.seating_times;
CREATE TRIGGER trg_seating_times_updated_at
  BEFORE UPDATE ON public.seating_times
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sundays_updated_at();

DROP TRIGGER IF EXISTS trg_payment_policy_updated_at ON public.payment_policy;
CREATE TRIGGER trg_payment_policy_updated_at
  BEFORE UPDATE ON public.payment_policy
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sundays_updated_at();

-- ----------------------------------------------------------------------------
-- Audit logging triggers
-- ----------------------------------------------------------------------------
-- Reuses the existing public.audit_cms_change() function (0004), which writes
-- a safe audit_logs row in the SAME transaction as each INSERT/UPDATE. The
-- actor is taken from created_by (INSERT) or updated_by (UPDATE). Only safe
-- old/new row JSON is recorded; these columns contain no secrets. If the
-- audit insert fails, the entire transaction (including the mutation) rolls
-- back. CREATE OR REPLACE FUNCTION preserves existing ownership/privileges;
-- the explicit REVOKE/GRANT statements are reapplied defensively.
--
-- NOTE: audit_cms_change() uses new.id::text as entity_id, so these tables
-- must have a UUID id primary key (they do). payment_policy uses a smallint
-- id; its audit trigger casts id::text implicitly via the function's
-- new.id::text expression, which works for smallint too.
DROP TRIGGER IF EXISTS trg_sunday_services_audit ON public.sunday_services;
CREATE TRIGGER trg_sunday_services_audit
  AFTER INSERT OR UPDATE ON public.sunday_services
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_cms_change();

DROP TRIGGER IF EXISTS trg_seating_times_audit ON public.seating_times;
CREATE TRIGGER trg_seating_times_audit
  AFTER INSERT OR UPDATE ON public.seating_times
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_cms_change();

DROP TRIGGER IF EXISTS trg_payment_policy_audit ON public.payment_policy;
CREATE TRIGGER trg_payment_policy_audit
  AFTER INSERT OR UPDATE ON public.payment_policy
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_cms_change();

-- ----------------------------------------------------------------------------
-- Row-level security (internal config — no public access)
-- ----------------------------------------------------------------------------
-- These are INTERNAL configuration tables, not public content. anon and
-- authenticated get NO read access. Only the service-role client (used inside
-- authorized server functions after verifying availability.manage /
-- settings.manage) may read and mutate; service_role bypasses RLS.
ALTER TABLE public.sunday_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seating_times ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_policy ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE/DELETE policies for anon or authenticated.
-- Server-side authorization must precede service-role writes.

-- ----------------------------------------------------------------------------
-- Explicit table privileges
-- ----------------------------------------------------------------------------
REVOKE ALL ON TABLE public.sunday_services FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.seating_times FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.payment_policy FROM PUBLIC, anon, authenticated;

-- Remove any default grants before assigning server permissions.
REVOKE ALL ON TABLE public.sunday_services FROM service_role;
REVOKE ALL ON TABLE public.seating_times FROM service_role;
REVOKE ALL ON TABLE public.payment_policy FROM service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.sunday_services TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.seating_times TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.payment_policy TO service_role;

-- ----------------------------------------------------------------------------
-- Trigger helper privileges
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.set_sundays_updated_at()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_sundays_updated_at()
  TO service_role;

-- ----------------------------------------------------------------------------
-- Seed the payment_policy singleton with confirmed defaults
-- ----------------------------------------------------------------------------
-- 50% deposit, 72-hour balance deadline. restaurant_timezone is left NULL;
-- staff configure it in /admin/settings before scheduling services. This
-- seed is idempotent via ON CONFLICT (id) DO NOTHING. created_by is NULL for
-- the seed (no verified server session exists at migration time); the audit
-- trigger tolerates a NULL actor.
INSERT INTO public.payment_policy
  (id, deposit_percent, default_balance_deadline_hours, restaurant_timezone, created_by, updated_by)
VALUES
  (1, 50, 72, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- CAPACITY — NOT ENFORCED (explicitly deferred)
-- ----------------------------------------------------------------------------
-- This migration stores online_booking_limit on sunday_services and
-- seating_times, but does NOT enforce capacity against reservations:
--   * There is no reservation table yet (future phase).
--   * There is no constraint preventing overlapping seating starts from
--     exceeding a space's capacity. Overlapping starts are NOT independent
--     room capacity pools — but that rule is enforced in the application
--     booking layer, not here, because capacity is ultimately enforced per
--     service x seating, not per room.
--   * Setting online_booking_limit does NOT open bookings. Bookings remain
--     disabled until the reservation/capacity phase is implemented.
-- No public availability promise is made by this migration.

-- ----------------------------------------------------------------------------
-- Documentation
-- ----------------------------------------------------------------------------
COMMENT ON TABLE public.sunday_services IS
  'Sunday services hosted in a venue space. Sundays only (dow = 0), noon–7 PM service window. Capacity enforcement is a future phase; online_booking_limit is a staff ceiling, not a booking guarantee.';

COMMENT ON COLUMN public.sunday_services.online_booking_limit IS
  'Staff-controlled sales ceiling for this service. NULL means not for sale. Setting a value does NOT open bookings until capacity enforcement is implemented.';

COMMENT ON TABLE public.seating_times IS
  'Seating windows within a Sunday service. start_time/end_time in HH:MM (24h) within noon–7 PM; latest start 4:30 PM; dining duration exactly 150 minutes (2.5h). Overlapping starts are NOT independent capacity pools.';

COMMENT ON COLUMN public.seating_times.online_booking_limit IS
  'Staff-controlled sales ceiling for this seating. NULL means not for sale. Setting a value does NOT open bookings until capacity enforcement is implemented.';

COMMENT ON TABLE public.payment_policy IS
  'Singleton payment policy: deposit percentage, default balance deadline hours, restaurant timezone. Confirmed defaults are 50% deposit and 72-hour balance deadline. Per-reservation overrides are a future phase.';

COMMENT ON COLUMN public.payment_policy.default_balance_deadline_hours IS
  'Default balance deadline in hours before the seating (confirmed 72). Applies to future reservations only; existing reservations keep the terms agreed at booking.';

COMMIT;
