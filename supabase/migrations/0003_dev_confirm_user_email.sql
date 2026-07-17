-- Dev-only helper: bypasses email confirmation so signup can proceed straight
-- to onboarding without a real inbox. Used by SignUpScreen.tsx (gated behind
-- __DEV__) and by the integration test suite's fixture bootstrap.
--
-- This function already existed on the production project (created directly,
-- not via a tracked migration) — this migration file closes that gap so the
-- schema is fully reproducible from supabase/migrations/ alone, and applies
-- it to any new environment (e.g. the dedicated test project) going forward.
create or replace function public.dev_confirm_user_email(user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'auth', 'public'
as $function$
begin
  update auth.users
  set email_confirmed_at = now()
  where id = user_id and email_confirmed_at is null;
end;
$function$;
