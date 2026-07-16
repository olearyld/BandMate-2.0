-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Enums
create type experience_level as enum ('beginner', 'intermediate', 'advanced', 'professional');
create type media_type as enum ('image', 'audio', 'video');
create type connection_status as enum ('pending', 'accepted', 'declined');

-- Profiles
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  bio text,
  location_city text,
  location_state text,
  experience_level experience_level,
  avatar_url text,
  intro_media_url text,
  intro_media_type media_type,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Instruments
create table instruments (
  id serial primary key,
  name text unique not null
);

insert into instruments (name) values
  ('Guitar'),
  ('Bass Guitar'),
  ('Drums'),
  ('Vocals'),
  ('Piano'),
  ('Keyboard'),
  ('Violin'),
  ('Cello'),
  ('Saxophone'),
  ('Trumpet'),
  ('Flute'),
  ('Clarinet'),
  ('Trombone'),
  ('Ukulele'),
  ('Banjo'),
  ('Mandolin'),
  ('Harp'),
  ('Synthesizer'),
  ('DJ / Turntables'),
  ('Percussion');

-- Genres
create table genres (
  id serial primary key,
  name text unique not null
);

insert into genres (name) values
  ('Rock'),
  ('Jazz'),
  ('Hip-Hop'),
  ('Pop'),
  ('Blues'),
  ('Country'),
  ('Classical'),
  ('Electronic'),
  ('R&B / Soul'),
  ('Folk'),
  ('Metal'),
  ('Punk'),
  ('Reggae'),
  ('Latin'),
  ('Indie');

-- Profile-Instruments join
create table profile_instruments (
  profile_id uuid not null references profiles(id) on delete cascade,
  instrument_id integer not null references instruments(id) on delete cascade,
  skill_level experience_level not null default 'beginner',
  primary key (profile_id, instrument_id)
);

-- Profile-Genres join
create table profile_genres (
  profile_id uuid not null references profiles(id) on delete cascade,
  genre_id integer not null references genres(id) on delete cascade,
  primary key (profile_id, genre_id)
);

-- Media posts
create table media_posts (
  id uuid primary key default uuid_generate_v4(),
  profile_id uuid not null references profiles(id) on delete cascade,
  media_url text not null,
  media_type media_type not null,
  caption text,
  created_at timestamptz not null default now()
);

-- Connections
create table connections (
  id uuid primary key default uuid_generate_v4(),
  requester_id uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  status connection_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint no_self_connect check (requester_id <> recipient_id),
  unique (requester_id, recipient_id)
);

-- Messages
create table messages (
  id uuid primary key default uuid_generate_v4(),
  sender_id uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  content text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- Updated_at trigger function
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on profiles
  for each row execute function update_updated_at();

create trigger connections_updated_at
  before update on connections
  for each row execute function update_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================

alter table profiles enable row level security;
alter table instruments enable row level security;
alter table genres enable row level security;
alter table profile_instruments enable row level security;
alter table profile_genres enable row level security;
alter table media_posts enable row level security;
alter table connections enable row level security;
alter table messages enable row level security;

-- Profiles: authenticated users can read; owner can insert/update
create policy "profiles_read" on profiles
  for select to authenticated using (true);

create policy "profiles_insert_own" on profiles
  for insert to authenticated with check (id = auth.uid());

create policy "profiles_update_own" on profiles
  for update to authenticated using (id = auth.uid());

-- Instruments & genres: public read (reference data)
create policy "instruments_read" on instruments
  for select to authenticated using (true);

create policy "genres_read" on genres
  for select to authenticated using (true);

-- Profile instruments: authenticated read; owner insert/delete
create policy "profile_instruments_read" on profile_instruments
  for select to authenticated using (true);

create policy "profile_instruments_insert_own" on profile_instruments
  for insert to authenticated with check (profile_id = auth.uid());

create policy "profile_instruments_delete_own" on profile_instruments
  for delete to authenticated using (profile_id = auth.uid());

-- Profile genres: authenticated read; owner insert/delete
create policy "profile_genres_read" on profile_genres
  for select to authenticated using (true);

create policy "profile_genres_insert_own" on profile_genres
  for insert to authenticated with check (profile_id = auth.uid());

create policy "profile_genres_delete_own" on profile_genres
  for delete to authenticated using (profile_id = auth.uid());

-- Media posts: authenticated read; owner insert/update/delete
create policy "media_posts_read" on media_posts
  for select to authenticated using (true);

create policy "media_posts_insert_own" on media_posts
  for insert to authenticated with check (profile_id = auth.uid());

create policy "media_posts_update_own" on media_posts
  for update to authenticated using (profile_id = auth.uid());

create policy "media_posts_delete_own" on media_posts
  for delete to authenticated using (profile_id = auth.uid());

-- Connections: read own rows; requester inserts; recipient updates status
create policy "connections_read_own" on connections
  for select to authenticated
  using (requester_id = auth.uid() or recipient_id = auth.uid());

create policy "connections_insert_requester" on connections
  for insert to authenticated with check (requester_id = auth.uid());

create policy "connections_update_recipient" on connections
  for update to authenticated using (recipient_id = auth.uid());

-- Messages: read/insert only for sender or recipient
create policy "messages_read_own" on messages
  for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());

create policy "messages_insert_own" on messages
  for insert to authenticated with check (sender_id = auth.uid());
