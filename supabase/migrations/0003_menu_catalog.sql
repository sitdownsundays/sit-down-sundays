-- ============================================================================
-- Sit Down Sundays — 0003_menu_catalog.sql
-- ============================================================================
-- Menu CMS data foundation: menus, menu_sections, menu_items.
--
-- STATUS: GENERATED, NOT YET APPLIED.
-- This file has NOT been executed against any Supabase project. Supabase should
-- run this versioned migration exactly once as part of the ordered migration
-- sequence. `CREATE TABLE IF NOT EXISTS` is used so the migration text is
-- idempotent on a clean database, but IF NOT EXISTS does NOT repair or alter a
-- partially applied schema — if a previous attempt partially executed this
-- migration, resolve the partial state manually before re-running; do not rely
-- on IF NOT EXISTS to reconcile diverged schemas.
--
-- DEPENDENCIES
--   * This migration references auth.users(id) for created_by / updated_by.
--   * It does NOT depend on public.profiles or public.roles; those are owned
--     by 0002_auth_roles.sql. Do not conflate the two. Authorization of CMS
--     writes is enforced server-side through the service-role client gated by
--     application role checks, not through these FK references.
--
-- POSTGRESQL VERSION REQUIREMENT
--   * The menu_items composite foreign key uses `ON DELETE SET NULL (section_id)`
--     — a column-list ON DELETE SET NULL, supported by PostgreSQL 15 and newer.
--     Supabase projects running PostgreSQL 15+ support this syntax. If the
--     target project is older than PostgreSQL 15, this migration will error at
--     apply time on the composite FK clause; upgrade the project's Postgres
--     version before applying. (A plain composite `ON DELETE SET NULL` without
--     a column list is NOT acceptable here because it would null menu_id, which
--     is NOT NULL on menu_items and would break the delete.)
--
-- VOCABULARY
--   * Menu status: 'draft' | 'published' | 'archived'.
--   * Menu item course/category mirrors the application MenuCategory union:
--     'starter' | 'main' | 'side' | 'dessert' | 'beverage' | 'children'.
--   * Price is stored as INTEGER CENTS (price_cents), never as a float.
--   * Slug must match the application canonical format: lowercase letters and
--     digits, single hyphens between segments, no leading/trailing hyphen,
--     no whitespace (see chk_menus_slug_format below).
--
-- SECURITY MODEL
--   * RLS is enabled on every new table.
--   * PUBLIC READS: only published, active content is exposed. Draft and
--     archived menus never reach anonymous or authenticated visitors through
--     RLS. A menu item is publicly readable only when:
--       - its menu is currently in its published window, AND
--       - the item itself is active, AND
--       - either section_id IS NULL, OR the referenced section is active and
--         belongs to the SAME menu as the item.
--     (See the menu_items SELECT policy below.)
--   * CMS MUTATIONS: there are NO INSERT/UPDATE/DELETE policies for anon or
--     authenticated users on any of these tables. All CMS writes happen
--     server-side through the service-role client (which bypasses RLS), gated
--     by server-side authorization requiring the Content Manager, Operations
--     Manager, or Administrator role. The database cannot be used as a
--     generic proxy by the browser.
--   * When a menu is archived, its items are no longer publicly readable
--     because the public SELECT policies join on menu status = 'published'.
--
-- NON-DESTRUCTIVE
--   * No DROP TABLE / DROP SCHEMA / TRUNCATE / CASCADE deletion of history.
--   * `drop ... if exists` is used only for idempotently replacing triggers,
--     policies, and functions within this single migration.
--   * 0001 and 0002 are not modified or reapplied.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Reusable updated-at function (declared locally for self-containment;
-- safe search_path). Matches the signature from 0001/0002.
-- ----------------------------------------------------------------------------
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
-- menus
-- ============================================================================
create table if not exists public.menus (
  id              uuid primary key default gen_random_uuid(),
  name            varchar(160) not null,
  -- Canonical slug format: lowercase letters/digits, single hyphens between
  -- segments, no leading/trailing hyphen, no whitespace. Matches the
  -- application's normalizeSlug()/isValidSlug() rules.
  slug            varchar(160) not null
                  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description     text not null default '',
  status          varchar(20) not null default 'draft'
                  check (status in ('draft','published','archived')),
  display_order   integer not null default 0 check (display_order >= 0),
  publish_at      timestamptz,
  unpublish_at    timestamptz,
  -- Either publish_at or unpublish_at may individually be null. When both
  -- are present, unpublish_at must be strictly later than publish_at.
  check (
    publish_at is null
    or unpublish_at is null
    or unpublish_at > publish_at
  ),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  updated_by      uuid references auth.users(id) on delete set null
);

