-- Phase 5b cleanup: notify_push_webhook() was doing two separate
-- `select ... from vault.decrypted_secrets` lookups (webhook secret, then
-- base URL) on every single trigger firing — i.e. on every message/like/
-- comment/pending-connection insert project-wide. Combines them into one
-- query. Same "0004 restricts 0003" precedent (a fix applied as its own
-- migration once the original was already committed/applied, rather than
-- rewriting migration history) — see CONVENTIONS.md.

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

  select
    max(decrypted_secret) filter (where name = 'push_webhook_secret'),
    max(decrypted_secret) filter (where name = 'edge_functions_base_url')
  into v_secret, v_base_url
  from vault.decrypted_secrets
  where name in ('push_webhook_secret', 'edge_functions_base_url');

  if v_secret is null or v_base_url is null then
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
