-- ============================================================================
-- Sit Down Sundays — 0004_menu_cms_atomic_operations.sql
-- ============================================================================
-- Menu CMS hardening: parent-menu row locking, atomic publishing,
-- atomic complete-list reordering, trigger-based audit logging, actor
-- validation, service-role-only RPC execution privileges, a deferred
-- published-menu invariant, reorder menu-row locking, and database-level
-- archived→published transition protection.
--
-- STATUS: GENERATED, NOT YET APPLIED.
-- Supabase should run this versioned migration exactly once after
-- 0003_menu_catalog.sql. It does NOT modify or reapply 0001, 0002, or 0003.
-- `drop ... if exists` is used only for idempotently replacing triggers and
-- functions within this single migration. IF NOT EXISTS does NOT repair or
-- alter a partially applied schema — run each versioned migration once.
--
-- DEPENDENCIES
--   * 0003_menu_catalog.sql (menus, menu_sections, menu_items, RLS policies,
--     menu_is_publicly_visible, menu_item_section_publicly_ok).
--   * 0001_waitlist_foundation.sql (audit_logs table, append-only triggers).
--   * 0002_auth_roles.sql (auth.users via Supabase Auth).
--
-- SECURITY MODEL
--   * Three SECURITY DEFINER RPCs perform atomic CMS operations.
--     Execution is revoked from PUBLIC, anon, and authenticated; granted ONLY
--     to service_role. The browser and authenticated non-service clients
--     cannot call them directly.
--   * A shared parent-menu lock trigger function (lock_parent_menu) is
--     installed BEFORE INSERT, UPDATE, or DELETE on menu_sections and
--     menu_items. It takes a row-level FOR UPDATE lock on the parent menu so
--     section/item mutations serialize against publish_menu_atomic and the
--     reorder RPCs. When old and new menu IDs differ, both IDs are locked in
--     deterministic UUID order to avoid deadlocks.
--   * A DEFERRABLE INITIALLY DEFERRED constraint trigger
--     (ensure_published_menu_has_eligible_item) checks the FINAL transaction
--     state after menu_sections/menu_items are inserted, updated, moved,
--     deactivated, or deleted. A published menu must retain at least one
--     publicly eligible active item, or the entire transaction (mutation +
--     audit rows) rolls back.
--   * A BEFORE INSERT OR UPDATE trigger (ensure_menu_publish_valid) on menus
--     rejects archived→published transitions at the database level (defense
--     in depth, even if a service-role caller bypasses the application
--     repository) and requires at least one eligible active item when a menu
--     is published.
--   * Audit triggers write to the existing append-only audit_logs table in
--     the SAME transaction as each menu/menu_section/menu_item INSERT or
--     UPDATE. If the audit insert fails, the mutation rolls back.
--   * All SECURITY DEFINER functions use a fixed safe search_path
--     (public, pg_temp).
--   * No secrets, cookies, tokens, headers, or environment variables are
--     stored in audit rows — only safe old/new row JSON and the verified
--     actor user id (from created_by / updated_by).
--
-- POSTGRESQL VERSION
--   * Requires PostgreSQL 15+ (same as 0003). Tested against PostgreSQL 17.6.
--   * Column-list ON DELETE SET NULL is supported from PostgreSQL 15+.
--   * DEFERRABLE INITIALLY DEFERRED constraint triggers are supported from
--     PostgreSQL 9.1+.
--
-- NON-DESTRUCTIVE
--   * No DROP TABLE / DROP SCHEMA / TRUNCATE / CASCADE deletion of history.
--   * 0001, 0002, and 0003 are not modified or reapplied.
-- ============================================================================

