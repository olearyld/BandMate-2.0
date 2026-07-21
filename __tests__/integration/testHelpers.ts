/**
 * Shared setup helpers for __tests__/integration/** — every file here targets
 * the dedicated test Supabase project (TEST_SUPABASE_URL/TEST_SUPABASE_ANON_KEY),
 * never production. See CONVENTIONS.md.
 *
 * Kept out of any one spec file since makeClient()/signIn()/the disposable-
 * connection helpers were previously copy-pasted near-identically across
 * rls.test.ts, discover.test.ts, and messages.test.ts.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { WebSocketLikeConstructor } from '@supabase/realtime-js';
import WebSocket from 'ws';
import type { Database } from '../../src/lib/database.types';

const SUPABASE_URL = process.env.TEST_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY are not set. ' +
      'Integration tests need a real .env — see jest.setup.js.'
  );
}

export const FIXTURE_PASSWORD = 'BandmateTest!23456';

/**
 * A fresh client aimed at the test project. Node 20 has no native WebSocket,
 * and createClient() eagerly initializes the Realtime client — supply `ws`
 * as the transport so client creation doesn't throw. Most callers never
 * actually use Realtime (this is purely to satisfy init); messages.test.ts
 * is the one exception and says so at its own call sites.
 */
export function makeClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as WebSocketLikeConstructor },
  });
}

/** Signs in to an already-bootstrapped fixture account; throws a descriptive
 * error naming the fixture if it doesn't exist yet (no signUp() fallback —
 * see rls.test.ts's signInOrBootstrapFixture for the one place that needs one). */
export async function signIn(client: SupabaseClient<Database>, email: string): Promise<string> {
  const { data, error } = await client.auth.signInWithPassword({ email, password: FIXTURE_PASSWORD });
  if (error || !data.user) {
    throw new Error(`Sign-in failed for fixture ${email}: ${error?.message}. This fixture must already exist.`);
  }
  return data.user.id;
}

/**
 * Inserts a connection row, retrying on a connections_unique_pair collision
 * (23505) rather than failing outright — only 3 fixture accounts exist
 * (rls.test.ts's A/B/C), so with Jest running integration test files in
 * parallel workers by default, two files briefly wanting the same pair is
 * expected contention, not a bug.
 */
export async function insertConnectionWithRetry(
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
    await new Promise((r) => setTimeout(r, 500 + attempt * 500));
  }
  throw new Error(`could not acquire connection ${requesterId}<->${recipientId} after retries (persistent contention)`);
}

/** Inserts a connection (optionally with an explicit status — pending/declined
 * are both directly insertable since connections_insert_requester only checks
 * requester_id), runs fn(connectionId), then always deletes it. */
export async function withDisposableConnection(
  client: SupabaseClient<Database>,
  requesterId: string,
  recipientId: string,
  fn: (connectionId: string) => Promise<void>,
  status?: 'pending' | 'declined'
): Promise<void> {
  const connectionId = await insertConnectionWithRetry(client, requesterId, recipientId, status);
  try {
    await fn(connectionId);
  } finally {
    await client.from('connections').delete().eq('id', connectionId);
  }
}

/** Inserts a connection, has the recipient accept it, runs fn(connectionId),
 * then always deletes it. */
export async function withAcceptedConnection(
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
