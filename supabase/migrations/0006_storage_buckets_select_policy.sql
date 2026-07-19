-- storage.buckets has RLS enabled with zero policies (bucket creation and the
-- storage.objects policies for `media` were both done by hand, outside of
-- migrations -- neither ever added a policy on the buckets table itself).
-- With no SELECT policy, the Storage API can't resolve the bucket for an
-- authenticated request and returns "Bucket not found" even though the
-- bucket exists and the objects policies (media_public_read/upload/etc.) are
-- correct. Posting/uploading media was broken because of this.
create policy "buckets_read" on storage.buckets
  for select to authenticated, anon
  using (true);
