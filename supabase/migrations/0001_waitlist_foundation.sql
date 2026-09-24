-- ============================================================================
-- Sit Down Sundays — 0001_waitlist_foundation.sql
-- ============================================================================
-- Initial SQL migration for the public waitlist foundation.
--
-- STATUS: GENERATED, NOT YET APPLIED.
-- This file has NOT been executed against any Supabase project. Live
-- persistence does not work until this migration has been externally
-- reviewed, applied, and tested.
--
-- DESIGN NOTES
--   * Public submission goes through a validated TanStack Start server
--     function using the service-role client. Anonymous browser clients have
--     NO direct table access (RLS denies all anon/public roles).
--   * Protected fields (status, internal_notes, consent timestamps, consent
--     text + versions, policy versions, audit fields, ids) are generated
--     server-side and are never accepted from the browser.
--   * No generic query endpoint exists.
--   * Audit history cannot be rewritten by ordinary application users —
--     audit_logs is append-only at the database level (UPDATE/DELETE denied).
--
-- IDENTITY MODEL
--   * normalized_email is the PRIMARY identity key and is UNIQUE.
--   * normalized_phone is a normal lookup index, NOT unique. Different people
--     may share a household phone number.
--   * Two entries are never merged solely because their phone numbers match.
--     The server function only merges on a matching normalized_email.
--
-- AUTHENTICATED STAFF POLICIES (future phase)
--   After authentication exists, add RLS policies granting SELECT/UPDATE on
--   waitlist_entries and waitlist_status_history to authenticated staff roles
--   (e.g. foh_staff, ops_manager, administrator) only. Audit_logs remains
--   append-only for all roles (including administrator) — history is never
--   rewritten. These policies must be added in a later migration once role
--   claims are available.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Reusable updated-at trigger function
-- ----------------------------------------------------------------------------
-- A safe search_path is declared on every SECURITY DEFINER / trigger function
-- to protect against search_path injection (CVE-2018-1058 style).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- waitlist_entries
-- ============================================================================
-- Length limits are aligned with application validation (see
-- src/lib/waitlist/schema.ts). varchar is used so the database enforces the
-- same boundaries the server function enforces.
create table if not exists public.waitlist_entries (
  id                          uuid primary key default gen_random_uuid(),

  first_name                  varchar(80)  not null,
  last_name                   varchar(80)  not null,
  email                       varchar(254) not null,
  normalized_email            varchar(254) not null,
  phone                       varchar(32)  not null,
  normalized_phone            varchar(32)  not null,

  party_size                  integer     not null check (party_size between 1 and 20),

  preferred_date              date,
  preferred_seating_time      varchar(60),

  private_room_interest       boolean     not null default false,

  email_marketing_consent     boolean     not null default false,
  email_consent_text          varchar(2000),
  email_consent_text_version  varchar(60),
  email_consent_timestamp     timestamptz,

  sms_consent                 boolean     not null default false,
  sms_consent_text            varchar(2000),
  sms_consent_text_version    varchar(60),
  sms_consent_timestamp       timestamptz,

  privacy_policy_version      varchar(60) not null,
  terms_version               varchar(60) not null,

  source                      varchar(60) not null default 'public_waitlist',
  referral_url                varchar(500),
  utm_source                  varchar(120),
  utm_medium                  varchar(120),
  utm_campaign                varchar(120),
  utm_content                 varchar(120),
  utm_term                    varchar(120),

  status                      varchar(40) not null default 'new'
                                          check (status in (
                                            'new','contacted','invited','booked',
                                            'not_interested','invalid','archived'
                                          )),

  internal_notes              text,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  -- Consent timestamps + evidence must be logically consistent with the
  -- consent booleans. When consent is true, the exact displayed text, version,
  -- and server-generated timestamp must all be present. When false, all three
  -- evidence fields must be null.
  constraint email_consent_consistency
    check (
      (email_marketing_consent = true
        and email_consent_timestamp is not null
        and email_consent_text is not null
        and email_consent_text_version is not null)
      or
      (email_marketing_consent = false
        and email_consent_timestamp is null
        and email_consent_text is null
        and email_consent_text_version is null)
    ),
  constraint sms_consent_consistency
    check (
      (sms_consent = true
        and sms_consent_timestamp is not null
        and sms_consent_text is not null
        and sms_consent_text_version is not null)
      or
      (sms_consent = false
        and sms_consent_timestamp is null
        and sms_consent_text is null
        and sms_consent_text_version is null)
    )
);

-- ----------------------------------------------------------------------------
-- Identity & lookup indexes
-- ----------------------------------------------------------------------------
-- normalized_email is the PRIMARY identity key: UNIQUE. The server function
-- merges only on a matching normalized_email.
create unique index if not exists waitlist_entries_normalized_email_uniq
  on public.waitlist_entries (normalized_email);

-- normalized_phone is a normal (non-unique) lookup index. Different people
-- may share a household phone number, so phone is never an identity key and
-- never triggers an automatic merge.
create index if not exists idx_waitlist_entries_normalized_phone
  on public.waitlist_entries (normalized_phone)
  where normalized_phone is not null;

