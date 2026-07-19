import { supabase } from './supabase';
import type { ConnectionListItem, ConnectionStatusInfo, ProfileSummary } from './types';

// The only place connection-status logic lives — PublicProfileScreen and
// ConnectionsScreen both consume this rather than duplicating queries.
// See CONVENTIONS.md: declining/removing a connection is always a DELETE
// (cancelOrDeclineOrRemove), never a status update — 'declined' is a dead
// enum value going forward.

const PROFILE_SUMMARY_SELECT = 'id, username, display_name, avatar_url';

/**
 * Resolves the connection state between viewer and profile, direction-agnostic
 * (checks both requester/recipient orderings in one query, per the
 * connections_unique_pair constraint — there's at most one row for any pair).
 */
export async function getConnectionStatus(
  viewerId: string,
  profileId: string
): Promise<ConnectionStatusInfo> {
  const { data, error } = await supabase
    .from('connections')
    .select('id, requester_id, recipient_id, status')
    .or(
      `and(requester_id.eq.${viewerId},recipient_id.eq.${profileId}),and(requester_id.eq.${profileId},recipient_id.eq.${viewerId})`
    )
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status === 'declined') {
    // No row, or a legacy 'declined' row from before that status was retired —
    // either way, nothing stands between viewer and a fresh request.
    return { status: 'none', connectionId: null };
  }
  if (data.status === 'accepted') {
    return { status: 'accepted', connectionId: data.id };
  }
  return {
    status: data.requester_id === viewerId ? 'pending_sent' : 'pending_received',
    connectionId: data.id,
  };
}

export async function sendRequest(viewerId: string, profileId: string): Promise<void> {
  const { error } = await supabase
    .from('connections')
    .insert({ requester_id: viewerId, recipient_id: profileId, status: 'pending' });
  if (error) {
    // connections_unique_pair is direction-agnostic — a mirrored row from either
    // side already existing surfaces here as a unique violation. See CONVENTIONS.md.
    if (error.code === '23505') {
      throw new Error('There is already a connection between you two.');
    }
    throw error;
  }
}

export async function acceptRequest(connectionId: string): Promise<void> {
  const { error } = await supabase
    .from('connections')
    .update({ status: 'accepted' })
    .eq('id', connectionId);
  if (error) throw error;
}

/**
 * Covers cancelling a sent request, declining a received request, and removing
 * an accepted connection — all just "delete this row" (connections_delete_own
 * allows either party). One function, no branching on status.
 */
export async function cancelOrDeclineOrRemove(connectionId: string): Promise<void> {
  const { error } = await supabase.from('connections').delete().eq('id', connectionId);
  if (error) throw error;
}

/** Shared by listIncomingRequests/listSentRequests — identical query shape, just which side is filtered on and which joined profile is "the other person". */
async function listPendingRequests(
  userId: string,
  direction: 'incoming' | 'outgoing'
): Promise<ConnectionListItem[]> {
  const filterColumn = direction === 'incoming' ? 'recipient_id' : 'requester_id';
  const otherAlias = direction === 'incoming' ? 'requester' : 'recipient';
  const otherFkey =
    direction === 'incoming' ? 'connections_requester_id_fkey' : 'connections_recipient_id_fkey';

  const { data, error } = await supabase
    .from('connections')
    .select(`id, ${otherAlias}:profiles!${otherFkey}(${PROFILE_SUMMARY_SELECT})`)
    .eq(filterColumn, userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .returns<{ id: string; requester: ProfileSummary; recipient: ProfileSummary }[]>();
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, otherProfile: row[otherAlias] }));
}

export function listIncomingRequests(userId: string): Promise<ConnectionListItem[]> {
  return listPendingRequests(userId, 'incoming');
}

export function listSentRequests(userId: string): Promise<ConnectionListItem[]> {
  return listPendingRequests(userId, 'outgoing');
}

export async function listAcceptedConnections(userId: string): Promise<ConnectionListItem[]> {
  const { data, error } = await supabase
    .from('connections')
    .select(
      `id, requester_id, recipient_id,
       requester:profiles!connections_requester_id_fkey(${PROFILE_SUMMARY_SELECT}),
       recipient:profiles!connections_recipient_id_fkey(${PROFILE_SUMMARY_SELECT})`
    )
    .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`)
    .eq('status', 'accepted')
    .order('updated_at', { ascending: false })
    .returns<
      {
        id: string;
        requester_id: string;
        recipient_id: string;
        requester: ProfileSummary;
        recipient: ProfileSummary;
      }[]
    >();
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    otherProfile: row.requester_id === userId ? row.recipient : row.requester,
  }));
}
