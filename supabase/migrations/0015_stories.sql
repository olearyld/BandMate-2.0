-- ============================================================
-- Phase 7: Stories -- 24-hour short-lived posts.
-- Query-time expiry (expires_at > now()), no pg_cron job. Expired rows
-- are left to accumulate, same accepted tradeoff as like/comment counts
-- and cities' missing spatial index -- see CONVENTIONS.md.
-- ============================================================

create table stories (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references profiles(id) on delete cascade,
  media_url text not null,
  media_type media_type not null check (media_type in ('image', 'video')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

alter table stories enable row level security;

-- Same public-read audience as media_posts, but with the expiry check baked
-- directly into the policy itself -- an expired story can never be fetched
-- regardless of any client-side bug, not just filtered out by a WHERE clause
-- the client happens to add.
create policy "stories_read" on stories
  for select to authenticated using (expires_at > now());

-- expires_at is bounded, not just profile_id -- without this, a client could
-- POST an arbitrary far-future expires_at and defeat the whole 24-hour
-- design (caught before committing, not by the advisor -- see CONVENTIONS.md).
-- now() is stable within a transaction, so this exactly matches the column's
-- own default (now() + 24h) when the client omits expires_at.
create policy "stories_insert_own" on stories
  for insert to authenticated with check (
    profile_id = auth.uid()
    and expires_at <= now() + interval '24 hours'
  );

create policy "stories_delete_own" on stories
  for delete to authenticated using (profile_id = auth.uid());

-- No update policy: nothing about a story (media, type, expiry) is ever
-- edited after posting -- same "no mutable surface" reasoning as
-- profile_highlights, for a different underlying reason.
