-- ============================================================
-- Phase 6a: Profile highlight reel
-- Pin up to 6 existing media_posts rows to a profile, in order.
-- ============================================================

create table profile_highlights (
  profile_id uuid not null references profiles(id) on delete cascade,
  post_id uuid not null references media_posts(id) on delete cascade,
  position smallint not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, post_id),
  unique (profile_id, position)
);

alter table profile_highlights enable row level security;

-- Same audience as media_posts: any authenticated user can view a profile's highlights.
create policy "profile_highlights_read" on profile_highlights
  for select to authenticated using (true);

-- Owner can only pin their own posts to their own profile.
create policy "profile_highlights_insert_own" on profile_highlights
  for insert to authenticated with check (
    profile_id = auth.uid()
    and exists (
      select 1 from media_posts mp
      where mp.id = post_id and mp.profile_id = auth.uid()
    )
  );

create policy "profile_highlights_delete_own" on profile_highlights
  for delete to authenticated using (profile_id = auth.uid());

-- No update policy: position changes go through reorder_profile_highlights()
-- below (delete-and-reinsert in one transaction), never an in-place UPDATE.
-- The unique(profile_id, position) constraint would otherwise transiently
-- collide on a swap; delete-and-reinsert sidesteps that entirely.

-- ============================================================
-- Cap enforcement: a BEFORE INSERT trigger, since a plain CHECK
-- constraint can't count sibling rows.
-- ============================================================

create or replace function enforce_highlight_cap()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if (select count(*) from profile_highlights where profile_id = new.profile_id) >= 6 then
    raise exception 'Highlight cap of 6 reached for this profile';
  end if;
  return new;
end;
$$;

create trigger profile_highlights_cap
  before insert on profile_highlights
  for each row execute function enforce_highlight_cap();

-- security invoker (not definer, despite the phase spec's literal SQL):
-- profile_highlights_read is a public-read policy (any authenticated user,
-- same as media_posts), so counting sibling rows needs no elevated
-- privilege to be accurate -- same reasoning discover_profiles already
-- established. Trigger invocation itself needs no EXECUTE grant (Postgres
-- calls trigger functions directly), so this only blocks direct RPC
-- invocation -- applied proactively, the same class of issue
-- dev_confirm_user_email and guard_message_read_update were both flagged
-- for only after the fact.
revoke execute on function enforce_highlight_cap() from public, anon, authenticated;

-- ============================================================
-- Reorder: atomic delete-and-reinsert of a profile's full highlight
-- list in one transaction, needed because updating `position` for
-- multiple rows in place can transiently collide with the
-- unique(profile_id, position) constraint on a swap.
-- ============================================================

create or replace function reorder_profile_highlights(p_post_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
begin
  if array_length(p_post_ids, 1) is null then
    delete from profile_highlights where profile_id = v_profile_id;
    return;
  end if;

  if array_length(p_post_ids, 1) > 6 then
    raise exception 'Highlight cap of 6 reached for this profile';
  end if;

  if array_length(p_post_ids, 1) <> (select count(*) from (select distinct unnest(p_post_ids)) d) then
    raise exception 'Duplicate post ids in reorder list';
  end if;

  delete from profile_highlights where profile_id = v_profile_id;

  insert into profile_highlights (profile_id, post_id, position)
  select v_profile_id, post_id, ord - 1
  from unnest(p_post_ids) with ordinality as t(post_id, ord);
end;
$$;

revoke execute on function reorder_profile_highlights(uuid[]) from public;
revoke execute on function reorder_profile_highlights(uuid[]) from anon;
grant execute on function reorder_profile_highlights(uuid[]) to authenticated;
