-- ============================================================================
-- Sit Down Sundays — 0006_menu_images_storage.sql
-- ============================================================================
-- Menu-item image uploads via Supabase Storage.
--
-- UNAPPLIED MIGRATION — for external review. Do not execute until reviewed.
--
-- Canonical bucket id/name: menu-images (hyphen). This matches the application
-- constant MENU_IMAGES_BUCKET in src/lib/menu/image-upload.ts and the upload
-- repository. Apply this versioned migration exactly once.
--
-- Design:
--  * A public-read bucket "menu-images" so menu photographs load on the
--    public menu page and homepage featured preview without per-request
--    signed URLs.
--  * Writes are server-side only. The application uploads through the
--    service-role client from a server-only module AFTER server-side
--    authorization (resolveMenuActor: content_manager / ops_manager /
--    administrator). Browser code never receives the service-role key and
--    never writes to Storage directly.
--  * The bucket is created idempotently. An existing bucket is handled
--    explicitly: its public flag, size limit, and MIME allow-list are set to
--    the intended values rather than silently left with incompatible settings.
--
-- SECURITY — IMPORTANT LIMITATIONS:
--  * These AS RESTRICTIVE policies deny anon/authenticated writes to this
--    bucket so a browser holding only the anon key cannot upload. They do NOT
--    protect against a leaked service-role key, which bypasses RLS entirely.
--    The service-role key must remain server-only and is never shipped to the
--    browser bundle.
--  * Public SELECT (read) is allowed so menu photographs render anonymously.
--  * MIME-type allow-listing and the 5 MB byte limit are enforced server-side
--    in the upload server function (by magic bytes + size). The bucket's
--    file_size_limit / allowed_mime_types are hints, not the sole enforcement.
--
-- The migration assumes 0001–0005 are already applied. It introduces no
-- application tables.
-- ============================================================================

-- 1. Storage bucket ----------------------------------------------------------
-- Create or reconcile the public-read menu-images bucket.
-- storage.buckets columns: id, name, public, file_size_limit, allowed_mime_types.
-- We handle an existing bucket explicitly via an UPDATE so incompatible
-- settings (private, no limit, wrong MIME list) are corrected, not silently
-- retained.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select
  'menu-images',
  'menu-images',
  true,
  5242880, -- 5 MB, the exact byte limit used by server validation (MAX_IMAGE_BYTES)
  array['image/jpeg', 'image/png', 'image/webp']
where not exists (select 1 from storage.buckets where id = 'menu-images');

-- If the bucket already exists, reconcile its settings to the intended values.
update storage.buckets
set
  name = 'menu-images',
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'menu-images';

-- 2. Public read policy ------------------------------------------------------
-- Anyone (anon + authenticated) may read menu photographs. This matches the
-- public menu page and homepage featured preview, which load images
-- anonymously.
drop policy if exists "menu_images_public_read" on storage.objects;
create policy "menu_images_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'menu-images');

-- 3. Restrictive write-block policies ----------------------------------------
-- AS RESTRICTIVE bucket-scoped policies that forbid anon/authenticated from
-- writing to the menu-images bucket. AS RESTRICTIVE means these policies are
-- combined with AND semantics against other matching policies, so they cannot
-- be satisfied by a permissive policy elsewhere; the bucket_id <> 'menu-images'
-- predicate is false for any object in this bucket, so the write is denied.
--
-- For INSERT/UPDATE, WITH CHECK is the constraint evaluated for the new row.
-- For UPDATE/DELETE, USING gates whether an existing row can be touched.
--
-- These preserve unrelated buckets: a row in another bucket satisfies
-- (bucket_id <> 'menu-images') and is unaffected by these policies.

-- INSERT — deny anon/authenticated from creating objects in this bucket.
drop policy if exists "menu_images_anon_insert_block" on storage.objects;
create policy "menu_images_anon_insert_block"
  on storage.objects
  as restrictive
  for insert
  to anon, authenticated
  with check (bucket_id <> 'menu-images');

-- UPDATE — deny anon/authenticated from modifying objects in this bucket.
drop policy if exists "menu_images_anon_update_block" on storage.objects;
create policy "menu_images_anon_update_block"
  on storage.objects
  as restrictive
  for update
  to anon, authenticated
  using (bucket_id <> 'menu-images')
  with check (bucket_id <> 'menu-images');

-- DELETE — deny anon/authenticated from deleting objects in this bucket.
drop policy if exists "menu_images_anon_delete_block" on storage.objects;
create policy "menu_images_anon_delete_block"
  on storage.objects
  as restrictive
  for delete
  to anon, authenticated
  using (bucket_id <> 'menu-images');

-- 4. Reviewer note -----------------------------------------------------------
-- Orphaned-asset cleanup (deleting stored objects when an image is removed or
-- replaced before the item was saved) is intentionally DEFERRED to a later
-- phase. Removing an item's image in the UI clears the database image_url
-- reference but leaves the stored object in place. When implemented, cleanup
-- will be a service-role-only operation; no DELETE policy is granted to anon
-- or authenticated here.
--
-- These policies do NOT protect against a leaked service-role key (RLS is
-- bypassed by the service role). The service-role key must never enter the
-- browser bundle.
