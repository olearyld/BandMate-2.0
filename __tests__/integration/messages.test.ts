/**
 * Integration tests for Phase 5a's messaging changes, against the dedicated
 * test Supabase project — never production. See CONVENTIONS.md.
 *
 * Reuses the same three permanent fixture accounts as rls.test.ts
 * (bandmate.rls.fixture.{a,b,c}@gmail.com) via a plain sign-in (no
 * bootstrap-with-fallback here — same "fails fast with a clear error if
 * missing" choice discover.test.ts already made for its own fixtures,
 * since these are guaranteed to already exist on this project).
 *
 * This file manages all of its own connection state via disposable
 * insert-then-delete helpers (withDisposableConnection / withAcceptedConnection)
 * rather than relying on any connection rls.test.ts sets up — the two files
 * can run in either order, or concurrently, without interfering.
 *
 * Messages still has no DELETE policy (deliberately deferred — see
 * CONVENTIONS.md), so successful inserts here leave a row behind, same
 * disclosed accumulation as rls.test.ts's own message fixture.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { WebSocketLikeConstructor } from '@supabase/realtime-js';
import WebSocket from 'ws';
import type { Database } from '../../src/lib/database.types';

jest.setTimeout(45000);

const SUPABASE_URL = process.env.TEST_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY are not set. ' +
      'Integration tests need a real .env — see jest.setup.js.'
  );
}

const PASSWORD = 'BandmateTest!23456';
const RUN_ID = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

function makeClient(): SupabaseClient<Database> {
  // Unlike rls.test.ts/discover.test.ts, this file actually exercises
  // Realtime for real (see the "Realtime" describe block below), not just
  // supplying `ws` to satisfy createClient() init.
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as WebSocketLikeConstructor },
  });
}

async function signIn(client: SupabaseClient<Database>, email: string): Promise<string> {
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.user) {
    throw new Error(
      `Sign-in failed for fixture ${email}: ${error?.message}. This fixture must already exist — see rls.test.ts.`
    );
  }
  return data.user.id;
}

/**
 * Only 3 fixture accounts exist (A/B/C — see header comment), so there are
 * only 3 possible pairs, one of which (B<->C) is permanently claimed by
 * rls.test.ts. Jest runs integration test files in separate parallel
 * workers by default, and rls.test.ts *also* needs a throwaway accepted
 * A<->C connection for its own fixture message (Phase 5a's connection-gated
 * insert policy) — so a `connections_unique_pair` collision between the two
 * files racing for the same pair is expected contention, not a bug. Retries
 * with backoff rather than erroring immediately on a 23505.
 */
async function insertConnectionWithRetry(
  client: SupabaseClient<Database>,
  requesterId: string,
  recipientId: string,
  status?: 'pending' | 'declined'
): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await client
      .from('connections')
      .insert({ requester_id: requesterId, recipient_id: recipientId, ...(status ? { status } : {}) })
      .select('id')
      .single();
    if (!error) return data!.id;
    if ((error as { code?: string }).code !== '23505') throw error;
    await sleep(500 + attempt * 500);
  }
  throw new Error(`could not acquire connection ${requesterId}<->${recipientId} after retries (persistent contention)`);
}

/** Inserts a connection with an explicit status (pending/declined — both are
 * directly insertable since connections_insert_requester only checks
 * requester_id, not status), runs fn, then always deletes it. */
async function withDisposableConnection(
  insertingClient: SupabaseClient<Database>,
  requesterId: string,
  recipientId: string,
  status: 'pending' | 'declined',
  fn: (connectionId: string) => Promise<void>
): Promise<void> {
  const connectionId = await insertConnectionWithRetry(insertingClient, requesterId, recipientId, status);
  try {
    await fn(connectionId);
  } finally {
    await insertingClient.from('connections').delete().eq('id', connectionId);
  }
}

