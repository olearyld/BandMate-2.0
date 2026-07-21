-- Phase 4a: geography foundation. Curated cities reference table + a
-- resolved-link column on profiles, ahead of Phase 4b's distance/radius
-- search. Table content itself (data, not schema) is seeded separately per
-- project via direct SQL, not in this file -- see CONVENTIONS.md.

create table cities (
  id uuid primary key default uuid_generate_v4(),
  city text not null,
  state text not null,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now(),
  unique (city, state)
);

alter table profiles
  add column matched_city_id uuid references cities(id) on delete set null;

alter table cities enable row level security;

-- Same public-read reference-data pattern as instruments/genres: readable by
-- any authenticated user, no insert/update/delete policy for any client
-- role -- this table is maintained by migrations (and direct seed SQL) only.
create policy "cities_read" on cities
  for select to authenticated using (true);
