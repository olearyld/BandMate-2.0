/**
 * RLS / security integration tests. These run against a dedicated test
 * Supabase project (TEST_SUPABASE_URL/TEST_SUPABASE_ANON_KEY) — never the
 * app's production project. No Supabase branching available (needs a
 * Pro-plan upgrade), so this is a real second free-tier project with the
 * same schema instead. See CONVENTIONS.md.
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
import { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import type { Database } from '../../src/lib/database.types';
import { FIXTURE_PASSWORD, insertConnectionWithRetry, makeClient, withDisposableConnection } from './testHelpers';

jest.setTimeout(30000);

const RUN_ID = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

const FIXTURES = {
  a: { email: 'bandmate.rls.fixture.a@gmail.com', username: 'rls_fixture_a' },
  b: { email: 'bandmate.rls.fixture.b@gmail.com', username: 'rls_fixture_b' },
  c: { email: 'bandmate.rls.fixture.c@gmail.com', username: 'rls_fixture_c' },
} as const;

/** Sign in to a fixture account, bootstrapping it (signUp once) if it doesn't exist yet. */
async function signInOrBootstrapFixture(
  client: SupabaseClient<Database>,
  fixture: { email: string; username: string }
): Promise<string> {
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
    email: fixture.email,
    password: FIXTURE_PASSWORD,
  });
  if (!signInError && signInData.user) return signInData.user.id;

  const { data: signUpData, error: signUpError } = await client.auth.signUp({
    email: fixture.email,
    password: FIXTURE_PASSWORD,
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
    password: FIXTURE_PASSWORD,
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
  'cities',
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

    // Phase 5a gated messages_insert_own on an accepted connection between
    // sender/recipient — B<->C (connectionId, above) is deliberately kept
    // pending, so it can no longer back this fixture message. Create a
    // throwaway A<->C connection just long enough to accept it and insert
    // the message, then delete the connection — nothing about the message
    // row depends on the connection continuing to exist afterward (the
    // check only runs at insert time), and this avoids introducing any new
    // persistent fixture state. See messages.test.ts for the full new
    // insert/update/trigger/Realtime coverage this policy needs.
    const tempConnId = await insertConnectionWithRetry(clientA, userA, userC);
    const { error: tempAcceptErr } = await clientC
      .from('connections')
      .update({ status: 'accepted' })
      .eq('id', tempConnId);
    if (tempAcceptErr) throw new Error(`temp connection accept failed: ${tempAcceptErr.message}`);

    // messages has no DELETE policy — each run adds one row (harmless, no
    // uniqueness constraint to violate), so use a per-run marker instead of reusing.
    const { data: msg, error: msgErr } = await clientA
      .from('messages')
      .insert({ sender_id: userA, recipient_id: userC, content: `hello from RLS test run ${RUN_ID}` })
      .select('id')
      .single();
    if (msgErr || !msg) throw new Error(`message setup failed: ${msgErr?.message}`);
    messageId = msg.id;

    await clientA.from('connections').delete().eq('id', tempConnId);

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

  it('A cannot insert a connection request impersonating B as requester', async () => {
    const { error } = await clientA
      .from('connections')
      .insert({ requester_id: userB, recipient_id: userA });
    expect(error).toBeTruthy();

    const { data: check } = await clientB
      .from('connections')
      .select('id')
      .eq('requester_id', userB)
      .eq('recipient_id', userA)
      .maybeSingle();
    expect(check).toBeNull();
  });

  it('self-connection is blocked by the no_self_connect CHECK constraint', async () => {
    const { error } = await clientA.from('connections').insert({ requester_id: userA, recipient_id: userA });
    expect(error).toBeTruthy();
    expect((error as { code?: string } | null)?.code).toBe('23514');
  });

  it('duplicate connection request is blocked regardless of direction (connections_unique_pair)', async () => {
    // B<->C already exists (connectionId, requester B, recipient C, reused across runs).
    const { error: sameDirection } = await clientB
      .from('connections')
      .insert({ requester_id: userB, recipient_id: userC });
    expect(sameDirection).toBeTruthy();
    expect((sameDirection as { code?: string } | null)?.code).toBe('23505');

    const { error: reverseDirection } = await clientC
      .from('connections')
      .insert({ requester_id: userC, recipient_id: userB });
    expect(reverseDirection).toBeTruthy();
    expect((reverseDirection as { code?: string } | null)?.code).toBe('23505');
  });

  it('B (requester) can delete a pending connection they created', async () => {
    await withDisposableConnection(clientB, userB, userA, async (id) => {
      const { error } = await clientB.from('connections').delete().eq('id', id);
      expect(error).toBeFalsy();
      const { data } = await clientA.from('connections').select('id').eq('id', id).maybeSingle();
      expect(data).toBeNull();
    });
  });

  it('A (recipient) can delete a pending connection sent to them', async () => {
    await withDisposableConnection(clientB, userB, userA, async (id) => {
      const { error } = await clientA.from('connections').delete().eq('id', id);
      expect(error).toBeFalsy();
      const { data } = await clientB.from('connections').select('id').eq('id', id).maybeSingle();
      expect(data).toBeNull();
    });
  });

  it('C (recipient) can accept a pending request', async () => {
    await withDisposableConnection(clientA, userA, userC, async (id) => {
      const { error } = await clientC.from('connections').update({ status: 'accepted' }).eq('id', id);
      expect(error).toBeFalsy();
      const { data } = await clientA.from('connections').select('status').eq('id', id).single();
      expect(data?.status).toBe('accepted');
    });
  });

  it('either party can delete an accepted connection', async () => {
    await withDisposableConnection(clientB, userB, userA, async (id) => {
      await clientA.from('connections').update({ status: 'accepted' }).eq('id', id);
      const { data: check } = await clientB.from('connections').select('status').eq('id', id).single();
      expect(check?.status).toBe('accepted');

      const { error } = await clientB.from('connections').delete().eq('id', id);
      expect(error).toBeFalsy();
      const { data } = await clientA.from('connections').select('id').eq('id', id).maybeSingle();
      expect(data).toBeNull();
    });
  });

  // -------------------------------------------------- availability_statuses
  it("A CAN read availability_statuses on B's profile (public-read pattern)", async () => {
    const { data, error } = await clientA
      .from('profiles')
      .select('availability_statuses')
      .eq('id', userB)
      .maybeSingle();
    expect(error).toBeFalsy();
    expect(data?.availability_statuses).toBeDefined();
  });

  it("A cannot update availability_statuses on B's profile", async () => {
    const { data } = await clientA
      .from('profiles')
      .update({ availability_statuses: ['looking_for_band'] })
      .eq('id', userB)
      .select();
    expect(data ?? []).toHaveLength(0);
  });

  it('B CAN update their own availability_statuses', async () => {
    const { error } = await clientB
      .from('profiles')
      .update({ availability_statuses: ['open_to_collabs'] })
      .eq('id', userB);
    expect(error).toBeFalsy();

    const { data: check } = await clientB
      .from('profiles')
      .select('availability_statuses')
      .eq('id', userB)
      .single();
    expect(check?.availability_statuses).toEqual(['open_to_collabs']);

    // Reset so this doesn't leave fixture state mutated for other runs.
    await clientB.from('profiles').update({ availability_statuses: [] }).eq('id', userB);
  });

  // ------------------------------------------------------------------ cities
  it('A CAN read cities (public-read reference-data pattern, same as instruments/genres)', async () => {
    const { data, error } = await clientA.from('cities').select('*').limit(1);
    expect(error).toBeFalsy();
    expect(data).toBeTruthy();
  });

  it('authenticated INSERT into cities is rejected (no write policy for any client role)', async () => {
    const { error } = await clientA
      .from('cities')
      .insert({ city: `RLS Test City ${RUN_ID}`, state: 'ZZ', lat: 0, lng: 0 });
    expect(error).toBeTruthy();
  });

  it('authenticated UPDATE on cities is rejected', async () => {
    const { data: existing } = await clientA.from('cities').select('id, lat').limit(1).single();
    const { data } = await clientA.from('cities').update({ lat: 0 }).eq('id', existing!.id).select();
    expect(data ?? []).toHaveLength(0);
  });

  it('authenticated DELETE on cities is rejected', async () => {
    const { data: existing } = await clientA.from('cities').select('id').limit(1).single();
    const { data } = await clientA.from('cities').delete().eq('id', existing!.id).select();
    expect(data ?? []).toHaveLength(0);
  });

  it('unauthenticated INSERT into cities is rejected', async () => {
    const { error } = await anonClient
      .from('cities')
      .insert({ city: `RLS Test City Anon ${RUN_ID}`, state: 'ZZ', lat: 0, lng: 0 });
    expect(error).toBeTruthy();
  });

  // ---------------------------------------------------------------- messages
  // Fixture message is now A->C (see beforeAll) — B is the true uninvolved
  // third party for this pair, not A.
  it('B (uninvolved) cannot read the A->C message', async () => {
    const { data } = await clientB.from('messages').select('id').eq('id', messageId).maybeSingle();
    expect(data).toBeNull();
  });

  it('B (uninvolved) cannot delete the A->C message', async () => {
    await clientB.from('messages').delete().eq('id', messageId);
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

  // ------------------------------------------------------------- push_tokens
  // Phase 5b. No shared/persistent fixture row here (unlike postBId/likeId/
  // commentId above) — every case below uses its own disposable row, since
  // push_tokens has no public-read dimension to test alongside the owner-only
  // one (contrast cities/availability_statuses' read-any-write-own split).
  async function withDisposablePushToken(
    client: SupabaseClient<Database>,
    profileId: string,
    fn: (tokenId: string) => Promise<void>
  ): Promise<void> {
    const { data, error } = await client
      .from('push_tokens')
      .insert({ profile_id: profileId, expo_push_token: `ExponentPushToken[rls-test-${RUN_ID}]`, platform: 'ios' })
      .select('id')
      .single();
    if (error || !data) throw new Error(`disposable push_token setup failed: ${error?.message}`);
    try {
      await fn(data.id);
    } finally {
      await client.from('push_tokens').delete().eq('id', data.id);
    }
  }

  it('B can insert and read their own push_tokens row', async () => {
    await withDisposablePushToken(clientB, userB, async (tokenId) => {
      const { data, error } = await clientB.from('push_tokens').select('id').eq('id', tokenId).maybeSingle();
      expect(error).toBeFalsy();
      expect(data?.id).toBe(tokenId);
    });
  });

  it("A cannot read B's push_tokens row", async () => {
    await withDisposablePushToken(clientB, userB, async (tokenId) => {
      const { data } = await clientA.from('push_tokens').select('id').eq('id', tokenId).maybeSingle();
      expect(data).toBeNull();
    });
  });

  it('B can update their own push_tokens row', async () => {
    await withDisposablePushToken(clientB, userB, async (tokenId) => {
      const { error } = await clientB.from('push_tokens').update({ platform: 'android' }).eq('id', tokenId);
      expect(error).toBeFalsy();
      const { data } = await clientB.from('push_tokens').select('platform').eq('id', tokenId).single();
      expect(data?.platform).toBe('android');
    });
  });

  it("A cannot update B's push_tokens row", async () => {
    await withDisposablePushToken(clientB, userB, async (tokenId) => {
      const { data } = await clientA.from('push_tokens').update({ platform: 'android' }).eq('id', tokenId).select();
      expect(data ?? []).toHaveLength(0);
    });
  });

  it("A cannot delete B's push_tokens row", async () => {
    await withDisposablePushToken(clientB, userB, async (tokenId) => {
      await clientA.from('push_tokens').delete().eq('id', tokenId);
      const { data } = await clientB.from('push_tokens').select('id').eq('id', tokenId).maybeSingle();
      expect(data).toBeTruthy();
    });
  });

  it('B can delete their own push_tokens row', async () => {
    const { data: inserted, error: insertErr } = await clientB
      .from('push_tokens')
      .insert({ profile_id: userB, expo_push_token: `ExponentPushToken[rls-test-delete-${RUN_ID}]`, platform: 'ios' })
      .select('id')
      .single();
    expect(insertErr).toBeFalsy();
    const { error: deleteErr } = await clientB.from('push_tokens').delete().eq('id', inserted!.id);
    expect(deleteErr).toBeFalsy();
    const { data: check } = await clientB.from('push_tokens').select('id').eq('id', inserted!.id).maybeSingle();
    expect(check).toBeNull();
  });

  it('A cannot insert a push_tokens row for B', async () => {
    const { error } = await clientA
      .from('push_tokens')
      .insert({ profile_id: userB, expo_push_token: `ExponentPushToken[rls-test-forge-${RUN_ID}]`, platform: 'ios' });
    expect(error).toBeTruthy();
  });

  it('unauthenticated cannot read or insert push_tokens', async () => {
    await withDisposablePushToken(clientB, userB, async (tokenId) => {
      const { data } = await anonClient.from('push_tokens').select('id').eq('id', tokenId).maybeSingle();
      expect(data).toBeNull();
    });
    const { error } = await anonClient
      .from('push_tokens')
      .insert({ profile_id: userB, expo_push_token: `ExponentPushToken[rls-test-anon-${RUN_ID}]`, platform: 'ios' });
    expect(error).toBeTruthy();
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
