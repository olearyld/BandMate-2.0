/**
 * RLS / security integration tests. These run against the real Bandmate Supabase
 * project (no branching available on the current plan — see CONVENTIONS.md).
 *
 * Supabase's free-tier auth email rate limit fires on every signUp() call
 * (even though we bypass confirmation right after), so this suite does NOT
 * sign up fresh users per run. Instead it uses three fixed fixture accounts
 * that self-bootstrap on first run (sign in; if that fails because the
 * account doesn't exist yet, sign up + confirm + create a profile, once) and
 * are reused (sign in only) on every subsequent run, local or CI.
 *
 * The project also rejects signups on domains without valid MX records
 * (fake/reserved TLDs like .dev or example.com get "email address invalid") —
 * fixture emails use a real, valid-MX domain (gmail.com) for this reason,
 * without needing a real mailbox behind them.
 *
 * A failure here means a policy mistake that would otherwise be invisible
 * until exploited — treat it as a stop-everything bug, not a normal test
 * failure.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { WebSocketLikeConstructor } from '@supabase/realtime-js';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { Database } from '../../src/lib/database.types';

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

const FIXTURES = {
  a: { email: 'bandmate.rls.fixture.a@gmail.com', username: 'rls_fixture_a' },
  b: { email: 'bandmate.rls.fixture.b@gmail.com', username: 'rls_fixture_b' },
  c: { email: 'bandmate.rls.fixture.c@gmail.com', username: 'rls_fixture_c' },
} as const;

function makeClient(): SupabaseClient<Database> {
  // Node 20 has no native WebSocket, and createClient() eagerly initializes the
  // Realtime client — supply `ws` as the transport so client creation doesn't throw.
  // These tests don't use Realtime at all, this is purely to satisfy init.
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as WebSocketLikeConstructor },
  });
}

/** Sign in to a fixture account, bootstrapping it (signUp once) if it doesn't exist yet. */
async function signInOrBootstrapFixture(
  client: SupabaseClient<Database>,
  fixture: { email: string; username: string }
): Promise<string> {
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
    email: fixture.email,
    password: PASSWORD,
  });
  if (!signInError && signInData.user) return signInData.user.id;

  const { data: signUpData, error: signUpError } = await client.auth.signUp({
    email: fixture.email,
    password: PASSWORD,
  });
  if (signUpError || !signUpData.user) {
    throw new Error(`fixture bootstrap signUp(${fixture.email}) failed: ${signUpError?.message}`);
  }
  const userId = signUpData.user.id;

  const { error: confirmError } = await client.rpc('dev_confirm_user_email', { user_id: userId });
  if (confirmError) {
    throw new Error(`fixture bootstrap confirm(${fixture.email}) failed: ${confirmError.message}`);
  }

  const { error: reSignInError } = await client.auth.signInWithPassword({
    email: fixture.email,
    password: PASSWORD,
  });
  if (reSignInError) {
    throw new Error(`fixture bootstrap signIn(${fixture.email}) failed: ${reSignInError.message}`);
  }

  const { error: profileError } = await client
    .from('profiles')
    .insert({ id: userId, username: fixture.username });
  // 23505 = unique violation — a concurrent run already created it, fine to ignore.
  if (profileError && (profileError as { code?: string }).code !== '23505') {
    throw new Error(`fixture bootstrap profile(${fixture.email}) failed: ${profileError.message}`);
  }

  return userId;
}

const READ_ANY_AUTHENTICATED_TABLES = [
  'profiles',
  'instruments',
  'genres',
  'profile_instruments',
  'profile_genres',
  'media_posts',
  'connections',
  'messages',
  'likes',
  'comments',
] as const;

