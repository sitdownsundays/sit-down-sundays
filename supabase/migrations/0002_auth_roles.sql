-- ============================================================================
-- Sit Down Sundays — 0002_auth_roles.sql
-- ============================================================================
-- Authentication, profiles, roles, and permissions foundation.
--
-- STATUS: GENERATED, NOT YET APPLIED.
-- This file has NOT been executed against any Supabase project. It depends on
-- 0001_waitlist_foundation.sql having been applied first (it references the
-- shared audit_logs table conventions and auth.users).
--
-- VOCABULARY
--   * Permission keys are the EXACT keys defined in src/lib/domain/types.ts
--     and src/lib/domain/roles.ts (PERMISSION_KEYS / PERMISSIONS). There is
--     no second permission vocabulary.
--   * Role keys seeded here (guest, foh_staff, kitchen_staff,
--     content_manager, ops_manager, administrator) are the EXACT values of
--     the application RoleKey union. There is NO translation layer. The
--     database and application share one role-key vocabulary.
--   * role_permissions is seeded to match ROLE_PERMISSIONS verbatim.
--
-- SECURITY MODEL
--   * RLS is enabled on every new table.
--   * Profile column updates are controlled by database privileges, NOT a
--     trigger. The `authenticated` role is granted UPDATE only on
--     (first_name, last_name, phone). The `service_role` (which bypasses
--     RLS) retains full UPDATE on all profile columns, so authorized
--     administrative operations can still update email, status, and
--     last_sign_in_at. No profile-protection trigger exists.
--   * Users cannot assign themselves roles, change their status, or grant
--     themselves permissions. They cannot UPDATE status, email, or
--     last_sign_in_at because those columns are not granted to authenticated.
--   * Public signup creates a profile and assigns ONLY the Guest role. Any
--     role supplied through browser metadata is ignored. Public signup can
--     never create an internal user.
--   * Internal role/permission/user-role management is reserved for future
--     authorized administrators (no anon/public policies; the service-role
--     client bypasses RLS and will be gated by server authorization later).
--   * Role-assignment history: user_roles.user_id uses ON DELETE CASCADE, so
--     removing an auth user ALSO removes their active role assignments. The
--     assigned_by column uses ON DELETE SET NULL, so the assignment record
--     survives but loses the reference to the (now-deleted) assigning user.
--     revoked_at preserves revocation history for non-deleted users.
--
-- NON-DESTRUCTIVE
--   * No DROP TABLE / DROP SCHEMA / TRUNCATE.
--   * All inserts use ON CONFLICT DO NOTHING for idempotency.
--   * 0001_waitlist_foundation.sql is not modified or reapplied.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ============================================================================
-- profiles
-- ============================================================================
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            varchar(254) not null,
  first_name       varchar(80),
  last_name        varchar(80),
  phone            varchar(32),
  status           varchar(40) not null default 'invited'
                             check (status in ('invited','active','suspended','archived')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_sign_in_at  timestamptz
);

create index if not exists idx_profiles_status on public.profiles (status);
create index if not exists idx_profiles_email on public.profiles (email);

-- Reusable updated-at trigger (re-declared locally so this migration is
-- self-contained even if 0001 has not yet been applied; safe search_path).
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

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Column-level update privileges for profiles.
-- ----------------------------------------------------------------------------
-- Profile column protection is enforced by DATABASE PRIVILEGES, not a trigger.
-- A trigger would also block the service_role / authorized administrative
-- updates of email, status, and last_sign_in_at. Instead:
--   * Revoke table-level UPDATE from authenticated.
--   * Grant authenticated UPDATE only on first_name, last_name, phone.
--   * Leave the service_role with full table UPDATE (Postgres default +
--     RLS bypass) so authorized administrative operations can update
--     email, status, and last_sign_in_at.
-- Authenticated users therefore CANNOT update status, email, or
-- last_sign_in_at (no grant on those columns), while the service role can.
revoke update on public.profiles from authenticated;
grant update (first_name, last_name, phone) on public.profiles to authenticated;