-- One active slug per menu (enforced by a partial unique index so historical
-- archived rows do not block slug reuse of a new published menu). Two active
-- (non-archived) menus cannot share a slug.
create unique index if not exists uniq_menus_slug_active
  on public.menus (slug)
  where status <> 'archived';

create index if not exists idx_menus_status on public.menus (status);
create index if not exists idx_menus_display_order on public.menus (display_order);

drop trigger if exists trg_menus_updated_at on public.menus;
create trigger trg_menus_updated_at
  before update on public.menus
  for each row execute function public.set_updated_at();

-- ============================================================================
-- menu_sections
-- ============================================================================
create table if not exists public.menu_sections (
  id              uuid primary key default gen_random_uuid(),
  menu_id         uuid not null references public.menus(id) on delete cascade,
  name            varchar(160) not null,
  description     text not null default '',
  display_order   integer not null default 0 check (display_order >= 0),
  is_active        boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  updated_by      uuid references auth.users(id) on delete set null
);

-- Referenced composite key for menu_items.section integrity: (id, menu_id).
-- id is already globally unique (it is the primary key), so this composite
-- unique index is also unique on id; it exists solely to give menu_items a
-- (section_id, menu_id) -> menu_sections(id, menu_id) composite FK target.
create unique index if not exists uniq_menu_sections_id_menu
  on public.menu_sections (id, menu_id);

create index if not exists idx_menu_sections_menu on public.menu_sections (menu_id);
create index if not exists idx_menu_sections_display_order
  on public.menu_sections (menu_id, display_order);

drop trigger if exists trg_menu_sections_updated_at on public.menu_sections;
create trigger trg_menu_sections_updated_at
  before update on public.menu_sections
  for each row execute function public.set_updated_at();