-- ============================================================================
-- Shared parent-menu lock trigger function
-- ============================================================================
-- BEFORE INSERT, UPDATE, or DELETE on menu_sections / menu_items, take a
-- row-level FOR UPDATE lock on the affected parent menu row(s). This
-- serializes section/item mutations against publish_menu_atomic and the
-- reorder RPCs (which also lock the menu row with FOR UPDATE), so a
-- concurrent item deactivation or insert cannot race against publishing or
-- reordering and produce an inconsistent state.
--
-- For INSERT: lock NEW.menu_id.
-- For DELETE: lock OLD.menu_id.
-- For UPDATE: lock OLD.menu_id and NEW.menu_id (if different), in
--   deterministic ascending order to avoid deadlocks between two
--   transactions moving rows between the same pair of menus.
--
-- This is a trigger (SECURITY INVOKER) function; it runs with the privileges
-- of the table owner during trigger execution. EXECUTE is revoked from
-- PUBLIC/anon/authenticated so it cannot be called directly by browser roles,
-- but trigger invocation is unaffected by function EXECUTE privileges.
create or replace function public.lock_parent_menu()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_old_menu uuid;
  v_new_menu uuid;
  v_lo       uuid;
  v_hi       uuid;
begin
  if TG_OP = 'INSERT' then
    select id into v_new_menu from public.menus where id = new.menu_id for update;
    if not found then
      raise exception 'Parent menu does not exist.';
    end if;
    return new;
  end if;

  if TG_OP = 'DELETE' then
    select id into v_old_menu from public.menus where id = old.menu_id for update;
    return old;
  end if;

  -- UPDATE: lock old and new menu rows.
  v_old_menu := old.menu_id;
  v_new_menu := new.menu_id;
  if v_old_menu is not null and v_new_menu is not null and v_old_menu <> v_new_menu then
    -- Lock both in deterministic ascending order to avoid AB-BA deadlocks.
    if v_old_menu < v_new_menu then
      v_lo := v_old_menu; v_hi := v_new_menu;
    else
      v_lo := v_new_menu; v_hi := v_old_menu;
    end if;
    perform 1 from public.menus where id = v_lo for update;
    perform 1 from public.menus where id = v_hi for update;
  elsif v_new_menu is not null then
    perform 1 from public.menus where id = v_new_menu for update;
  elsif v_old_menu is not null then
    perform 1 from public.menus where id = v_old_menu for update;
  end if;

  return new;
end;
$$;

-- Install the parent-menu lock trigger on menu_sections.
drop trigger if exists trg_lock_menu_sections_parent on public.menu_sections;
create trigger trg_lock_menu_sections_parent
  before insert or update or delete on public.menu_sections
  for each row execute function public.lock_parent_menu();

-- Install the parent-menu lock trigger on menu_items.
drop trigger if exists trg_lock_menu_items_parent on public.menu_items;
create trigger trg_lock_menu_items_parent
  before insert or update or delete on public.menu_items
  for each row execute function public.lock_parent_menu();