-- Updated-at trigger
drop trigger if exists trg_waitlist_entries_updated_at on public.waitlist_entries;
create trigger trg_waitlist_entries_updated_at
  before update on public.waitlist_entries
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Other indexes
-- ----------------------------------------------------------------------------
create index if not exists idx_waitlist_entries_status
  on public.waitlist_entries (status);
create index if not exists idx_waitlist_entries_created_at
  on public.waitlist_entries (created_at desc);
create index if not exists idx_waitlist_entries_preferred_date
  on public.waitlist_entries (preferred_date);
create index if not exists idx_waitlist_entries_private_room_interest
  on public.waitlist_entries (private_room_interest)
  where private_room_interest = true;
create index if not exists idx_waitlist_entries_utm_source
  on public.waitlist_entries (utm_source)
  where utm_source is not null;
create index if not exists idx_waitlist_entries_utm_campaign
  on public.waitlist_entries (utm_campaign)
  where utm_campaign is not null;

-- ============================================================================
-- waitlist_status_history
-- ============================================================================
create table if not exists public.waitlist_status_history (
  id                uuid primary key default gen_random_uuid(),
  waitlist_entry_id uuid        not null references public.waitlist_entries(id)
                                          on delete restrict,
  previous_status   varchar(40) check (previous_status is null or previous_status in (
                                    'new','contacted','invited','booked',
                                    'not_interested','invalid','archived'
                                  )),
  new_status        varchar(40) not null check (new_status in (
                                    'new','contacted','invited','booked',
                                    'not_interested','invalid','archived'
                                  )),
  changed_by        uuid        references auth.users(id) on delete set null,
  reason            text,
  created_at        timestamptz not null default now()
);

-- ON DELETE RESTRICT on waitlist_entry_id preserves operational history:
-- deleting a waitlist entry requires explicitly addressing its status history
-- first. changed_by uses ON DELETE SET NULL so deleting an auth user keeps
-- the history row (with an unknown actor) rather than destroying it.

create index if not exists idx_waitlist_status_history_entry
  on public.waitlist_status_history (waitlist_entry_id);
create index if not exists idx_waitlist_status_history_created_at
  on public.waitlist_status_history (created_at desc);

-- ============================================================================
-- audit_logs
-- ============================================================================
create table if not exists public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  actor_user_id   uuid        references auth.users(id) on delete set null,
  action          varchar(120) not null,
  entity_type     varchar(120) not null,
  entity_id       varchar(120),
  previous_values jsonb,
  new_values      jsonb,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);

-- actor_user_id uses ON DELETE SET NULL so deleting an auth user preserves
-- the audit row (with an unknown actor) rather than destroying it.

create index if not exists idx_audit_logs_entity
  on public.audit_logs (entity_type, entity_id);
create index if not exists idx_audit_logs_created_at
  on public.audit_logs (created_at desc);
create index if not exists idx_audit_logs_actor
  on public.audit_logs (actor_user_id)
  where actor_user_id is not null;

-- ----------------------------------------------------------------------------
-- audit_logs is append-only at the database level.
-- ----------------------------------------------------------------------------
-- A trigger denies UPDATE and DELETE on audit_logs for every role, including
-- the service-role client and table owner. Only INSERTs remain possible
-- through authorized server operations. This guarantees audit history can
-- never be rewritten or erased at the database level.
create or replace function public.prevent_audit_modification()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'audit_logs is append-only: UPDATE and DELETE are not permitted.';
end;
$$;

drop trigger if exists trg_audit_logs_no_update on public.audit_logs;
create trigger trg_audit_logs_no_update
  before update on public.audit_logs
  for each row execute function public.prevent_audit_modification();

drop trigger if exists trg_audit_logs_no_delete on public.audit_logs;
create trigger trg_audit_logs_no_delete
  before delete on public.audit_logs
  for each row execute function public.prevent_audit_modification();

-- ============================================================================
-- Row-Level Security
-- ============================================================================
-- All new tables have RLS enabled. Because public submission goes through a
-- validated server function using the service-role client (which bypasses
-- RLS), anonymous/public roles receive NO policies and therefore NO access.
--
--   * No direct browser database access.
--   * No anonymous SELECT on waitlist data.
--   * No anonymous UPDATE or DELETE.
--   * No public access to status history.
--   * No public access to audit logs (and it is append-only regardless).
--   * Controlled insertion through the application's server function only.
-- ============================================================================

alter table public.waitlist_entries          enable row level security;
alter table public.waitlist_status_history   enable row level security;
alter table public.audit_logs                enable row level security;

-- Intentionally NO policies for anon/public/authenticated roles here.
-- The service-role client bypasses RLS and is used only inside authorized
-- server functions. Staff read/mutation policies are added in a later
-- migration once authentication and role claims exist.

-- ============================================================================
-- End of migration
-- ============================================================================