describe('RLS policies', () => {
  let clientA: SupabaseClient<Database>;
  let clientB: SupabaseClient<Database>;
  let clientC: SupabaseClient<Database>;
  let anonClient: SupabaseClient<Database>;

  let userA: string;
  let userB: string;
  let userC: string;
  let postBId: string;
  let connectionId: string; // between B (requester) and C (recipient) — persists across runs
  let messageId: string; // from B to C
  let likeId: string; // by B, on B's post
  let commentId: string; // by B, on B's post

  beforeAll(async () => {
    clientA = makeClient();
    clientB = makeClient();
    clientC = makeClient();
    anonClient = makeClient();

    userA = await signInOrBootstrapFixture(clientA, FIXTURES.a);
    userB = await signInOrBootstrapFixture(clientB, FIXTURES.b);
    userC = await signInOrBootstrapFixture(clientC, FIXTURES.c);

    const { data: post, error: postErr } = await clientB
      .from('media_posts')
      .insert({ profile_id: userB, media_url: 'https://example.com/x.jpg', media_type: 'image' })
      .select('id')
      .single();
    if (postErr || !post) throw new Error(`media_post setup failed: ${postErr?.message}`);
    postBId = post.id;

    // connections has no DELETE policy and a unique(requester_id, recipient_id) constraint,
    // so it can't be recreated fresh every run like the other fixtures — reuse the same row.
    const { data: existingConn } = await clientB
      .from('connections')
      .select('id')
      .eq('requester_id', userB)
      .eq('recipient_id', userC)
      .maybeSingle();
    if (existingConn) {
      connectionId = existingConn.id;
    } else {
      const { data: conn, error: connErr } = await clientB
        .from('connections')
        .insert({ requester_id: userB, recipient_id: userC })
        .select('id')
        .single();
      if (connErr || !conn) throw new Error(`connection setup failed: ${connErr?.message}`);
      connectionId = conn.id;
    }

    // messages has no DELETE policy either — each run adds one row (harmless, no
    // uniqueness constraint to violate), so use a per-run marker instead of reusing.
    const { data: msg, error: msgErr } = await clientB
      .from('messages')
      .insert({ sender_id: userB, recipient_id: userC, content: `hello from RLS test run ${RUN_ID}` })
      .select('id')
      .single();
    if (msgErr || !msg) throw new Error(`message setup failed: ${msgErr?.message}`);
    messageId = msg.id;

    const { data: like, error: likeErr } = await clientB
      .from('likes')
      .insert({ post_id: postBId, user_id: userB })
      .select('id')
      .single();
    if (likeErr || !like) throw new Error(`like setup failed: ${likeErr?.message}`);
    likeId = like.id;

    const { data: comment, error: commentErr } = await clientB
      .from('comments')
      .insert({ post_id: postBId, user_id: userB, body: 'nice post' })
      .select('id')
      .single();
    if (commentErr || !comment) throw new Error(`comment setup failed: ${commentErr?.message}`);
    commentId = comment.id;
  });

  afterAll(async () => {
    // media_posts has a delete policy for its owner — clean it up (likes/comments
    // cascade with it). connections/messages have no delete policy at all, so they
    // aren't cleaned up; connections is reused next run, messages just accumulates.
    await clientB?.from('media_posts').delete().eq('id', postBId);
    // Defensive reset in case a bug ever let an unauthorized status update slip through.
    await clientC?.from('connections').update({ status: 'pending' }).eq('id', connectionId);

    await Promise.all([clientA?.auth.signOut(), clientB?.auth.signOut(), clientC?.auth.signOut()]);
  });

  // ---------------------------------------------------------------- profiles
  it("A cannot update B's profile", async () => {
    const { data } = await clientA.from('profiles').update({ bio: 'hacked' }).eq('id', userB).select();
    expect(data ?? []).toHaveLength(0);

    const { data: check } = await clientA.from('profiles').select('bio').eq('id', userB).single();
    expect(check?.bio).not.toBe('hacked');
  });

  it("A cannot delete B's profile", async () => {
    await clientA.from('profiles').delete().eq('id', userB);
    const { data } = await clientA.from('profiles').select('id').eq('id', userB).maybeSingle();
    expect(data).toBeTruthy();
  });

  // ------------------------------------------------------------- media_posts
  it("A cannot update B's media_post", async () => {
    const { data } = await clientA
      .from('media_posts')
      .update({ caption: 'hacked' })
      .eq('id', postBId)
      .select();
    expect(data ?? []).toHaveLength(0);

    const { data: check } = await clientA.from('media_posts').select('caption').eq('id', postBId).single();
    expect(check?.caption).not.toBe('hacked');
  });

  it("A cannot delete B's media_post", async () => {
    await clientA.from('media_posts').delete().eq('id', postBId);
    const { data } = await clientA.from('media_posts').select('id').eq('id', postBId).maybeSingle();
    expect(data).toBeTruthy();
  });

  // ------------------------------------------------------------- connections
  it('A (uninvolved) cannot read the B<->C connection', async () => {
    const { data } = await clientA.from('connections').select('id').eq('id', connectionId).maybeSingle();
    expect(data).toBeNull();
  });

  it('A (uninvolved) cannot update the B<->C connection status', async () => {
    await clientA.from('connections').update({ status: 'accepted' }).eq('id', connectionId);
    const { data: check } = await clientC.from('connections').select('status').eq('id', connectionId).single();
    expect(check?.status).toBe('pending');
  });

  it('B (requester) cannot update the connection status — only the recipient can', async () => {
    await clientB.from('connections').update({ status: 'accepted' }).eq('id', connectionId);
    const { data: check } = await clientC.from('connections').select('status').eq('id', connectionId).single();
    expect(check?.status).toBe('pending');
  });

  it('A (uninvolved) cannot delete the B<->C connection', async () => {
    await clientA.from('connections').delete().eq('id', connectionId);
    const { data } = await clientC.from('connections').select('id').eq('id', connectionId).maybeSingle();
    expect(data).toBeTruthy();
  });

  // ---------------------------------------------------------------- messages
  it('A (uninvolved) cannot read the B->C message', async () => {
    const { data } = await clientA.from('messages').select('id').eq('id', messageId).maybeSingle();
    expect(data).toBeNull();
  });

  it('A (uninvolved) cannot delete the B->C message', async () => {
    await clientA.from('messages').delete().eq('id', messageId);
    const { data } = await clientC.from('messages').select('id').eq('id', messageId).maybeSingle();
    expect(data).toBeTruthy();
  });

  // ------------------------------------------------------------ likes / comments
  it("A CAN read B's like and comment (public-read pattern, same as other tables)", async () => {
    const { data: likeData } = await clientA.from('likes').select('id').eq('id', likeId).maybeSingle();
    expect(likeData).toBeTruthy();

    const { data: commentData } = await clientA.from('comments').select('id').eq('id', commentId).maybeSingle();
    expect(commentData).toBeTruthy();
  });

  it("A cannot delete B's like", async () => {
    await clientA.from('likes').delete().eq('id', likeId);
    const { data } = await clientA.from('likes').select('id').eq('id', likeId).maybeSingle();
    expect(data).toBeTruthy();
  });

  it("A cannot delete B's comment", async () => {
    await clientA.from('comments').delete().eq('id', commentId);
    const { data } = await clientA.from('comments').select('id').eq('id', commentId).maybeSingle();
    expect(data).toBeTruthy();
  });

  // ----------------------------------------------------------- unauthenticated
  it.each(READ_ANY_AUTHENTICATED_TABLES)('unauthenticated SELECT on %s returns no rows', async (table) => {
    const { data, error } = await anonClient.from(table).select('*').limit(1);
    if (error) {
      expect(error).toBeTruthy();
    } else {
      expect(data).toEqual([]);
    }
  });

  it('unauthenticated INSERT into profiles is rejected', async () => {
    const { error } = await anonClient
      .from('profiles')
      .insert({ id: randomUUID(), username: `rls_test_anon_${RUN_ID}` });
    expect(error).toBeTruthy();
  });

  it('unauthenticated INSERT into media_posts is rejected', async () => {
    const { error } = await anonClient
      .from('media_posts')
      .insert({ profile_id: userB, media_url: 'https://example.com/y.jpg', media_type: 'image' });
    expect(error).toBeTruthy();
  });

  it('unauthenticated INSERT into likes is rejected', async () => {
    const { error } = await anonClient.from('likes').insert({ post_id: postBId, user_id: userB });
    expect(error).toBeTruthy();
  });
});