-- ============================================================================
-- Actor validation helper (service-role only)
-- ============================================================================
-- Validates that p_actor is a non-null id matching an auth.users row.
-- Used by every atomic RPC before any mutation. Returns null on success or a
-- safe jsonb failure object on failure. Never exposes auth data; the failure
-- message is a generic safe string.
create or replace function public.validate_cms_actor(
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp, auth
as $$
declare
  v_exists boolean;
begin
  if p_actor is null then
    return jsonb_build_object('ok', false, 'message', 'Actor is required.');
  end if;
  select exists(select 1 from auth.users where id = p_actor) into v_exists;
  if not v_exists then
    return jsonb_build_object('ok', false, 'message', 'Actor is required.');
  end if;
  return null;
end;
$$;

revoke execute on function public.validate_cms_actor(uuid) from public, anon, authenticated;
grant execute on function public.validate_cms_actor(uuid) to service_role;

-- ============================================================================
-- Published-menu invariant (DEFERRABLE INITIALLY DEFERRED)
-- ============================================================================
-- Checks the FINAL transaction state after menu_sections or menu_items are
-- inserted, updated, moved, deactivated, or deleted. Because the constraint
-- trigger is DEFERRABLE INITIALLY DEFERRED, multi-row transactions are
-- checked once in their final state at COMMIT time, not after each
-- intermediate row — so deactivating the last eligible item and activating a
-- replacement within the same transaction is allowed.
--
-- For every affected old and new menu_id:
--   * If the menu does not exist or is not published, no check is needed.
--   * If the menu is published, it must retain at least one publicly eligible
--     active item. An eligible item is active AND either unsectioned
--     (section_id IS NULL) or assigned to an active section in the same menu.
--   * If the final state would leave a published menu empty, raise a safe
--     check-violation exception. The exception rolls back the mutation AND
--     its audit entries (they share the same transaction).
create or replace function public.ensure_published_menu_has_eligible_item()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_menu_ids uuid[];
  v_mid      uuid;
  v_count    int;
begin
  v_menu_ids := array[]::uuid[];

  if TG_OP = 'INSERT' then
    v_menu_ids := array_append(v_menu_ids, new.menu_id);
  elsif TG_OP = 'DELETE' then
    v_menu_ids := array_append(v_menu_ids, old.menu_id);
  else -- UPDATE
    if old.menu_id is not null then
      v_menu_ids := array_append(v_menu_ids, old.menu_id);
    end if;
    if new.menu_id is not null then
      v_menu_ids := array_append(v_menu_ids, new.menu_id);
    end if;
  end if;

  foreach v_mid in array v_menu_ids loop
    if exists (select 1 from public.menus where id = v_mid and status = 'published') then
      select count(*) into v_count
      from public.menu_items mi
      where mi.menu_id = v_mid
        and mi.is_active = true
        and (
          mi.section_id is null
          or exists (
            select 1
            from public.menu_sections s
            where s.id = mi.section_id
              and s.menu_id = v_mid
              and s.is_active = true
          )
        );
      if v_count = 0 then
        raise exception 'A published menu must retain at least one active item.';
      end if;
    end if;
  end loop;

  return null;
end;
$$;

-- Constraint triggers (DEFERRABLE INITIALLY DEFERRED) on menu_items.
drop trigger if exists trg_menu_items_published_invariant on public.menu_items;
create constraint trigger trg_menu_items_published_invariant
  after insert or update or delete on public.menu_items
  deferrable initially deferred
  for each row execute function public.ensure_published_menu_has_eligible_item();

-- Constraint triggers (DEFERRABLE INITIALLY DEFERRED) on menu_sections.
drop trigger if exists trg_menu_sections_published_invariant on public.menu_sections;
create constraint trigger trg_menu_sections_published_invariant
  after insert or update or delete on public.menu_sections
  deferrable initially deferred
  for each row execute function public.ensure_published_menu_has_eligible_item();

-- ============================================================================
-- Menu publish validity + archived→published protection (menus trigger)
-- ============================================================================
-- BEFORE INSERT OR UPDATE on menus:
--   * Rejects an archived→published transition at the database level, even if
--     a service-role caller bypasses the application repository.
--   * When a menu is (or becomes) published, requires at least one publicly
--     eligible active item. Publishing a draft menu must still go through the
--     eligible-item invariant.
create or replace function public.ensure_menu_publish_valid()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if TG_OP = 'UPDATE' then
    -- Permanent archive protection: an archived menu cannot transition to
    -- any other status (blocks archived→draft and archived→published).
    -- Remaining archived is allowed.
    if old.status = 'archived' and new.status <> 'archived' then
      raise exception 'An archived menu cannot transition to any other status.';
    end if;
  end if;

  if new.status = 'published' then
    select count(*) into v_count
    from public.menu_items mi
    where mi.menu_id = new.id
      and mi.is_active = true
      and (
        mi.section_id is null
        or exists (
          select 1
          from public.menu_sections s
          where s.id = mi.section_id
            and s.menu_id = new.id
            and s.is_active = true
        )
      );
    if v_count = 0 then
      raise exception 'A published menu needs at least one active item before it can go live.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_menus_publish_valid on public.menus;
create trigger trg_menus_publish_valid
  before insert or update on public.menus
  for each row execute function public.ensure_menu_publish_valid();

-- ============================================================================
-- Atomic publishing RPC
-- ============================================================================
-- Validates the actor, locks the menu row with FOR UPDATE, confirms the menu
-- is draft or already published (archived menus cannot be republished),
-- verifies at least one publicly-eligible active item (active AND either
-- section_id IS NULL or in an active section of the same menu), then updates
-- status and updated_by — all in one transaction. The parent-menu lock taken
-- here serializes against concurrent section/item deactivation triggers.
--
-- Returns jsonb: { "ok": bool, "message": text }.
-- On failure, no row is modified (the UPDATE is skipped before execution).
-- On success, the status UPDATE fires the audit trigger atomically.
create or replace function public.publish_menu_atomic(
  p_menu_id uuid,
  p_actor   uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_menu         public.menus%rowtype;
  v_actor_err    jsonb;
  v_has_eligible boolean;
begin
  -- Actor must be a verified auth user before any mutation.
  v_actor_err := public.validate_cms_actor(p_actor);
  if v_actor_err is not null then
    return v_actor_err;
  end if;

  -- Lock the menu row for the duration of this transaction. If the menu is
  -- absent, return not-found without exposing internal state.
  select * into v_menu from public.menus where id = p_menu_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Menu not found.');
  end if;

  -- Archived menus cannot be republished.
  if v_menu.status = 'archived' then
    return jsonb_build_object(
      'ok', false,
      'message', 'An archived menu cannot be published again.'
    );
  end if;

  -- Only draft or already-published menus may be published.
  if v_menu.status not in ('draft', 'published') then
    return jsonb_build_object(
      'ok', false,
      'message', 'This menu cannot be published in its current state.'
    );
  end if;

  -- Verify at least one publicly-eligible active item while holding the lock.
  select exists(
    select 1
    from public.menu_items mi
    where mi.menu_id = p_menu_id
      and mi.is_active = true
      and (
        mi.section_id is null
        or exists (
          select 1
          from public.menu_sections s
          where s.id = mi.section_id
            and s.menu_id = p_menu_id
            and s.is_active = true
        )
      )
  ) into v_has_eligible;

  if not v_has_eligible then
    return jsonb_build_object(
      'ok', false,
      'message', 'A published menu needs at least one active item before it can go live.'
    );
  end if;

  update public.menus
    set status = 'published', updated_by = p_actor
    where id = p_menu_id;

  return jsonb_build_object('ok', true, 'message', 'Menu published.');
end;
$$;

revoke execute on function public.publish_menu_atomic(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.publish_menu_atomic(uuid, uuid)
  to service_role;

-- ============================================================================
-- Atomic complete-list reordering RPCs
-- ============================================================================
-- These are COMPLETE-LIST reorder operations: the supplied array must be
-- nonempty, contain unique IDs, belong to the supplied menu, and include
-- EVERY existing section (or item) for that menu. Missing, extra, duplicate,
-- unknown, or cross-menu IDs cause zero writes and a safe failure message.
-- display_order and updated_by are updated for every row in one transaction.
--
-- At the start of each RPC, after actor validation but BEFORE counting or
-- validating IDs, the supplied menu row is locked with SELECT ... FOR UPDATE.
-- This serializes the complete-list count against section/item inserts,
-- moves, and deletes through the existing parent-lock triggers, so a
-- concurrent insert cannot invalidate the count between validation and write.
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
  v_actor_err  jsonb;
  v_array_len  int;
  v_distinct   int;
  v_existing   int;
  v_idx        int;
  v_menu_id    uuid;
begin
  v_actor_err := public.validate_cms_actor(p_actor);
  if v_actor_err is not null then
    return v_actor_err;
  end if;

  -- Lock the menu row BEFORE any count or membership validation. This
  -- serializes the complete-list count against concurrent section inserts,
  -- moves, and deletes (which take the same parent-menu FOR UPDATE lock).
  select id into v_menu_id from public.menus where id = p_menu_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Menu not found.');
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

revoke execute on function public.reorder_menu_sections_atomic(uuid, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.reorder_menu_sections_atomic(uuid, uuid[], uuid)
  to service_role;

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
  v_actor_err  jsonb;
  v_array_len  int;
  v_distinct   int;
  v_existing   int;
  v_idx        int;
  v_menu_id    uuid;
begin
  v_actor_err := public.validate_cms_actor(p_actor);
  if v_actor_err is not null then
    return v_actor_err;
  end if;

  -- Lock the menu row BEFORE any count or membership validation. This
  -- serializes the complete-list count against concurrent item inserts,
  -- moves, and deletes (which take the same parent-menu FOR UPDATE lock).
  select id into v_menu_id from public.menus where id = p_menu_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Menu not found.');
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

revoke execute on function public.reorder_menu_items_atomic(uuid, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.reorder_menu_items_atomic(uuid, uuid[], uuid)
  to service_role;

-- ============================================================================
-- Trigger-based audit logging
-- ============================================================================
-- A single AFTER INSERT OR UPDATE trigger per table writes a safe audit_logs
-- row in the SAME transaction as the mutation. The actor is taken from
-- created_by (INSERT) or updated_by (UPDATE) — the verified user id set by the
-- authorized server operation. Only safe old/new row JSON is recorded; never
-- cookies, tokens, headers, environment variables, or secrets (these tables
-- contain none). If the audit insert fails, the entire transaction (including
-- the mutation) rolls back — audit and mutation succeed or fail together.
create or replace function public.audit_cms_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_actor       uuid;
  v_action      varchar(120);
  v_entity_type varchar(120);
begin
  v_entity_type := TG_TABLE_NAME;

  if TG_OP = 'INSERT' then
    v_actor  := new.created_by;
    v_action := v_entity_type || '.insert';
    insert into public.audit_logs
      (actor_user_id, action, entity_type, entity_id, previous_values, new_values)
    values
      (v_actor, v_action, v_entity_type, new.id::text, null, to_jsonb(new));
    return new;

  elsif TG_OP = 'UPDATE' then
    v_actor  := new.updated_by;
    v_action := v_entity_type || '.update';
    insert into public.audit_logs
      (actor_user_id, action, entity_type, entity_id, previous_values, new_values)
    values
      (v_actor, v_action, v_entity_type, new.id::text, to_jsonb(old), to_jsonb(new));
    return new;
  end if;

  return new;
end;
$$;

-- menus audit trigger
drop trigger if exists trg_menus_audit on public.menus;
create trigger trg_menus_audit
  after insert or update on public.menus
  for each row execute function public.audit_cms_change();

-- menu_sections audit trigger
drop trigger if exists trg_menu_sections_audit on public.menu_sections;
create trigger trg_menu_sections_audit
  after insert or update on public.menu_sections
  for each row execute function public.audit_cms_change();

-- menu_items audit trigger
drop trigger if exists trg_menu_items_audit on public.menu_items;
create trigger trg_menu_items_audit
  after insert or update on public.menu_items
  for each row execute function public.audit_cms_change();

-- ============================================================================
-- Trigger helper execution privileges
-- ============================================================================
-- Revoke EXECUTE on the trigger helper functions from PUBLIC, anon, and
-- authenticated so browser roles cannot call them directly. Trigger execution
-- is NOT affected by function EXECUTE privileges (triggers fire via the table
-- owner's privileges), so revoking EXECUTE does not break trigger behavior.
revoke execute on function public.audit_cms_change() from public, anon, authenticated;
revoke execute on function public.lock_parent_menu() from public, anon, authenticated;
revoke execute on function public.ensure_published_menu_has_eligible_item()
  from public, anon, authenticated;
revoke execute on function public.ensure_menu_publish_valid()
  from public, anon, authenticated;

-- ============================================================================
-- End of migration
-- ============================================================================