-- ============================================================================
-- menu_items
-- ============================================================================
-- Price stored as integer cents. Dietary labels and allergens are stored as
-- text[] arrays. image_url + image_alt support accessible dish photography.
--
-- Accessibility constraint: image_url may be null. When image_url is present
-- and nonblank, image_alt must also be present and nonblank.
--
-- Cross-menu section integrity (DATABASE-NATIVE, no triggers):
--   A menu item's (section_id, menu_id) must reference an existing
--   menu_sections(id, menu_id) row via a composite foreign key. This enforces,
--   at the database level, that an item's section belongs to the SAME menu as
--   the item. Because section_id is nullable and PostgreSQL composite FKs use
--   MATCH SIMPLE semantics by default, a NULL section_id exempts the row from
--   the composite FK — so unassigned items remain valid for any menu.
--
--   Deleting a referenced section nulls ONLY section_id via the column-list
--   `ON DELETE SET NULL (section_id)` clause (PostgreSQL 15+), preserving the
--   item's required NOT NULL menu_id. Deleting a menu still cascades its
--   sections and items through the menu_items.menu_id FK (ON DELETE CASCADE).
create table if not exists public.menu_items (
  id              uuid primary key default gen_random_uuid(),
  menu_id         uuid not null references public.menus(id) on delete cascade,
  section_id      uuid,
  name            varchar(160) not null,
  description     text not null default '',
  price_cents     integer not null default 0 check (price_cents >= 0),
  category        varchar(40) not null default 'main'
                  check (category in ('starter','main','side','dessert','beverage','children')),
  image_url       varchar(2048),
  image_alt       varchar(300),
  dietary_tags    text[] not null default '{}',
  allergens       text[] not null default '{}',
  is_active        boolean not null default true,
  is_featured      boolean not null default false,
  display_order   integer not null default 0 check (display_order >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  updated_by      uuid references auth.users(id) on delete set null,
  -- Accessibility: a present image requires descriptive alt text.
  -- A blank image_url is allowed without alt text.
  check (
    nullif(btrim(image_url), '') is null
    or nullif(btrim(image_alt), '') is not null
  ),
  -- Cross-menu section integrity: (section_id, menu_id) -> menu_sections(id, menu_id).
  -- Column-list ON DELETE SET NULL (section_id) preserves the NOT NULL menu_id
  -- when a section is deleted. Requires PostgreSQL 15+.
  foreign key (section_id, menu_id)
    references public.menu_sections(id, menu_id)
    on delete set null (section_id)
);

create index if not exists idx_menu_items_menu on public.menu_items (menu_id);
create index if not exists idx_menu_items_section on public.menu_items (section_id);
create index if not exists idx_menu_items_active_featured
  on public.menu_items (menu_id, is_active, is_featured);
create index if not exists idx_menu_items_category
  on public.menu_items (menu_id, category);
create index if not exists idx_menu_items_display_order
  on public.menu_items (menu_id, display_order);

drop trigger if exists trg_menu_items_updated_at on public.menu_items;
create trigger trg_menu_items_updated_at
  before update on public.menu_items
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Row-Level Security
-- ============================================================================

alter table public.menus         enable row level security;
alter table public.menu_sections enable row level security;
alter table public.menu_items    enable row level security;

-- ----------------------------------------------------------------------------
-- Public reads: only published, active content.
-- A published menu is one with status = 'published' (and, if scheduled,
-- currently within its publish window). Its active sections and active items
-- are then readable. Draft / archived menus and inactive items never reach
-- anon or authenticated visitors through RLS.
-- ----------------------------------------------------------------------------

-- Helper: is a menu currently in its published window?
-- Used by the public read policies so scheduled publish/unpublish is honored.
-- Marked STABLE because it only reads table data and is valid for use in RLS
-- policy expressions and views (no side effects, deterministic within a query).
create or replace function public.menu_is_publicly_visible(p_menu_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.menus m
    where m.id = p_menu_id
      and m.status = 'published'
      and (m.publish_at is null or m.publish_at <= now())
      and (m.unpublish_at is null or m.unpublish_at > now())
  )
$$;

-- Helper: is a menu_item's section, when assigned, active and in the same menu?
-- When section_id is null, this returns true (unassigned items may be visible).
-- When section_id is not null, the referenced section must exist, be active,
-- and belong to the same menu as the item.
create or replace function public.menu_item_section_publicly_ok(
  p_menu_id uuid,
  p_section_id uuid
)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select
    case
      when p_section_id is null then true
      else exists (
        select 1 from public.menu_sections s
        where s.id = p_section_id
          and s.menu_id = p_menu_id
          and s.is_active = true
      )
    end
$$;

-- menus: public may SELECT only published menus within their publish window.
drop policy if exists "menus_select_published" on public.menus;
create policy "menus_select_published"
  on public.menus for select
  to anon, authenticated
  using (
    status = 'published'
    and (publish_at is null or publish_at <= now())
    and (unpublish_at is null or unpublish_at > now())
  );

-- menu_sections: public may SELECT only active sections of published menus.
drop policy if exists "menu_sections_select_published" on public.menu_sections;
create policy "menu_sections_select_published"
  on public.menu_sections for select
  to anon, authenticated
  using (
    is_active = true
    and public.menu_is_publicly_visible(menu_id)
  );

-- menu_items: public may SELECT only active items of published menus whose
-- assigned section (if any) is active and belongs to the same menu. Items
-- with section_id IS NULL remain visible when the menu is published.
drop policy if exists "menu_items_select_published" on public.menu_items;
create policy "menu_items_select_published"
  on public.menu_items for select
  to anon, authenticated
  using (
    is_active = true
    and public.menu_is_publicly_visible(menu_id)
    and public.menu_item_section_publicly_ok(menu_id, section_id)
  );

-- ----------------------------------------------------------------------------
-- CMS mutations: NO INSERT/UPDATE/DELETE policies for anon or authenticated.
-- All writes are performed server-side via the service-role client (which
-- bypasses RLS) and gated by server-side authorization requiring the
-- Content Manager, Operations Manager, or Administrator role.
--
-- FUTURE authenticated staff policies (to be added after the staff-authorization
-- phase lands):
--   * A SELECT policy for draft content scoped to users holding
--     content.read_drafts (e.g. content_manager, ops_manager, administrator).
--   * INSERT/UPDATE/DELETE policies for users holding menus.manage / content.manage
--     / content.publish, enforced through role membership checks against
--     public.user_roles + public.role_permissions.
-- Until then, draft and archived data is invisible to the browser and CMS
-- writes are impossible from the client. Service-role writes remain the only
-- path and are authorized in the server function layer.
-- ----------------------------------------------------------------------------

-- ============================================================================
-- End of migration
-- ============================================================================
