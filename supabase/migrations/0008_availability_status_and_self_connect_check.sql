-- Phase 3: availability status (multi-select) on profiles.
create type availability_status as enum (
  'looking_for_band',
  'available_for_session_work',
  'open_to_auditions',
  'forming_band',
  'open_to_collabs',
  'not_currently_looking'
);

alter table profiles
  add column availability_statuses availability_status[] not null default '{}';

-- No RLS change needed: profiles' existing public-read/owner-write policies
-- (profiles_read, profiles_update_own) apply to the whole row, this column
-- included -- confirmed against the live policy definitions on both
-- projects, not assumed.

-- Formalizes a CHECK constraint that was already applied directly to both
-- the production and test databases in a prior session but was never
-- captured in a migration file -- found via Step 1 confirmation for this
-- phase (queried pg_constraint on both projects and it was already present
-- as `no_self_connect` on both, identical definition). Guarded so this is
-- safe to run against a project that already has it (both current ones) as
-- well as a hypothetical fresh project that doesn't.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'no_self_connect'
  ) then
    alter table connections
      add constraint no_self_connect check (requester_id <> recipient_id);
  end if;
end $$;
