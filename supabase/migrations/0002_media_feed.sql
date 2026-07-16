-- ============================================================
-- Media feed: extend media_posts, add likes and comments
-- ============================================================

alter table media_posts
  add column tags text[],
  add column thumbnail_url text,
  add column status text not null default 'ready';

-- Likes
create table likes (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references media_posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

-- Comments
create table comments (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references media_posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table likes enable row level security;
alter table comments enable row level security;

-- Likes: authenticated read; owner insert/delete
create policy "likes_read" on likes
  for select to authenticated using (true);

create policy "likes_insert_own" on likes
  for insert to authenticated with check (user_id = auth.uid());

create policy "likes_delete_own" on likes
  for delete to authenticated using (user_id = auth.uid());

-- Comments: authenticated read; owner insert/delete
create policy "comments_read" on comments
  for select to authenticated using (true);

create policy "comments_insert_own" on comments
  for insert to authenticated with check (user_id = auth.uid());

create policy "comments_delete_own" on comments
  for delete to authenticated using (user_id = auth.uid());
