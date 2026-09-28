-- ============================================================================
-- Sit Down Sundays — 0005_menu_child_archived_protection.sql
-- ============================================================================
-- Database-level archived-parent protection for menu_sections and menu_items.
--
-- STATUS: GENERATED, NOT YET APPLIED.
-- Supabase should run this versioned migration exactly once after
-- 0004_menu_cms_atomic_operations.sql. It does NOT modify or reapply 0001, 0002, 0003, or 0004.
-- idempotently replacing triggers and functions within this single
-- migration. IF NOT EXISTS does NOT repair or alter a partially applied
-- schema — run each versioned migration once.
--
-- DEPENDENCIES
--   * 0003_menu_catalog.sql (menus, menu_sections, menu_items).
--   * 0004_menu_cms_atomic_operations.sql (lock_parent_menu trigger,
--     reorder_menu_sections_atomic / reorder_menu_items_atomic RPCs,
--     deferred published-menu invariant, ensure_menu_publish_valid,
--     validate_cms_actor).
--
-- PROBLEM ADDRESSED
--   0004's lock_parent_menu() serializes child mutations against publishing
--   and reordering by taking a FOR UPDATE lock on the parent menu row, but it
--   does NOT check the parent menu's status. The application repositories
--   (menu-mock.server.ts / menu-supabase.server.ts) add a friendly pre-check
--   that rejects child mutations on archived menus, but a service-role caller
--   bypassing the application layer could still insert/update a section or
--   item under an archived parent menu. This migration makes the archived
--   check authoritative at the database level, performed WHILE HOLDING the
--   parent menu row FOR UPDATE lock, in the same transaction as the child
--   mutation.
--
-- SECURITY MODEL
--   * A new BEFORE INSERT OR UPDATE OR DELETE trigger function
--     (reject_archived_parent) is installed on menu_sections and menu_items.
--     It runs AFTER lock_parent_menu (which acquires the parent-menu FOR UPDATE
--     lock) and raises an exception if the parent menu is archived. Because it
--     runs in the same transaction, the exception rolls back the child mutation
--     AND its audit rows atomically.
--   * The trigger is a plain (SECURITY INVOKER) trigger function; it runs with
--     the invoking statement's role, not automatically with the table owner's
--     privileges. EXECUTE is revoked from PUBLIC/anon/authenticated so browser
--     roles cannot call it directly, but trigger invocation is unaffected by
--     EXECUTE privileges.
--   * Both reorder RPCs (reorder_menu_sections_atomic and
--     reorder_menu_items_atomic) are updated to reject an archived menu
--     immediately AFTER acquiring the menu-row FOR UPDATE lock (before
--     counting or validating IDs). Execution remains restricted to
--     service_role.
--   * All functions use a fixed safe search_path.
--   * CREATE OR REPLACE FUNCTION preserves existing ownership and privileges;
--     the explicit REVOKE/GRANT statements below are reapplied defensively to
--     guarantee the intended privilege set regardless of prior state.
-- ============================================================================

