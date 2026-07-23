import { supabase } from './supabase';
import { uploadStoryMedia } from './mediaUpload';
import { STORIES_SELECT } from './types';
import type { PickedMedia } from './mediaUpload';
import type { Story, StoryFeedRow, StoryGroup } from './types';

// The only place stories read/write logic lives (Phase 7), same
// single-source-of-truth-per-concern convention as connections.ts/
// messages.ts/discover.ts/highlights.ts.

/**
 * Active (non-expired) stories, grouped by author -- the shape the stories
 * tray needs directly. The `expires_at > now()` filter is applied here at
 * query time (the phase spec's primary expiry mechanism); RLS's own
 * `expires_at > now()` USING clause is defense-in-depth on top of this, not
 * a substitute for it -- see CONVENTIONS.md.
 */
export async function listActiveStoryGroups(): Promise<StoryGroup[]> {
  const { data, error } = await supabase
    .from('stories')
    .select(STORIES_SELECT)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .returns<StoryFeedRow[]>();
  if (error) throw error;

  const order: string[] = [];
  const groups = new Map<string, StoryGroup>();
  for (const row of data ?? []) {
    let group = groups.get(row.profile_id);
    if (!group) {
      group = { profile: row.profiles, stories: [] };
      groups.set(row.profile_id, group);
      order.push(row.profile_id);
    }
    const story: Story = {
      id: row.id,
      profile_id: row.profile_id,
      media_url: row.media_url,
      media_type: row.media_type,
      created_at: row.created_at,
      expires_at: row.expires_at,
    };
    group.stories.push(story);
  }
  return order.map((id) => groups.get(id)!);
}

/**
 * Uploads media and inserts the story row in one call, mirroring
 * CreatePostScreen's inline upload-then-insert shape. profileId is passed
 * explicitly by the caller (from useAppContext's session), not resolved
 * internally, matching how media_posts inserts already work in this repo --
 * unlike reorder_profile_highlights, this is a plain table insert (no RPC),
 * so profile_id must be supplied client-side for RLS's WITH CHECK to see it.
 */
export async function postStory(profileId: string, media: PickedMedia): Promise<void> {
  const { url } = await uploadStoryMedia(profileId, media);
  const { error } = await supabase.from('stories').insert({
    profile_id: profileId,
    media_url: url,
    media_type: media.type,
  });
  if (error) throw error;
}
