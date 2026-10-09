-- Sit Down Sundays — 0013_dining_tables.sql
-- REVIEWED DRAFT / UNAPPLIED. Apply manually as the database owner.
-- Physical-table storage only: no inventory seed, assignments, booking-limit
-- changes, payment changes, or edits to migrations 0001–0012.
-- Requires venue_spaces (0008), audit_cms_change() (0004), and
-- set_sundays_updated_at() (0010). Keep migration numbering sequential.
--
-- This is a one-time migration, deliberately NOT a schema-repair script.
-- If dining_tables already exists, CREATE TABLE fails and the transaction
-- rolls back. Inspect that existing table; do not drop it or blindly rerun.

BEGIN;

CREATE TABLE public.dining_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL
    REFERENCES public.venue_spaces(id) ON DELETE RESTRICT,
  label varchar(120) NOT NULL,
  seats integer NOT NULL,
  zone varchar(120) NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT check_dining_tables_seats
    CHECK (seats IN (4, 6, 8, 10, 12)),
  -- Reject empty strings and labels made entirely of whitespace, including
  -- tabs/newlines. btrim(label) alone removes ordinary spaces only.
  CONSTRAINT check_dining_tables_label_nonblank
    CHECK (label ~ '[^[:space:]]'),
  CONSTRAINT check_dining_tables_display_order
    CHECK (display_order >= 0)
);

-- Case-insensitive, ignoring leading/trailing PostgreSQL POSIX whitespace.
-- Interior whitespace is preserved. Disabled tables retain their labels.
CREATE UNIQUE INDEX uniq_dining_tables_label_per_space
  ON public.dining_tables (
    space_id,
    lower(regexp_replace(label, '^[[:space:]]+|[[:space:]]+$', '', 'g'))
  );

-- The unique index above already supports lookups by space_id.
CREATE INDEX idx_dining_tables_active
  ON public.dining_tables (space_id, is_active);

CREATE INDEX idx_dining_tables_display_order
  ON public.dining_tables (space_id, display_order);

-- Existing timestamp helper: sets NEW.updated_at on every UPDATE.
CREATE TRIGGER trg_dining_tables_updated_at
  BEFORE UPDATE ON public.dining_tables
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sundays_updated_at();

-- Existing audit helper: reads created_by/updated_by and id, then records
-- old/new row JSON in audit_logs in the same transaction as the mutation.
-- Server-side actions must populate actors from the verified staff session.
CREATE TRIGGER trg_dining_tables_audit
  AFTER INSERT OR UPDATE ON public.dining_tables
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_cms_change();

-- Internal-only table. No browser-role policies are created.
-- The service role bypasses RLS, so application functions must independently
-- authorize seating.read for reads and seating.manage for mutations.
ALTER TABLE public.dining_tables ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.dining_tables FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.dining_tables FROM service_role;
REVOKE DELETE ON TABLE public.dining_tables FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.dining_tables TO service_role;

-- Soft-disable is the application workflow, not a prohibition on privileged
-- database-owner maintenance. No DELETE or TRUNCATE grant is given to the
-- application's service role. Database owners retain administrative powers.
-- ON DELETE RESTRICT protects the room for BOTH active and inactive tables;
-- setting is_active = false does not permit deletion of the referenced room.

COMMENT ON TABLE public.dining_tables IS
  'Staff-configured physical tables. No automatic booking capacity or remaining-inventory calculation. A later assignment model may join several tables for one party. Soft-disable via is_active.';

COMMENT ON COLUMN public.dining_tables.space_id IS
  'Physical room. Room deletion is restricted while any table references it, including inactive tables.';

COMMENT ON COLUMN public.dining_tables.label IS
  'Nonblank staff label, maximum 120 characters. Unique per room ignoring case and leading/trailing POSIX whitespace; inactive tables retain their labels.';

COMMENT ON COLUMN public.dining_tables.seats IS
  'Physical seat count: 4, 6, 8, 10, or 12. Not a public booking limit and not remaining inventory.';

COMMENT ON COLUMN public.dining_tables.is_active IS
  'Soft-disable flag. Future assignment operations must reject inactive tables for new assignments.';

COMMIT;