export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'professional';
export type MediaType = 'image' | 'audio' | 'video';
export type AvailabilityStatus =
  | 'looking_for_band'
  | 'available_for_session_work'
  | 'open_to_auditions'
  | 'forming_band'
  | 'open_to_collabs'
  | 'not_currently_looking';

export const SKILL_LEVELS: { value: ExperienceLevel; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'professional', label: 'Pro' },
];

export const AVAILABILITY_STATUSES: { value: AvailabilityStatus; label: string }[] = [
  { value: 'looking_for_band', label: 'Looking for a band' },
  { value: 'available_for_session_work', label: 'Available for session work' },
  { value: 'open_to_auditions', label: 'Open to auditions' },
  { value: 'forming_band', label: 'Forming a band' },
  { value: 'open_to_collabs', label: 'Open to collabs' },
  { value: 'not_currently_looking', label: 'Not currently looking' },
];

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  location_city: string | null;
  location_state: string | null;
  matched_city_id: string | null;
  experience_level: ExperienceLevel | null;
  avatar_url: string | null;
  intro_media_url: string | null;
  intro_media_type: MediaType | null;
  availability_statuses: AvailabilityStatus[];
  created_at: string;
  updated_at: string;
}

export interface Instrument {
  id: number;
  name: string;
}

export interface Genre {
  id: number;
  name: string;
}

// A row in the curated cities reference table (Phase 4a) — public-read,
// maintained by migrations/direct seed SQL only, never written to from the
// app. lat/lng are city-center approximations, not precise geocodes.
export interface City {
  id: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
}

export interface MediaPost {
  id: string;
  profile_id: string;
  media_url: string;
  media_type: MediaType;
  caption: string | null;
  tags: string[] | null;
  thumbnail_url: string | null;
  status: string;
  created_at: string;
}

export interface Comment {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

// The four states the connect button / connection UI can be in, from a given
// viewer's perspective — resolved by src/lib/connections.ts, the single place
// this logic lives.
export type ConnectionStatusValue = 'none' | 'pending_sent' | 'pending_received' | 'accepted';

export interface ConnectionStatusInfo {
  status: ConnectionStatusValue;
  // The connections.id needed to act on the relationship (accept/cancel/decline/remove).
  // null only when status is 'none' (no row exists yet).
  connectionId: string | null;
}

// A row from the discover_profiles RPC (Phase 4b). instruments/genres are the
// RPC's jsonb-aggregated arrays, hand-typed here per the same convention as
// FullProfile/FeedPostRow — matches the exact shape of that specific query,
// not postgrest-js's generic Json inference for the function's Returns type.
// distance_miles is only non-null when a radius filter was applied.
export interface DiscoverProfileRow {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  location_city: string | null;
  location_state: string | null;
  instruments: { id: number; name: string; skill_level: ExperienceLevel }[];
  genres: { id: number; name: string }[];
  distance_miles: number | null;
}

export interface ProfileSummary {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

// The select-fragment matching ProfileSummary's shape, shared by connections.ts
// and messages.ts (both join a "the other party" profile) rather than each
// keeping its own copy.
export const PROFILE_SUMMARY_SELECT = 'id, username, display_name, avatar_url';

// A row in one of the Connections screen's three lists — the connection id
// plus whichever profile is the "other" party from the viewer's perspective.
export interface ConnectionListItem {
  id: string;
  otherProfile: ProfileSummary;
}

// A row in profile_highlights (Phase 6a) joined with the fields of its
// pinned media_posts row needed to render a thumbnail — the shape matching
// PROFILE_HIGHLIGHTS_SELECT below, same convention as FeedPostRow/PostDetailRow.
export interface HighlightPostRow {
  post_id: string;
  position: number;
  media_posts: Pick<MediaPost, 'id' | 'media_url' | 'media_type' | 'thumbnail_url' | 'caption'>;
}

// Shared embed fragment for a profile's highlight reel (Phase 6a) — used by both
// MyProfileScreen and PublicProfileScreen's profile queries, same
// shared-select-fragment convention as PROFILE_SUMMARY_SELECT above. Always pair
// with `.order('position', { referencedTable: 'profile_highlights' })` on the query.
export const PROFILE_HIGHLIGHTS_SELECT =
  'profile_highlights(post_id, position, media_posts(id, media_url, media_type, thumbnail_url, caption))';

// Stories (Phase 7) only ever hold image/video -- the DB CHECK constraint
// enforces this on top of the shared 3-value media_type enum (which also
// allows 'audio', used elsewhere). Narrower here so the client can't
// construct an invalid story media type either.
export type StoryMediaType = Extract<MediaType, 'image' | 'video'>;

export interface Story {
  id: string;
  profile_id: string;
  media_url: string;
  media_type: StoryMediaType;
  created_at: string;
  expires_at: string;
}

// Shared embed fragment for an active story joined with its author, same
// shared-select-fragment convention as PROFILE_SUMMARY_SELECT/
// PROFILE_HIGHLIGHTS_SELECT. No FK hint needed: stories has exactly one FK
// (to profiles), so there's no second relationship path for PostgREST to
// find ambiguous the way profile_highlights's two FKs were (see
// CONVENTIONS.md) -- confirmed via generate_typescript_types, not assumed.
export const STORIES_SELECT =
  'id, profile_id, media_url, media_type, created_at, expires_at, profiles ( id, username, display_name, avatar_url )';

export interface StoryFeedRow extends Story {
  profiles: ProfileSummary;
}

// Stories grouped by author (Phase 7) -- derived client-side from a flat
// query result, same "no dedicated grouping query, group in a Map" pattern
// messages.ts's listConversations() already established for conversations.
// stories is ordered oldest-first within a group so the viewer advances
// chronologically.
export interface StoryGroup {
  profile: ProfileSummary;
  stories: Story[];
}

export interface Message {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  read_at: string | null;
  created_at: string;
}

// A derived conversation (Phase 5a) — messages has no conversation_id; this is
// grouped client-side by "other participant" from src/lib/messages.ts. See
// CONVENTIONS.md for why (no group chat in the roadmap, 1:1 DMs only).
export interface ConversationSummary {
  otherProfile: ProfileSummary;
  lastMessage: { content: string; senderId: string; createdAt: string };
  unreadCount: number;
}

// Full profile with joined data, used in profile views.
// Shape matches the select query: profile_instruments(skill_level, instruments(id, name))
export interface FullProfile extends Profile {
  profile_instruments: { skill_level: ExperienceLevel; instruments: Instrument }[];
  profile_genres: { genre_id: number; genres: Genre }[];
  profile_highlights: HighlightPostRow[];
}

export interface PostAuthor {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

// Feed row shape. Shape matches the select query:
// profiles(username, display_name, avatar_url), likes(user_id), comments(id)
export interface FeedPostRow extends MediaPost {
  profiles: PostAuthor;
  likes: { user_id: string }[];
  comments: { id: string }[];
}

// Post detail row shape — same as FeedPostRow but with full comment rows
// (each comment joined with its author) instead of just comment ids.
export interface PostDetailRow extends MediaPost {
  profiles: PostAuthor;
  likes: { user_id: string }[];
  comments: (Comment & { profiles: PostAuthor })[];
}