-- ============================================================================
-- roles
-- ============================================================================
-- Role keys are the EXACT application RoleKey union values. No translation.
create table if not exists public.roles (
  id           uuid primary key default gen_random_uuid(),
  key          varchar(60) not null unique
               check (key in (
                 'guest','foh_staff','kitchen_staff',
                 'content_manager','ops_manager','administrator'
               )),
  name         varchar(120) not null,
  description  text not null,
  is_internal  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists trg_roles_updated_at on public.roles;
create trigger trg_roles_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

-- Seed roles (idempotent). is_internal flags the non-guest staff roles.
insert into public.roles (key, name, description, is_internal) values
  ('guest',           'Guest',              'A registered diner who manages their own reservations and profile.', false),
  ('foh_staff',       'Front-of-House Staff','Manages check-in, seating, walk-ins, and guest-facing operations.', true),
  ('kitchen_staff',   'Kitchen Staff',      'Views meal totals, prep reports, and dietary notes. No financial data.', true),
  ('content_manager', 'Content Manager',    'Manages public content, menus, images, and FAQs.', true),
  ('ops_manager',      'Operations Manager', 'Manages reservation operations, capacity, payments, and reports.', true),
  ('administrator',   'Administrator',      'Manages users, roles, permissions, business rules, and integrations.', true)
on conflict (key) do nothing;

-- ============================================================================
-- permissions
-- ============================================================================
-- Keys are the EXACT application permission keys (src/lib/domain/types.ts).
create table if not exists public.permissions (
  id           uuid primary key default gen_random_uuid(),
  key          varchar(60) not null unique,
  label        varchar(120) not null,
  category     varchar(60) not null,
  description  text not null,
  created_at   timestamptz not null default now()
);

insert into public.permissions (key, label, category, description) values
  ('account.read_own',      'Read own account',       'Account',      'View own profile and account details.'),
  ('account.update_own',    'Update own account',     'Account',      'Edit own profile and preferences.'),
  ('reservations.read_own', 'Read own reservations',  'Reservations', 'View reservations owned by the user.'),
  ('reservations.read_all', 'Read all reservations',  'Reservations', 'View any reservation in the system.'),
  ('reservations.manage',   'Manage reservations',    'Reservations', 'Create, edit, assign, and update reservations.'),
  ('seating.read',          'Read seating',           'Seating',      'View table and seating layout.'),
  ('seating.manage',        'Manage seating',         'Seating',      'Assign and combine tables.'),
  ('check_in.manage',       'Manage check-in',        'Check-in',     'Check guests in and update arrival status.'),
  ('walk_ins.manage',       'Manage walk-ins',        'Walk-ins',     'Add and seat walk-in guests.'),
  ('waitlist.read',         'Read waitlist',          'Waitlist',     'View waitlist entries.'),
  ('waitlist.manage',       'Manage waitlist',        'Waitlist',     'Invite, convert, or decline waitlist entries.'),
  ('kitchen.read',          'Read kitchen',           'Kitchen',      'View meal totals and dietary notes.'),
  ('kitchen.reports',       'Kitchen reports',        'Kitchen',      'View and produce preparation reports.'),
  ('content.read_drafts',   'Read draft content',     'Content',      'View unpublished content drafts.'),
  ('content.manage',        'Manage content',         'Content',      'Create and edit content, menus, and media.'),
  ('content.publish',       'Publish content',        'Content',      'Publish content and menus to the public site.'),
  ('menus.manage',          'Manage menus',           'Menus',        'Create and edit menus and menu items.'),
  ('availability.manage',   'Manage availability',    'Availability', 'Manage Sundays, seating times, and capacity.'),
  ('pricing.manage',        'Manage pricing',         'Pricing',      'Manage prices, discounts, fees, and taxes.'),
  ('payments.read',         'Read payments',          'Payments',     'View payment status and history.'),
  ('payments.manage',       'Manage payments',        'Payments',     'Record payments, refunds, and adjustments.'),
  ('reports.read',          'Read reports',           'Reports',      'View operating and financial reports.'),
  ('users.read',            'Read users',             'Users',        'View user accounts.'),
  ('users.manage',          'Manage users',           'Users',        'Create, edit, and deactivate users.'),
  ('roles.manage',          'Manage roles',           'Roles',        'Manage roles and permission assignments.'),
  ('settings.manage',       'Manage settings',        'Settings',     'Manage business rules and application settings.'),
  ('audit.read',            'Read audit log',         'Audit',        'Review audit history.'),
  ('integrations.manage',   'Manage integrations',    'Integrations', 'Manage third-party integrations.')
on conflict (key) do nothing;

-- ============================================================================
-- role_permissions
-- ============================================================================
-- Mirrors ROLE_PERMISSIONS in src/lib/domain/roles.ts exactly, using the
-- unified role keys (same as the application RoleKey union).
create table if not exists public.role_permissions (
  id             uuid primary key default gen_random_uuid(),
  role_id        uuid not null references public.roles(id) on delete cascade,
  permission_id  uuid not null references public.permissions(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (role_id, permission_id)
);

create index if not exists idx_role_permissions_role
  on public.role_permissions (role_id);
create index if not exists idx_role_permissions_permission
  on public.role_permissions (permission_id);

-- Idempotent seed using a join-free explicit mapping keyed by role key +
-- permission key. Each insert resolves role_id / permission_id at runtime.
-- guest
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.key = 'guest' and p.key in (
  'account.read_own','account.update_own','reservations.read_own'
)
on conflict (role_id, permission_id) do nothing;

-- foh_staff
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.key = 'foh_staff' and p.key in (
  'reservations.read_all','reservations.manage','seating.read','seating.manage',
  'check_in.manage','walk_ins.manage','waitlist.read'
)
on conflict (role_id, permission_id) do nothing;

-- kitchen_staff
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.key = 'kitchen_staff' and p.key in (
  'kitchen.read','kitchen.reports'
)
on conflict (role_id, permission_id) do nothing;

-- content_manager
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.key = 'content_manager' and p.key in (
  'content.read_drafts','content.manage','content.publish','menus.manage'
)
on conflict (role_id, permission_id) do nothing;

-- ops_manager
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.key = 'ops_manager' and p.key in (
  'reservations.read_all','reservations.manage','seating.read','seating.manage',
  'availability.manage','waitlist.read','waitlist.manage','payments.read','reports.read'
)
on conflict (role_id, permission_id) do nothing;

-- administrator (all permissions)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.key = 'administrator'
on conflict (role_id, permission_id) do nothing;

-- ============================================================================
-- user_roles
-- ============================================================================
-- Preserves role-assignment history for non-deleted users. Revocation sets
-- revoked_at rather than deleting the row. A partial unique index prevents
-- duplicate ACTIVE assignments (one active row per user+role).
--
-- NOTE ON DELETION: user_roles.user_id references auth.users(id) with
-- ON DELETE CASCADE. When an auth user is deleted, their user_roles rows are
-- ALSO deleted (cascade). assigned_by uses ON DELETE SET NULL, so the
-- assigning-user reference is cleared on deletion, but the row itself is
-- removed when the owning user is removed. revoked_at history is therefore
-- preserved only while the user account still exists.
create table if not exists public.user_roles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  role_id      uuid not null references public.roles(id) on delete restrict,
  assigned_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);

-- One active assignment per user+role.
create unique index if not exists uniq_user_roles_active
  on public.user_roles (user_id, role_id)
  where revoked_at is null;

create index if not exists idx_user_roles_user
  on public.user_roles (user_id);
create index if not exists idx_user_roles_role
  on public.user_roles (role_id);
create index if not exists idx_user_roles_active
  on public.user_roles (user_id)
  where revoked_at is null;

-- ============================================================================
-- New-user trigger: idempotent profile + Guest role on auth.users insert
-- ============================================================================
-- Fires when a new auth user is created (including public signup). It:
--   * Creates the profile (ON CONFLICT DO NOTHING -> idempotent).
--   * Assigns ONLY the Guest role.
--   * Ignores any role supplied through browser metadata (auth.users.raw_user_
--     meta_data is never trusted for role assignment).
--   * Never allows public signup to create an internal user.
-- SECURITY DEFINER so it can write to profiles/user_roles regardless of the
-- caller's RLS context; safe search_path is declared.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_guest_role_id uuid;
begin
  -- Resolve the Guest role id once.
  select id into v_guest_role_id from public.roles where key = 'guest';

  -- Create the profile idempotently. Email comes from auth.users; profile
  -- fields are left empty for the user to fill in later.
  insert into public.profiles (id, email, status)
  values (new.id, coalesce(new.email, ''), 'invited')
  on conflict (id) do nothing;

  -- Assign ONLY the Guest role, idempotently. No other role is ever assigned
  -- here, regardless of any metadata supplied by the browser.
  if v_guest_role_id is not null then
    insert into public.user_roles (user_id, role_id, assigned_by)
    values (new.id, v_guest_role_id, null)
    on conflict (user_id, role_id) where revoked_at is null do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Row-Level Security
-- ============================================================================

alter table public.profiles          enable row level security;
alter table public.roles             enable row level security;
alter table public.permissions       enable row level security;
alter table public.role_permissions  enable row level security;
alter table public.user_roles        enable row level security;

-- profiles: a user may read and update only their OWN profile row.
-- Column-level UPDATE protection is enforced by the GRANT/REVOKE above
-- (only first_name, last_name, phone are updatable by authenticated).
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No INSERT/DELETE policies for authenticated users on profiles: profiles are
-- created only by the handle_new_user trigger (SECURITY DEFINER). Users
-- cannot create or delete their own profile row directly.

-- roles / permissions / role_permissions: read-only reference data visible to
-- any authenticated user (needed for UI permission gates). No write policies
-- -> authenticated/anon cannot insert, update, or delete. Management is
-- reserved for future authorized administrators via the service-role client.
drop policy if exists "roles_read_authenticated" on public.roles;
create policy "roles_read_authenticated"
  on public.roles for select
  to authenticated
  using (true);

drop policy if exists "permissions_read_authenticated" on public.permissions;
create policy "permissions_read_authenticated"
  on public.permissions for select
  to authenticated
  using (true);

drop policy if exists "role_permissions_read_authenticated" on public.role_permissions;
create policy "role_permissions_read_authenticated"
  on public.role_permissions for select
  to authenticated
  using (true);

-- user_roles: a user may read only their own role assignments (active or
-- revoked). No write policies -> users cannot assign, revoke, or delete roles
-- for themselves or anyone. Assignment/revocation is reserved for future
-- authorized administrators.
drop policy if exists "user_roles_select_own" on public.user_roles;
create policy "user_roles_select_own"
  on public.user_roles for select
  to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- End of migration
-- ============================================================================