/** Inserts a connection, has the recipient accept it, runs fn, then always deletes it. */
async function withAcceptedConnection(
  requesterClient: SupabaseClient<Database>,
  recipientClient: SupabaseClient<Database>,
  requesterId: string,
  recipientId: string,
  fn: (connectionId: string) => Promise<void>
): Promise<void> {
  const connectionId = await insertConnectionWithRetry(requesterClient, requesterId, recipientId);
  const { error: acceptErr } = await recipientClient
    .from('connections')
    .update({ status: 'accepted' })
    .eq('id', connectionId);
  if (acceptErr) throw new Error(`disposable connection accept failed: ${acceptErr.message}`);
  try {
    await fn(connectionId);
  } finally {
    await requesterClient.from('connections').delete().eq('id', connectionId);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('messages: connection-gated insert + read-receipt update + trigger guard', () => {
  let clientA: SupabaseClient<Database>;
  let clientB: SupabaseClient<Database>;
  let clientC: SupabaseClient<Database>;

  let userA: string;
  let userB: string;
  let userC: string;

  beforeAll(async () => {
    clientA = makeClient();
    clientB = makeClient();
    clientC = makeClient();

    userA = await signIn(clientA, 'bandmate.rls.fixture.a@gmail.com');
    userB = await signIn(clientB, 'bandmate.rls.fixture.b@gmail.com');
    userC = await signIn(clientC, 'bandmate.rls.fixture.c@gmail.com');
  });

  afterAll(async () => {
    // clientB is the only one that ever opens a real Realtime socket (the
    // "Realtime" test below). removeChannel() schedules a disconnect once no
    // channels remain, but that's deferred by a short delay — explicitly
    // disconnecting here avoids leaving an open WebSocket handle that keeps
    // the Jest worker process alive past the test run.
    await Promise.all([
      clientA?.auth.signOut(),
      clientB?.auth.signOut(),
      clientC?.auth.signOut(),
      clientB?.realtime.disconnect(),
    ]);
  });

  // ------------------------------------------------------------- insert gate
  it('insert is allowed between an accepted-connection pair', async () => {
    await withAcceptedConnection(clientA, clientC, userA, userC, async () => {
      const { data, error } = await clientA
        .from('messages')
        .insert({ sender_id: userA, recipient_id: userC, content: `accepted-pair-insert ${RUN_ID}` })
        .select('id')
        .single();
      expect(error).toBeFalsy();
      expect(data?.id).toBeTruthy();
    });
  });

  it('insert is rejected between a pending-connection pair', async () => {
    await withDisposableConnection(clientA, userA, userB, 'pending', async () => {
      const { error } = await clientA
        .from('messages')
        .insert({ sender_id: userA, recipient_id: userB, content: `pending-pair-insert ${RUN_ID}` });
      expect(error).toBeTruthy();
      expect((error as { code?: string } | null)?.code).toBe('42501');
    });
  });

  it('insert is rejected between a declined-connection pair', async () => {
    await withDisposableConnection(clientA, userA, userB, 'declined', async () => {
      const { error } = await clientA
        .from('messages')
        .insert({ sender_id: userA, recipient_id: userB, content: `declined-pair-insert ${RUN_ID}` });
      expect(error).toBeTruthy();
      expect((error as { code?: string } | null)?.code).toBe('42501');
    });
  });

  it('insert is rejected with no connection at all between the pair', async () => {
    // Confirmed, not assumed: no lingering connection between A and B before
    // asserting the rejection is actually due to its absence.
    const { data: existing } = await clientA
      .from('connections')
      .select('id')
      .or(`and(requester_id.eq.${userA},recipient_id.eq.${userB}),and(requester_id.eq.${userB},recipient_id.eq.${userA})`)
      .maybeSingle();
    expect(existing).toBeNull();

    const { error } = await clientA
      .from('messages')
      .insert({ sender_id: userA, recipient_id: userB, content: `no-relationship-insert ${RUN_ID}` });
    expect(error).toBeTruthy();
    expect((error as { code?: string } | null)?.code).toBe('42501');
  });

  // ------------------------------------------------------------- read_at update
  it('recipient can mark a message read (read_at null -> non-null)', async () => {
    await withAcceptedConnection(clientA, clientC, userA, userC, async () => {
      const { data: msg } = await clientA
        .from('messages')
        .insert({ sender_id: userA, recipient_id: userC, content: `read-recipient ${RUN_ID}` })
        .select('id, read_at')
        .single();
      expect(msg?.read_at).toBeNull();

      const { error } = await clientC.from('messages').update({ read_at: new Date().toISOString() }).eq('id', msg!.id);
      expect(error).toBeFalsy();

      const { data: check } = await clientC.from('messages').select('read_at').eq('id', msg!.id).single();
      expect(check?.read_at).toBeTruthy();
    });
  });

  it('sender cannot mark their own sent message read', async () => {
    await withAcceptedConnection(clientA, clientC, userA, userC, async () => {
      const { data: msg } = await clientA
        .from('messages')
        .insert({ sender_id: userA, recipient_id: userC, content: `read-sender ${RUN_ID}` })
        .select('id')
        .single();

      const { data } = await clientA
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('id', msg!.id)
        .select();
      expect(data ?? []).toHaveLength(0);

      const { data: check } = await clientC.from('messages').select('read_at').eq('id', msg!.id).single();
      expect(check?.read_at).toBeNull();
    });
  });

  it('a non-participant cannot mark someone else\'s message read', async () => {
    await withAcceptedConnection(clientA, clientC, userA, userC, async () => {
      const { data: msg } = await clientA
        .from('messages')
        .insert({ sender_id: userA, recipient_id: userC, content: `read-nonparticipant ${RUN_ID}` })
        .select('id')
        .single();

      const { data } = await clientB
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('id', msg!.id)
        .select();
      expect(data ?? []).toHaveLength(0);

      const { data: check } = await clientC.from('messages').select('read_at').eq('id', msg!.id).single();
      expect(check?.read_at).toBeNull();
    });
  });

  // ------------------------------------------------------------- trigger guard
  it('trigger rejects changing content via UPDATE', async () => {
    await withAcceptedConnection(clientA, clientC, userA, userC, async () => {
      const { data: msg } = await clientA
        .from('messages')
        .insert({ sender_id: userA, recipient_id: userC, content: `trigger-content ${RUN_ID}` })
        .select('id, content')
        .single();

      const { error } = await clientC.from('messages').update({ content: 'tampered' }).eq('id', msg!.id);
      expect(error).toBeTruthy();

      const { data: check } = await clientC.from('messages').select('content').eq('id', msg!.id).single();
      expect(check?.content).toBe(msg!.content);
    });
  });

  it('trigger rejects changing sender_id via UPDATE', async () => {
    await withAcceptedConnection(clientA, clientC, userA, userC, async () => {
      const { data: msg } = await clientA
        .from('messages')
        .insert({ sender_id: userA, recipient_id: userC, content: `trigger-sender ${RUN_ID}` })
        .select('id')
        .single();

      const { error } = await clientC.from('messages').update({ sender_id: userB }).eq('id', msg!.id);
      expect(error).toBeTruthy();

      const { data: check } = await clientC.from('messages').select('sender_id').eq('id', msg!.id).single();
      expect(check?.sender_id).toBe(userA);
    });
  });

  it('trigger rejects changing recipient_id via UPDATE', async () => {
    await withAcceptedConnection(clientA, clientC, userA, userC, async () => {
      const { data: msg } = await clientA
        .from('messages')
        .insert({ sender_id: userA, recipient_id: userC, content: `trigger-recipient ${RUN_ID}` })
        .select('id')
        .single();

      const { error } = await clientC.from('messages').update({ recipient_id: userB }).eq('id', msg!.id);
      expect(error).toBeTruthy();

      const { data: check } = await clientC.from('messages').select('recipient_id').eq('id', msg!.id).single();
      expect(check?.recipient_id).toBe(userC);
    });
  });

  it('trigger rejects changing created_at via UPDATE', async () => {
    await withAcceptedConnection(clientA, clientC, userA, userC, async () => {
      const { data: msg } = await clientA
        .from('messages')
        .insert({ sender_id: userA, recipient_id: userC, content: `trigger-created-at ${RUN_ID}` })
        .select('id, created_at')
        .single();

      const { error } = await clientC
        .from('messages')
        .update({ created_at: new Date(0).toISOString() })
        .eq('id', msg!.id);
      expect(error).toBeTruthy();

      const { data: check } = await clientC.from('messages').select('created_at').eq('id', msg!.id).single();
      expect(check?.created_at).toBe(msg!.created_at);
    });
  });

  it('trigger rejects changing read_at once already set', async () => {
    await withAcceptedConnection(clientA, clientC, userA, userC, async () => {
      const { data: msg } = await clientA
        .from('messages')
        .insert({ sender_id: userA, recipient_id: userC, content: `trigger-readat-twice ${RUN_ID}` })
        .select('id')
        .single();

      await clientC.from('messages').update({ read_at: new Date().toISOString() }).eq('id', msg!.id);
      const { data: afterFirst } = await clientC.from('messages').select('read_at').eq('id', msg!.id).single();
      expect(afterFirst?.read_at).toBeTruthy();

      const { error } = await clientC
        .from('messages')
        .update({ read_at: new Date(Date.now() + 60000).toISOString() })
        .eq('id', msg!.id);
      expect(error).toBeTruthy();

      const { data: afterSecond } = await clientC.from('messages').select('read_at').eq('id', msg!.id).single();
      expect(afterSecond?.read_at).toBe(afterFirst?.read_at);
    });
  });

  // ------------------------------------------------------------------ realtime
  // Doesn't just assume RLS applies to Postgres Changes — verifies it directly:
  // B subscribes with no column filter at all (event/schema/table only), so
  // RLS is the *only* thing that can be gating what B receives. A negative
  // control (a message B isn't party to) confirms it's actually filtered,
  // then a positive control (a message B IS party to) confirms the
  // subscription is genuinely live and not just silently broken.
  it('a subscribed client only receives Realtime events it is authorized to see per RLS', async () => {
    const received: { content: string }[] = [];
    const channel = clientB
      .channel(`messages-rls-test-${RUN_ID}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        received.push(payload.new as { content: string });
      });

    await new Promise<void>((resolve, reject) => {
      channel.subscribe((status: string, err?: Error) => {
        if (status === 'SUBSCRIBED') resolve();
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(err ?? new Error(status));
      });
    });

    try {
      await withAcceptedConnection(clientA, clientC, userA, userC, async () => {
        // B is not sender or recipient here — messages_read_own should keep
        // this invisible to B's subscription entirely.
        const unauthorizedContent = `realtime-unauthorized-${RUN_ID}`;
        const { error } = await clientA
          .from('messages')
          .insert({ sender_id: userA, recipient_id: userC, content: unauthorizedContent });
        expect(error).toBeFalsy();

        await sleep(4000);
        expect(received.some((m) => m.content === unauthorizedContent)).toBe(false);
      });

      await withAcceptedConnection(clientA, clientB, userA, userB, async () => {
        // B IS the recipient here — should arrive on the same subscription,
        // proving it's genuinely live (not just silently filtering everything).
        const authorizedContent = `realtime-authorized-${RUN_ID}`;
        const { error } = await clientA
          .from('messages')
          .insert({ sender_id: userA, recipient_id: userB, content: authorizedContent });
        expect(error).toBeFalsy();

        await sleep(4000);
        expect(received.some((m) => m.content === authorizedContent)).toBe(true);
      });
    } finally {
      await clientB.removeChannel(channel);
    }
  });
});
