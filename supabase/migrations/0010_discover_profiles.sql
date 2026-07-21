-- Phase 4b: discovery. Enables earthdistance/cube for radius math (available
-- but not installed on either project as of Phase 4a -- see CONVENTIONS.md)
-- and adds the discover_profiles RPC that backs the Discover tab.
--
-- No spatial index on cities yet -- the table is still small (~10 rows) at
-- this scale, same "fine for now" call already made for like/comment counts
-- elsewhere in this codebase. Revisit if cities grows large.
create extension if not exists cube with schema extensions;
create extension if not exists earthdistance with schema extensions;

-- instrument_ids/genre_ids are integer[], not uuid[] -- instruments.id and
-- genres.id are serial integers (confirmed against database.types.ts before
-- writing this, per the phase spec's own instruction not to guess).
create or replace function discover_profiles(
  instrument_ids integer[] default '{}'::integer[],
  genre_ids integer[] default '{}'::integer[],
  radius_miles numeric default null,
  page_limit int default 20,
  page_offset int default 0
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  location_city text,
  location_state text,
  instruments jsonb,
  genres jsonb,
  distance_miles numeric
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  caller_id uuid := auth.uid();
  caller_lat double precision;
  caller_lng double precision;
  -- Effective radius: nulled out below if the caller has no matched_city_id,
  -- so the client can pass radius_miles without erroring -- the UI is the
  -- primary guard for this (radius control disabled without a matched
  -- city), this is defense-in-depth, not the main mechanism.
  effective_radius numeric := radius_miles;
begin
  if effective_radius is not null then
    select c.lat, c.lng into caller_lat, caller_lng
    from profiles p
    join cities c on c.id = p.matched_city_id
    where p.id = caller_id;

    if caller_lat is null then
      effective_radius := null;
    end if;
  end if;

  return query
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.location_city,
    p.location_state,
    coalesce(pi_agg.instruments, '[]'::jsonb) as instruments,
    coalesce(pg_agg.genres, '[]'::jsonb) as genres,
    case
      when effective_radius is not null and pc.lat is not null
        then (point(pc.lng, pc.lat) <@> point(caller_lng, caller_lat))::numeric
      else null
    end as distance_miles
  from profiles p
  left join cities pc on pc.id = p.matched_city_id
  left join lateral (
    select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'skill_level', pi.skill_level)) as instruments
    from profile_instruments pi
    join instruments i on i.id = pi.instrument_id
    where pi.profile_id = p.id
  ) pi_agg on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name)) as genres
    from profile_genres pg
    join genres g on g.id = pg.genre_id
    where pg.profile_id = p.id
  ) pg_agg on true
  where p.id <> caller_id
    -- Instrument filter: OR within the category, empty array = unfiltered.
    and (
      cardinality(instrument_ids) = 0
      or exists (
        select 1 from profile_instruments pi2
        where pi2.profile_id = p.id and pi2.instrument_id = any(instrument_ids)
      )
    )
    -- Genre filter: same OR-within pattern. Both non-empty = AND across
    -- categories, since these are two independent WHERE clauses.
    and (
      cardinality(genre_ids) = 0
      or exists (
        select 1 from profile_genres pg2
        where pg2.profile_id = p.id and pg2.genre_id = any(genre_ids)
      )
    )
    -- Radius filter: candidates with no matched_city_id are excluded only
    -- when a radius filter is actually active -- they still appear in the
    -- unfiltered case.
    and (
      effective_radius is null
      or (
        pc.lat is not null
        and (point(pc.lng, pc.lat) <@> point(caller_lng, caller_lat)) <= effective_radius
      )
    )
  -- id as a tiebreaker: created_at alone isn't a strict total order (batch
  -- inserts, e.g. scripts/seed.js, can give many rows the identical
  -- timestamp), and without one, LIMIT/OFFSET pagination across separate
  -- calls isn't guaranteed stable when ties exist -- caught by this
  -- migration's own integration test, not a hypothetical.
  order by p.created_at desc, p.id asc
  limit page_limit offset page_offset;
end;
$$;

-- Every underlying table here is already authenticated-readable per the RLS
-- pattern in CONVENTIONS.md, so security invoker needs no elevated grant --
-- unlike dev_confirm_user_email. Restricted to authenticated (not anon)
-- since it resolves auth.uid() internally and is meaningless without a
-- session; anon would just get RLS-filtered empty results anyway, but this
-- makes the intent explicit rather than relying on that side effect.
revoke all on function discover_profiles(integer[], integer[], numeric, int, int) from public;
grant execute on function discover_profiles(integer[], integer[], numeric, int, int) to authenticated;
