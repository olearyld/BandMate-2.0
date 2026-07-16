/**
 * RLS / security integration tests. These run against the real Bandmate Supabase
 * project (no branching available on the current plan — see CONVENTIONS.md).
 * Every account created here is disposable: unique per test run, cleaned up by
 * deleting from auth.users (cascades to profiles/media_posts/etc.) after the run.
 *
 * A failure here means a policy mistake that would otherwise be invisible until
 * exploited — treat it as a stop-everything bug, not a normal test failure.
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

const RUN_ID = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const PASSWORD = 'BandmateTest!23456';

function makeClient(): SupabaseClient<Database> {
  // Node 20 has no native WebSocket, and createClient() eagerly initializes the
  // Realtime client — supply `ws` as the transport so client creation doesn't throw.
  // These tests don't use Realtime at all, this is purely to satisfy init.
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as WebSocketLikeConstructor },
  });
}

async function signUpAndConfirm(client: SupabaseClient<Database>, label: string) {
  const email = `bandmate-test-${RUN_ID}-${label}@bandmate-rls-tests.dev`;
  const { data, error } = await client.auth.signUp({ email, password: PASSWORD });
  if (error) throw new Error(`signUp(${label}) failed: ${error.message}`);
  const userId = data.user!.id;

  const { error: confirmError } = await client.rpc('dev_confirm_user_email', { user_id: userId });
  if (confirmError) throw new Error(`dev_confirm_user_email(${label}) failed: ${confirmError.message}`);

  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw new Error(`signIn(${label}) failed: ${signInError.message}`);

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
  let connectionId: string; // between B (requester) and C (recipient)
  let messageId: string; // from B to C
  let likeId: string; // by B, on B's post
  let commentId: string; // by B, on B's post

  beforeAll(async () => {
    clientA = makeClient();
    clientB = makeClient();
    clientC = makeClient();
    anonClient = makeClient();

    userA = await signUpAndConfirm(clientA, 'a');
    userB = await signUpAndConfirm(clientB, 'b');
    userC = await signUpAndConfirm(clientC, 'c');

    const [{ error: profAErr }, { error: profBErr }, { error: profCErr }] = await Promise.all([
      clientA.from('profiles').insert({ id: userA, username: `rls_test_a_${RUN_ID}` }),
      clientB.from('profiles').insert({ id: userB, username: `rls_test_b_${RUN_ID}` }),
      clientC.from('profiles').insert({ id: userC, username: `rls_test_c_${RUN_ID}` }),
    ]);
    if (profAErr || profBErr || profCErr) {
      throw new Error(`profile setup failed: ${profAErr?.message ?? profBErr?.message ?? profCErr?.message}`);
    }

    const { data: post, error: postErr } = await clientB
      .from('media_posts')
      .insert({ profile_id: userB, media_url: 'https://example.com/x.jpg', media_type: 'image' })
      .select('id')
      .single();
    if (postErr || !post) throw new Error(`media_post setup failed: ${postErr?.message}`);
    postBId = post.id;

    const { data: conn, error: connErr } = await clientB
      .from('connections')
      .insert({ requester_id: userB, recipient_id: userC })
      .select('id')
      .single();
    if (connErr || !conn) throw new Error(`connection setup failed: ${connErr?.message}`);
    connectionId = conn.id;

    const { data: msg, error: msgErr } = await clientB
      .from('messages')
      .insert({ sender_id: userB, recipient_id: userC, content: 'hello from the RLS test suite' })
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
