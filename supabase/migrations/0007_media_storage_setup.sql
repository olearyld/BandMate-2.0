-- Formalizes the `media` storage bucket + its policies as a migration so
-- production and the test project can be provisioned identically instead of
-- drifting via manual dashboard setup (which is how prod ended up missing
-- the storage.buckets SELECT policy fixed in 0006). Written idempotently
-- (on conflict / drop-if-exists) so it's safe to re-run against a project
-- that already has some or all of this from prior manual setup.

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

drop policy if exists "buckets_read" on storage.buckets;
create policy "buckets_read" on storage.buckets
  for select to authenticated, anon
  using (true);

drop policy if exists "media_public_read" on storage.objects;
create policy "media_public_read" on storage.objects
  for select to public
  using (bucket_id = 'media');

drop policy if exists "media_user_upload" on storage.objects;
create policy "media_user_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media_user_update" on storage.objects;
create policy "media_user_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "media_user_delete" on storage.objects;
create policy "media_user_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
