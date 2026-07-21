-- Phase 5a: messaging.
-- 1. Gate message inserts on an accepted connection between sender/recipient.
-- 2. Let the recipient mark messages read, with a trigger guard so that UPDATE
--    surface can't be used to tamper with content/sender_id/recipient_id/created_at
--    or to un-set/re-set read_at once it's already non-null.
-- 3. Enable Realtime (Postgres Changes) on messages — the first real use of
--    Realtime in this codebase.

drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own" on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.connections c
      where c.status = 'accepted'
        and (
          (c.requester_id = messages.sender_id and c.recipient_id = messages.recipient_id)
          or (c.recipient_id = messages.sender_id and c.requester_id = messages.recipient_id)
        )
    )
  );

create policy "messages_update_read" on public.messages
  for update to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

create or replace function public.guard_message_read_update()
returns trigger as $$
begin
  if new.content is distinct from old.content
     or new.sender_id is distinct from old.sender_id
     or new.recipient_id is distinct from old.recipient_id
     or new.created_at is distinct from old.created_at then
    raise exception 'only read_at may be updated on messages';
  end if;
  if old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception 'read_at cannot be changed once set';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger messages_guard_read_update
  before update on public.messages
  for each row execute function public.guard_message_read_update();

-- Trigger invocation doesn't need EXECUTE privileges (Postgres calls trigger
-- functions directly, bypassing normal call-permission checks) — this only
-- blocks the function from being called directly as an RPC, same restriction
-- already applied to dev_confirm_user_email for the same class of issue
-- (anon/authenticated could otherwise POST /rest/v1/rpc/guard_message_read_update).
revoke execute on function public.guard_message_read_update() from public, anon, authenticated;

alter publication supabase_realtime add table public.messages;