-- ============================================================================
-- Archived-parent protection trigger function
-- ============================================================================
-- Fires BEFORE INSERT OR UPDATE OR DELETE on menu_sections and menu_items,
-- AFTER lock_parent_menu has acquired the parent-menu FOR UPDATE lock. It reads
-- the parent menu status with SELECT ... FOR UPDATE so the status cannot change
-- between this check and the child write within this transaction. On UPDATE
-- where the menu_id changes (a cross-menu move), BOTH the old and new parent
-- menus are checked. On DELETE, the OLD parent menu is checked. The
-- lock_parent_menu trigger already locks both menu IDs in deterministic UUID
-- order to avoid deadlocks; this function only needs to read their status (the
-- row locks are already held for the duration of the transaction).
create or replace function public.reject_archived_parent()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_status varchar;
begin
  if TG_OP = 'INSERT' then
    -- New row: check the target parent menu.
    select status into v_status from public.menus where id = new.menu_id for update;
    if not found then
      raise exception 'Parent menu does not exist.';
    end if;
    if v_status = 'archived' then
      raise exception 'Archived menus cannot be edited.';
    end if;
    return new;
  end if;

  if TG_OP = 'UPDATE' then
    -- Check the OLD parent menu (if any) — it must not be archived.
    if old.menu_id is not null then
      select status into v_status from public.menus where id = old.menu_id for update;
      if found and v_status = 'archived' then
        raise exception 'Archived menus cannot be edited.';
      end if;
    end if;
    -- Check the NEW parent menu when it differs from the old one (cross-menu
    -- move). Both old and new must be non-archived.
    if new.menu_id is not null and new.menu_id is distinct from old.menu_id then
      select status into v_status from public.menus where id = new.menu_id for update;
      if not found then
        raise exception 'Parent menu does not exist.';
      end if;
      if v_status = 'archived' then
        raise exception 'Archived menus cannot be edited.';
      end if;
    end if;
    return new;
  end if;

  if TG_OP = 'DELETE' then
    -- Deleting a child of an archived menu is forbidden. Lock and read the
    -- OLD parent menu status with FOR UPDATE so it cannot change between this
    -- check and the delete within this transaction.
    if old.menu_id is not null then
      select status into v_status from public.menus where id = old.menu_id for update;
      if found and v_status = 'archived' then
        raise exception 'Archived menus cannot be edited.';
      end if;
    end if;
    return old;
  end if;

  return new;
end;
$$;

-- Revoke direct execution from browser roles. Trigger invocation is not
-- affected by EXECUTE privileges — the function still fires on
-- INSERT/UPDATE/DELETE.
revoke execute on function public.reject_archived_parent() from public, anon, authenticated;

-- Install the archived-parent protection trigger on menu_sections.
-- This fires BEFORE INSERT OR UPDATE OR DELETE, after lock_parent_menu
-- (PostgreSQL fires multiple BEFORE triggers of the same kind in
-- alphabetical order by trigger name, so 'trg_lock_menu_sections_parent'
-- (l...) runs before 'trg_reject_menu_sections_archived' (r...)). This
-- ordering is correct: the FOR UPDATE lock is acquired before the status
-- read.
drop trigger if exists trg_reject_menu_sections_archived on public.menu_sections;
create trigger trg_reject_menu_sections_archived
  before insert or update or delete on public.menu_sections
  for each row execute function public.reject_archived_parent();

-- Install the archived-parent protection trigger on menu_items.
-- Same ordering reasoning: 'trg_lock_menu_items_parent' (l...) fires before
-- 'trg_reject_menu_items_archived' (r...).
drop trigger if exists trg_reject_menu_items_archived on public.menu_items;
create trigger trg_reject_menu_items_archived
  before insert or update or delete on public.menu_items
  for each row execute function public.reject_archived_parent();

