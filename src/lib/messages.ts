import { supabase } from './supabase';
import { PROFILE_SUMMARY_SELECT, type ConversationSummary, type Message, type ProfileSummary } from './types';

// The only place messaging logic lives — ConversationsListScreen and
// ThreadScreen both consume this rather than duplicating queries, same
// single-source-of-truth-per-concern pattern as connections.ts/discover.ts.
//
// There is no conversations table (see CONVENTIONS.md) — conversations are
// derived client-side by grouping messages by "the other participant".
//
// Deviation from the phase spec's literal signatures, flagged per this
// repo's own convention (see connections.ts's connectionId note): none of
// these take a viewerId/userId param even though the spec's own listed
// signatures omit one — the current user is resolved internally via
// supabase.auth.getSession() (a local, non-network read) rather than
// threaded through by every call site.

async function currentUserId(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in.');
  return session.user.id;
}

interface MessageWithProfiles {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  read_at: string | null;
  created_at: string;
  sender: ProfileSummary;
  recipient: ProfileSummary;
}

/** Thrown by sendMessage when the RLS insert policy rejects it — no accepted
 * connection exists between sender and recipient — so the UI can tell this
 * apart from a generic/network error. */
export class NotConnectedError extends Error {
  constructor() {
    super('You can only message accepted connections.');
    this.name = 'NotConnectedError';
  }
}

/**
 * Derives the current user's conversations from their full message history,
 * most recent first, with a per-thread unread count. Not paginated or capped
 * — fine at this app's current scale, same "fine for now" call already made
 * for like/comment counts elsewhere in this codebase; worth revisiting if a
 * user's message history grows large. See CONVENTIONS.md.
 */
export async function listConversations(): Promise<ConversationSummary[]> {
  const userId = await currentUserId();
  const { data, error } = await supabase
    .from('messages')
    .select(
      `id, sender_id, recipient_id, content, read_at, created_at,
       sender:profiles!messages_sender_id_fkey(${PROFILE_SUMMARY_SELECT}),
       recipient:profiles!messages_recipient_id_fkey(${PROFILE_SUMMARY_SELECT})`
    )
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .returns<MessageWithProfiles[]>();
  if (error) throw error;

  // Map preserves insertion order, and rows arrive most-recent-first, so the
  // first time we see a given "other" participant is their most recent
  // message — giving conversations in recency order for free.
  const byOther = new Map<string, ConversationSummary>();
  for (const row of data ?? []) {
    const isFromMe = row.sender_id === userId;
    const otherProfile = isFromMe ? row.recipient : row.sender;
    const existing = byOther.get(otherProfile.id);
    if (!existing) {
      byOther.set(otherProfile.id, {
        otherProfile,
        lastMessage: { content: row.content, senderId: row.sender_id, createdAt: row.created_at },
        unreadCount: !isFromMe && row.read_at === null ? 1 : 0,
      });
    } else if (!isFromMe && row.read_at === null) {
      existing.unreadCount += 1;
    }
  }
  return Array.from(byOther.values());
}

/** Total unread messages across all conversations — used for the Messages tab badge. */
export async function getUnreadCount(): Promise<number> {
  const userId = await currentUserId();
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', userId)
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

const UNREAD_COUNT_DEBOUNCE_MS = 300;

/**
 * Subscribes to realtime changes affecting userId's unread count — a new
 * incoming message, or an existing one being marked read — and calls
 * onChange with a freshly recomputed total. Debounced: a single
 * markThreadRead() call can emit one Postgres Changes UPDATE event per row
 * it touches, so without this, marking a multi-message backlog read would
 * trigger one redundant count query per row instead of one.
 */
export function subscribeToUnreadCount(userId: string, onChange: (count: number) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const scheduleRefresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      getUnreadCount().then(onChange).catch(() => {});
    }, UNREAD_COUNT_DEBOUNCE_MS);
  };

  const channel = supabase
    .channel(`unread-count-${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${userId}` },
      scheduleRefresh
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages', filter: `recipient_id=eq.${userId}` },
      scheduleRefresh
    )
    .subscribe();

  return () => {
    if (timer) clearTimeout(timer);
    supabase.removeChannel(channel);
  };
}

/** Paginated message history with one other user, newest-first page order. */
export async function getThread(
  otherUserId: string,
  opts: { before?: string; limit?: number } = {}
): Promise<Message[]> {
  const userId = await currentUserId();
  const limit = opts.limit ?? 30;
  let query = supabase
    .from('messages')
    .select('id, sender_id, recipient_id, content, read_at, created_at')
    .or(
      `and(sender_id.eq.${userId},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${userId})`
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (opts.before) query = query.lt('created_at', opts.before);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * Inserts a message. Surfaces the RLS rejection (no accepted connection) as
 * NotConnectedError, distinct from any other/generic error — a Postgres RLS
 * WITH CHECK failure on INSERT is SQLSTATE 42501, so that's the discriminator.
 */
export async function sendMessage(recipientId: string, content: string): Promise<Message> {
  const senderId = await currentUserId();
  const { data, error } = await supabase
    .from('messages')
    .insert({ sender_id: senderId, recipient_id: recipientId, content })
    .select('id, sender_id, recipient_id, content, read_at, created_at')
    .single();
  if (error) {
    if ((error as { code?: string }).code === '42501') throw new NotConnectedError();
    throw error;
  }
  return data;
}

/**
 * Marks unread messages from otherUserId as read. Only ever transitions
 * read_at from null to non-null (the .is('read_at', null) filter), matching
 * the messages_guard_read_update trigger's only allowed transition.
 */
export async function markThreadRead(otherUserId: string): Promise<void> {
  const userId = await currentUserId();
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('sender_id', otherUserId)
    .eq('recipient_id', userId)
    .is('read_at', null);
  if (error) throw error;
}

/**
 * Subscribes to new messages in a thread with otherUserId, in either
 * direction. Postgres Changes' filter only supports a single column
 * predicate, so this registers two listeners on one channel (one per
 * direction) rather than one OR'd filter — each is independently narrowed
 * further by messages_read_own RLS, so this can never receive a message
 * that doesn't actually involve the current user (confirmed via an
 * integration test, not just assumed — see CONVENTIONS.md).
 */
export function subscribeToThread(otherUserId: string, onInsert: (message: Message) => void): () => void {
  const channel = supabase
    .channel(`messages-thread-${otherUserId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${otherUserId}` },
      (payload) => onInsert(payload.new as Message)
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${otherUserId}` },
      (payload) => onInsert(payload.new as Message)
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
