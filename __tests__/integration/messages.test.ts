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
 * insert-then-delete helpers (withDisposableConnection / withAcceptedConnection,
 * both shared with rls.test.ts via ./testHelpers) rather than relying on any
 * connection rls.test.ts sets up — the two files can run in either order, or
 * concurrently, without interfering.
 *
 * Messages still has no DELETE policy (deliberately deferred — see
 * CONVENTIONS.md), so successful inserts here leave a row behind, same
 * disclosed accumulation as rls.test.ts's own message fixture.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import { makeClient, signIn, withAcceptedConnection, withDisposableConnection } from './testHelpers';

jest.setTimeout(45000);

const RUN_ID = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

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
    await withDisposableConnection(
      clientA,
      userA,
      userB,
      async () => {
        const { error } = await clientA
          .from('messages')
          .insert({ sender_id: userA, recipient_id: userB, content: `pending-pair-insert ${RUN_ID}` });
        expect(error).toBeTruthy();
        expect((error as { code?: string } | null)?.code).toBe('42501');
      },
      'pending'
    );
  });

  it('insert is rejected between a declined-connection pair', async () => {
    await withDisposableConnection(
      clientA,
      userA,
      userB,
      async () => {
        const { error } = await clientA
          .from('messages')
          .insert({ sender_id: userA, recipient_id: userB, content: `declined-pair-insert ${RUN_ID}` });
        expect(error).toBeTruthy();
        expect((error as { code?: string } | null)?.code).toBe('42501');
      },
      'declined'
    );
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
  // Structurally identical across fields (insert -> attempt a one-field
  // update -> expect rejection -> confirm the field didn't change), so
  // data-driven via it.each rather than four near-copy-pasted test bodies.
  type MessageRow = { id: string; content: string; sender_id: string; recipient_id: string; created_at: string };
  it.each<[keyof Omit<MessageRow, 'id'>, () => string]>([
    ['content', () => 'tampered'],
    ['sender_id', () => userB],
    ['recipient_id', () => userB],
    ['created_at', () => new Date(0).toISOString()],
  ])('trigger rejects changing %s via UPDATE', async (field, getTamperedValue) => {
    await withAcceptedConnection(clientA, clientC, userA, userC, async () => {
      const { data: original } = await clientA
        .from('messages')
        .insert({ sender_id: userA, recipient_id: userC, content: `trigger-${field} ${RUN_ID}` })
        .select('id, content, sender_id, recipient_id, created_at')
        .single();

      // Dynamic single-field update — postgrest-js's typed update() rejects any
      // object with a generic string index signature (by design, to catch
      // typos), so a computed key needs `any` here; the field always comes
      // from the literal table above, never arbitrary input.
      const { error } = await clientC
        .from('messages')
        .update({ [field]: getTamperedValue() } as any)
        .eq('id', original!.id);
      expect(error).toBeTruthy();

      const { data: check } = await clientC
        .from('messages')
        .select('content, sender_id, recipient_id, created_at')
        .eq('id', original!.id)
        .single();
      expect(check?.[field]).toBe(original![field]);
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
