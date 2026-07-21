-- Phase 5b: push notifications.
-- Pattern: AFTER INSERT trigger -> pg_net async HTTP call -> Edge Function
-- (send-push-notification) -> Expo Push API. First use of pg_net and Edge
-- Functions in this codebase (see CONVENTIONS.md).
--
-- This file is fully project-agnostic (byte-identical when applied to both
-- projects) — the one genuinely per-project literal (each project's own
-- Edge Functions base URL) is seeded into Vault via a separate direct-SQL
-- statement per project, same "real per-project value, not the tracked
-- migration" pattern already used for cities' row data (see Data model).

create extension if not exists pg_net;

create table public.push_tokens (
  id uuid primary key default extensions.uuid_generate_v4(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, expo_push_token)
);

alter table public.push_tokens enable row level security;

create policy push_tokens_owner_all on public.push_tokens
  for all
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create trigger push_tokens_updated_at
  before update on public.push_tokens
  for each row execute function public.update_updated_at();

-- A random secret pg_net triggers send on every call, and the Edge Function
-- reads independently (via its own service-role client) to prove a request
-- genuinely came from our own trigger rather than a public POST to the
-- function's URL. Generated server-side via gen_random_bytes — no plaintext
-- secret value is ever written to this file or seen by whoever applies it.
-- Idempotent: guarded so re-running this migration never creates a second,
-- different secret that would desync the trigger from what the function reads.
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'push_webhook_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'push_webhook_secret',
      'Shared secret pg_net triggers send to send-push-notification to prove the call originated from our own database trigger, not a public POST to the function URL.'
    );
  end if;
end $$;

-- Lets the Edge Function's service-role client read the secret above without
-- exposing the vault schema itself via PostgREST (which only serves `public`).
-- Locked to service_role only — same restriction pattern as
-- dev_confirm_user_email / guard_message_read_update (Phase 3 / 5a).
create or replace function public.get_push_webhook_secret()
returns text
language sql
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'push_webhook_secret';
$$;

revoke all on function public.get_push_webhook_secret() from public, anon, authenticated;
grant execute on function public.get_push_webhook_secret() to service_role;

-- One shared trigger function for all four notification sources rather than
-- four near-identical copies of the same "build a payload, send it via
-- net.http_post" logic — branches on TG_TABLE_NAME. Also where the actor-
-- exclusion check lives: verified directly against live pg_policies (not
-- assumed) that likes_insert_own/comments_insert_own only check
-- user_id = auth.uid(), nothing about the post's own owner — so a user CAN
-- currently like/comment on their own post, and this defensive check is
-- load-bearing, not just belt-and-suspenders. See CONVENTIONS.md.
create or replace function public.notify_push_webhook()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_base_url text;
  v_actor_id uuid;
  v_recipient_id uuid;
begin
  if TG_TABLE_NAME = 'messages' then
    v_actor_id := NEW.sender_id;
    v_recipient_id := NEW.recipient_id;
  elsif TG_TABLE_NAME = 'connections' then
    v_actor_id := NEW.requester_id;
    v_recipient_id := NEW.recipient_id;
  elsif TG_TABLE_NAME = 'likes' then
    v_actor_id := NEW.user_id;
    select profile_id into v_recipient_id from public.media_posts where id = NEW.post_id;
  elsif TG_TABLE_NAME = 'comments' then
    v_actor_id := NEW.user_id;
    select profile_id into v_recipient_id from public.media_posts where id = NEW.post_id;
  else
    return NEW;
  end if;

  if v_recipient_id is null or v_actor_id = v_recipient_id then
    return NEW;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_webhook_secret';
  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'edge_functions_base_url';

  if v_secret is null or v_base_url is null then
    -- Not yet configured on this project (e.g. a fresh project before the
    -- per-project Vault seed step) — skip rather than error the triggering
    -- insert itself.
    return NEW;
  end if;

  perform net.http_post(
    url := v_base_url || '/send-push-notification',
    body := jsonb_build_object(
      'table', TG_TABLE_NAME,
      'row_id', NEW.id,
      'actor_id', v_actor_id,
      'recipient_id', v_recipient_id
    ),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    timeout_milliseconds := 5000
  );

  return NEW;
end;
$$;

revoke all on function public.notify_push_webhook() from public, anon, authenticated;

create trigger messages_notify_push
  after insert on public.messages
  for each row execute function public.notify_push_webhook();

create trigger connections_notify_push
  after insert on public.connections
  for each row when (NEW.status = 'pending')
  execute function public.notify_push_webhook();

create trigger likes_notify_push
  after insert on public.likes
  for each row execute function public.notify_push_webhook();

create trigger comments_notify_push
  after insert on public.comments
  for each row execute function public.notify_push_webhook();