-- ============================================================================
-- Update reorder_menu_sections_atomic: reject archived menu after lock
-- ============================================================================
-- Replace the existing reorder_menu_sections_atomic with a version that
-- rejects an archived menu immediately AFTER acquiring the menu-row FOR UPDATE
-- lock (before counting or validating IDs). The lock and status are read
-- together so the archived status cannot change between this check and the
-- writes. Execution remains restricted to service_role.
create or replace function public.reorder_menu_sections_atomic(
  p_menu_id     uuid,
  p_section_ids uuid[],
  p_actor       uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_err   jsonb;
  v_array_len   int;
  v_distinct    int;
  v_existing    int;
  v_idx         int;
  v_menu_id     uuid;
  v_menu_status varchar;
begin
  v_actor_err := public.validate_cms_actor(p_actor);
  if v_actor_err is not null then
    return v_actor_err;
  end if;

  -- Lock the menu row AND read its status BEFORE any count or membership
  -- validation. This serializes the complete-list count against concurrent
  -- section inserts, moves, and deletes (which take the same parent-menu
  -- FOR UPDATE lock).
  select id, status into v_menu_id, v_menu_status
    from public.menus where id = p_menu_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Menu not found.');
  end if;

  -- Archived menus cannot be reordered. Checked AFTER acquiring the lock so
  -- the archived status cannot change between this check and the writes.
  if v_menu_status = 'archived' then
    return jsonb_build_object('ok', false, 'message', 'Archived menus cannot be edited.');
  end if;

  if p_section_ids is null or array_length(p_section_ids, 1) is null then
    return jsonb_build_object('ok', false, 'message', 'No sections provided.');
  end if;

  v_array_len := array_length(p_section_ids, 1);

  -- No duplicate IDs.
  select count(distinct id) from unnest(p_section_ids) as id into v_distinct;
  if v_distinct <> v_array_len then
    return jsonb_build_object('ok', false, 'message', 'Duplicate section IDs are not allowed.');
  end if;

  -- Count of existing sections for this menu (complete-list requirement).
  select count(*) into v_existing from public.menu_sections where menu_id = p_menu_id;

  -- Supplied count must match the existing count exactly (no missing/extra).
  if v_existing <> v_array_len then
    return jsonb_build_object(
      'ok', false,
      'message', 'Reorder list must include every section for this menu.'
    );
  end if;

  -- Every supplied ID must belong to this menu (no unknown/cross-menu IDs).
  if (
    select count(*) from public.menu_sections
    where menu_id = p_menu_id and id = any(p_section_ids)
  ) <> v_array_len then
    return jsonb_build_object(
      'ok', false,
      'message', 'One or more sections do not belong to this menu.'
    );
  end if;

  -- All valid: update each atomically within this transaction.
  for v_idx in 1..v_array_len loop
    update public.menu_sections
      set display_order = v_idx - 1, updated_by = p_actor
      where id = p_section_ids[v_idx] and menu_id = p_menu_id;
  end loop;

  return jsonb_build_object('ok', true, 'message', 'Sections reordered.');
end;
$$;

-- Re-apply execution privileges (CREATE OR REPLACE drops existing grants).
revoke execute on function public.reorder_menu_sections_atomic(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.reorder_menu_sections_atomic(uuid, uuid[], uuid) to service_role;

-- ============================================================================
-- Update reorder_menu_items_atomic: reject archived menu after lock
-- ============================================================================
-- Same archived-after-lock protection applied to item reordering.
create or replace function public.reorder_menu_items_atomic(
  p_menu_id   uuid,
  p_item_ids  uuid[],
  p_actor     uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_err   jsonb;
  v_array_len   int;
  v_distinct    int;
  v_existing    int;
  v_idx         int;
  v_menu_id     uuid;
  v_menu_status varchar;
begin
  v_actor_err := public.validate_cms_actor(p_actor);
  if v_actor_err is not null then
    return v_actor_err;
  end if;

  -- Lock the menu row AND read its status BEFORE any count or membership
  -- validation.
  select id, status into v_menu_id, v_menu_status
    from public.menus where id = p_menu_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Menu not found.');
  end if;

  -- Archived menus cannot be reordered.
  if v_menu_status = 'archived' then
    return jsonb_build_object('ok', false, 'message', 'Archived menus cannot be edited.');
  end if;

  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    return jsonb_build_object('ok', false, 'message', 'No items provided.');
  end if;

  v_array_len := array_length(p_item_ids, 1);

  select count(distinct id) from unnest(p_item_ids) as id into v_distinct;
  if v_distinct <> v_array_len then
    return jsonb_build_object('ok', false, 'message', 'Duplicate item IDs are not allowed.');
  end if;

  select count(*) into v_existing from public.menu_items where menu_id = p_menu_id;

  if v_existing <> v_array_len then
    return jsonb_build_object(
      'ok', false,
      'message', 'Reorder list must include every item for this menu.'
    );
  end if;

  if (
    select count(*) from public.menu_items
    where menu_id = p_menu_id and id = any(p_item_ids)
  ) <> v_array_len then
    return jsonb_build_object(
      'ok', false,
      'message', 'One or more items do not belong to this menu.'
    );
  end if;

  for v_idx in 1..v_array_len loop
    update public.menu_items
      set display_order = v_idx - 1, updated_by = p_actor
      where id = p_item_ids[v_idx] and menu_id = p_menu_id;
  end loop;

  return jsonb_build_object('ok', true, 'message', 'Items reordered.');
end;
$$;

-- Re-apply execution privileges (CREATE OR REPLACE drops existing grants).
revoke execute on function public.reorder_menu_items_atomic(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.reorder_menu_items_atomic(uuid, uuid[], uuid) to service_role;

-- ============================================================================
-- End of migration
-- ============================================================================
