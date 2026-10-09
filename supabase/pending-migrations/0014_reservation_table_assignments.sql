-- Sit Down Sundays — 0014_reservation_table_assignments.sql
-- CORRECTED DRAFT / UNAPPLIED. Not executed against PostgreSQL.
-- One-time additive migration: apply as database owner after 0013.
-- If reservation_table_assignments already exists, stop and inspect it.
-- No seeds, assignment RPC, application code, or changes to existing tables.

BEGIN;

-- btree_gist supplies UUID equality support for GiST. PostgreSQL supplies
-- the built-in range overlap support. Do not relocate an existing extension.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Discover the actual extension schema (e.g. public or extensions) so its
-- UUID operator class can be resolved regardless of installation location.
-- This search_path is transaction-local and does not change app configuration.
DO $extension_path$
DECLARE
  v_extension_schema text;
BEGIN
  SELECT n.nspname INTO STRICT v_extension_schema
  FROM pg_catalog.pg_extension AS e
  JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace
  WHERE e.extname = 'btree_gist';

  PERFORM pg_catalog.set_config(
    'search_path',
    pg_catalog.format('pg_catalog, public, %I', v_extension_schema),
    true
  );
END;
$extension_path$;

CREATE TABLE public.reservation_table_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL
    REFERENCES public.reservations(id) ON DELETE RESTRICT,
  dining_table_id uuid NOT NULL
    REFERENCES public.dining_tables(id) ON DELETE RESTRICT,
  seating_start timestamptz NOT NULL,
  seating_end timestamptz NOT NULL,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT chk_rta_interval_valid CHECK (
    isfinite(seating_start)
    AND isfinite(seating_end)
    AND seating_end > seating_start
  )
);

-- One current assignment per reservation/table pair, including cases where
-- someone attempts two disjoint intervals for that same pair. History is
-- excluded. Only one unique index is needed for this rule.
CREATE UNIQUE INDEX uniq_rta_current_per_reservation_per_table
  ON public.reservation_table_assignments (reservation_id, dining_table_id)
  WHERE released_at IS NULL;

-- Actual EXCLUSION CONSTRAINT, not a UNIQUE GiST index.
-- Reject rows where BOTH the physical table matches AND time ranges overlap.
-- [start,end) permits back-to-back use. Released records do not participate.
-- PostgreSQL enforces this constraint for concurrent writers as well.
ALTER TABLE public.reservation_table_assignments
  ADD CONSTRAINT excl_rta_no_overlap_current
  EXCLUDE USING gist (
    dining_table_id WITH =,
    tstzrange(seating_start, seating_end, '[)') WITH &&
  )
  WHERE (released_at IS NULL);

-- Include historical rows in lookup indexes and support restrictive FKs.
CREATE INDEX idx_rta_reservation
  ON public.reservation_table_assignments (reservation_id);

CREATE INDEX idx_rta_dining_table
  ON public.reservation_table_assignments (dining_table_id);

CREATE TRIGGER trg_rta_updated_at
  BEFORE UPDATE ON public.reservation_table_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_sundays_updated_at();

CREATE TRIGGER trg_rta_audit
  AFTER INSERT OR UPDATE ON public.reservation_table_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_cms_change();

ALTER TABLE public.reservation_table_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.reservation_table_assignments
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.reservation_table_assignments FROM service_role;
GRANT SELECT ON TABLE public.reservation_table_assignments TO service_role;

-- No direct application INSERT/UPDATE/DELETE/TRUNCATE grants or RLS policies.
-- Database owners retain administrative powers. Future mutation functions
-- must have an appropriate SECURITY DEFINER owner, restricted execution,
-- a fixed safe search_path, and trusted server-side seating authorization.
--
-- FUTURE RPC REQUIREMENTS (not implemented by this migration): derive absolute
-- intervals from authoritative reservation/service/seating/timezone data;
-- validate same-room active tables and combined capacity; serialize changes
-- for the same reservation; release old rows before inserting replacements;
-- roll back the entire replacement if any insert conflicts. Rescheduling,
-- cancellation, room/timezone changes, and table edits need coordinated
-- assignment handling so stored intervals/capacities do not become stale.

COMMENT ON TABLE public.reservation_table_assignments IS
  'Party-to-physical-table assignment history. One reservation can use multiple tables without duplicating guests, orders, or payments. released_at NULL marks current assignments. Storage foundation only; assignment workflow is separate.';

COMMENT ON COLUMN public.reservation_table_assignments.seating_start IS
  'Finite absolute start, to be derived by the future trusted assignment RPC from authoritative reservation/service/seating and restaurant timezone data.';

COMMENT ON COLUMN public.reservation_table_assignments.seating_end IS
  'Finite absolute end strictly after start. The overlap constraint uses the half-open interval [start,end), allowing back-to-back assignments.';

COMMENT ON COLUMN public.reservation_table_assignments.released_at IS
  'NULL means current. A release timestamp retains the historical row while removing it from current uniqueness and overlap enforcement.';

COMMIT;
