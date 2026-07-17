/**
 * Critical-path integration test: signup -> onboarding completion -> profile.
 * Data-layer only (no UI automation) — confirms a fresh signup produces a
 * correctly-linked profiles/profile_instruments/profile_genres row, matching
 * exactly what Step4Media.tsx writes when onboarding completes.
 *
 * Unlike the RLS suite, this test's entire point is exercising the real
 * signUp() call, so it can't be redesigned around fixed fixture accounts —
 * it inherently uses one signup per run. Supabase's auth email rate limit is
 * strict (observed as tight as ~1/hour on this project's free tier), so this
 * test WILL start failing on rate-limit grounds if run too frequently — that
 * is an expected, disclosed limitation of testing a live signup flow, not a
 * bug in the app. See CONVENTIONS.md.
 *
 * This also can't clean up its own auth.users row afterward (no service-role
 * key available client-side) — the created test account persists. Documented
 * tech debt; periodic manual cleanup needed, see CONVENTIONS.md.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { WebSocketLikeConstructor } from '@supabase/realtime-js';
import WebSocket from 'ws';
import type { Database } from '../../src/lib/database.types';
import type { ExperienceLevel, FullProfile } from '../../src/lib/types';

jest.setTimeout(30000);

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set. ' +
      'Integration tests need a real .env — see jest.setup.js.'
  );
}

const PASSWORD = 'BandmateTest!23456';
const RUN_ID = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const EMAIL = `bandmate.critpath.${RUN_ID}@gmail.com`;
const USERNAME = `critpath_${RUN_ID}`;

function makeClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as WebSocketLikeConstructor },
  });
}

it('a fresh signup produces a correctly-linked profile with instrument/genre rows', async () => {
  const client = makeClient();

  // 1. Sign up (exactly what SignUpScreen.tsx does).
  const { data: signUpData, error: signUpError } = await client.auth.signUp({
    email: EMAIL,
    password: PASSWORD,
  });
  expect(signUpError).toBeNull();
  expect(signUpData.user).toBeTruthy();
  const userId = signUpData.user!.id;

  // 2. Dev-only email confirmation bypass (same RPC SignUpScreen.tsx uses in __DEV__).
  const { error: confirmError } = await client.rpc('dev_confirm_user_email', { user_id: userId });
  expect(confirmError).toBeNull();

  const { error: signInError } = await client.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  expect(signInError).toBeNull();

  // 3. Look up two real instruments/genres to link, matching onboarding Steps 2/3.
  const { data: instruments, error: instrLookupError } = await client
    .from('instruments')
    .select('id, name')
    .order('id')
    .limit(2);
  expect(instrLookupError).toBeNull();
  expect(instruments).toHaveLength(2);

  const { data: genres, error: genreLookupError } = await client
    .from('genres')
    .select('id, name')
    .order('id')
    .limit(2);
  expect(genreLookupError).toBeNull();
  expect(genres).toHaveLength(2);

  // 4. Onboarding completion — exactly what Step4Media.tsx's handleSave() writes.
  const { error: profileError } = await client.from('profiles').insert({
    id: userId,
    username: USERNAME,
    display_name: 'Critical Path Test',
    location_city: 'Austin',
    location_state: 'TX',
    bio: 'Created by the signup -> onboarding critical-path test.',
  });
  expect(profileError).toBeNull();

  const instrumentRows = instruments!.map((inst) => ({
    profile_id: userId,
    instrument_id: inst.id,
    skill_level: 'intermediate' as ExperienceLevel,
  }));
  const { error: instrInsertError } = await client.from('profile_instruments').insert(instrumentRows);
  expect(instrInsertError).toBeNull();

  const genreRows = genres!.map((genre) => ({ profile_id: userId, genre_id: genre.id }));
  const { error: genreInsertError } = await client.from('profile_genres').insert(genreRows);
  expect(genreInsertError).toBeNull();

  // 5. Confirm the data ends up correctly linked — the same joined shape
  // MyProfileScreen/PublicProfileScreen query (FullProfile).
  const { data: fullProfile, error: fetchError } = await client
    .from('profiles')
    .select(
      `
      *,
      profile_instruments ( skill_level, instruments ( id, name ) ),
      profile_genres ( genre_id, genres ( id, name ) )
    `
    )
    .eq('id', userId)
    .single()
    .overrideTypes<FullProfile, { merge: false }>();

  expect(fetchError).toBeNull();
  expect(fullProfile?.username).toBe(USERNAME);
  expect(fullProfile?.display_name).toBe('Critical Path Test');

  const linkedInstrumentIds = (fullProfile?.profile_instruments ?? [])
    .map((pi) => pi.instruments.id)
    .sort();
  expect(linkedInstrumentIds).toEqual(instruments!.map((i) => i.id).sort());
  for (const pi of fullProfile?.profile_instruments ?? []) {
    expect(pi.skill_level).toBe('intermediate');
  }

  const linkedGenreIds = (fullProfile?.profile_genres ?? []).map((pg) => pg.genres.id).sort();
  expect(linkedGenreIds).toEqual(genres!.map((g) => g.id).sort());

  // 6. appState resolution (AppContext) depends on this exact query succeeding
  // and returning a row — confirm it does, which is what flips 'onboarding' -> 'authenticated'.
  const { data: appStateCheck, error: appStateError } = await client
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();
  expect(appStateError).toBeNull();
  expect(appStateCheck).toBeTruthy();

  await client.auth.signOut();
});
