-- Restrict dev_confirm_user_email, which was callable by ANY holder of the
-- anon key with ANY user_id — the __DEV__ check in SignUpScreen.tsx is
-- client-side only and provides no real protection.
--
-- Why this can't simply require `authenticated` / auth.uid(): every real and
-- test call site (SignUpScreen.tsx, rls.test.ts, signup-onboarding.test.ts)
-- calls this immediately after auth.signUp() and BEFORE
-- auth.signInWithPassword() — at that point email confirmation is still
-- required for login, so there is no session yet and the caller is
-- necessarily the `anon` role. Restricting to `authenticated` would break
-- the dev bypass this function exists for.
--
-- Mitigation instead: only ever confirms a row that is BOTH still
-- unconfirmed AND was created within the last 5 minutes — narrows this from
-- "confirm any account, ever" to "rush-confirm an account that was just
-- created", the only thing the dev flow actually needs. auth.users.id is a
-- random UUID with no public read access pre-auth, so abusing this also
-- requires already knowing a specific just-created user's id.
--
-- This is a mitigation, not a full fix — dev_confirm_user_email should be
-- removed entirely once real email confirmation ships (see CONVENTIONS.md).
create or replace function public.dev_confirm_user_email(user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'auth', 'public'
as $function$
begin
  update auth.users
  set email_confirmed_at = now()
  where id = user_id
    and email_confirmed_at is null
    and created_at > now() - interval '5 minutes';
end;
$function$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation, and
-- Supabase's project defaults additionally grant anon/authenticated/
-- service_role explicitly on top of that — between the two, this was
-- callable by anon with no ownership check and no rate limit. Lock the
-- grants down to exactly what's needed:
--   - `anon` stays: the real dev flow has no session yet when it calls this.
--   - `authenticated` is dropped: no real or test call site ever calls this
--     while already signed in.
--   - PUBLIC is revoked outright rather than relying on anon/authenticated
--     being the only members that matter.
revoke execute on function public.dev_confirm_user_email(uuid) from public;
revoke execute on function public.dev_confirm_user_email(uuid) from authenticated;
grant execute on function public.dev_confirm_user_email(uuid) to anon;
