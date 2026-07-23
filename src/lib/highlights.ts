import { supabase } from './supabase';

// The only place profile_highlights write logic lives (Phase 6a). Read access
// goes through the profile_highlights join already embedded in FullProfile
// (see MyProfileScreen/PublicProfileScreen's select queries) — both viewer
// display and the manage panel's initial selection read from that, so there's
// no separate list function here, just the one write path.

/**
 * Replaces the caller's entire highlight reel with postIds, in the given
 * order (position 0..n-1) — one atomic delete-and-reinsert via the
 * reorder_profile_highlights RPC, covering add/remove/reorder in a single
 * call rather than three separate operations. See CONVENTIONS.md for why
 * this is delete-and-reinsert rather than in-place position updates: an
 * in-place swap would transiently collide with unique(profile_id, position).
 * The DB trigger enforces the cap of 6 regardless of what the UI already
 * disables past 6 — this is not the real enforcement, just a fast client error.
 */
export async function saveHighlights(postIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('reorder_profile_highlights', { p_post_ids: postIds });
  if (error) throw error;
}
