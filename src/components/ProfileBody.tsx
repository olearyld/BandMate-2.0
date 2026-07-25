import { View, Text, Image, ScrollView, TouchableOpacity } from 'react-native';
import type { ReactNode } from 'react';
import { AVAILABILITY_STATUSES, type FullProfile, type MediaType } from '../lib/types';
import AudioPlayer from './AudioPlayer';
import Avatar from './Avatar';
import VideoPlayerBlock from './VideoPlayerBlock';

const AVAILABILITY_LABELS = Object.fromEntries(
  AVAILABILITY_STATUSES.map((s) => [s.value, s.label])
);

/** A small square thumbnail for a highlighted post — used both by the read-only
 * reel here and by MyProfileScreen's manage panel, so the media-type-specific
 * rendering (image/video-with-play-icon/audio-icon) lives in one place. */
export function HighlightThumb({
  post,
}: {
  post: { media_url: string; media_type: MediaType; thumbnail_url: string | null };
}) {
  if (post.media_type === 'image') {
    return <Image source={{ uri: post.media_url }} className="w-full h-full" resizeMode="cover" />;
  }
  if (post.media_type === 'video') {
    return (
      <View className="w-full h-full bg-gray-900 items-center justify-center">
        {post.thumbnail_url ? (
          <Image source={{ uri: post.thumbnail_url }} className="w-full h-full absolute" resizeMode="cover" />
        ) : null}
        <Text className="text-white text-lg">▶</Text>
      </View>
    );
  }
  return (
    <View className="w-full h-full bg-accent-subtle items-center justify-center">
      <Text className="text-lg">🎵</Text>
    </View>
  );
}

export default function ProfileBody({
  profile,
  actionSlot,
  onManageHighlights,
}: {
  profile: FullProfile;
  /** Rendered in the header, below the experience badge — e.g. PublicProfileScreen's connect button. */
  actionSlot?: ReactNode;
  /** Owner-only "Manage" affordance on the Highlights section — omitted entirely for a viewer. */
  onManageHighlights?: () => void;
}) {
  const instruments = profile.profile_instruments;
  const genres = profile.profile_genres;
  const availability = profile.availability_statuses;
  const highlights = profile.profile_highlights;

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pb-10">
      {/* Header */}
      <View className="items-center pt-10 pb-6 px-6 border-b border-border-subtle">
        <Avatar
          uri={profile.avatar_url}
          name={profile.display_name ?? profile.username}
          size="xl"
          className="mb-3"
        />
        <Text className="text-xl font-bold text-foreground">
          {profile.display_name ?? profile.username}
        </Text>
        <Text className="text-sm text-foreground-tertiary">@{profile.username}</Text>
        {(profile.location_city || profile.location_state) && (
          <Text className="text-sm text-foreground-muted mt-1">
            📍 {[profile.location_city, profile.location_state].filter(Boolean).join(', ')}
          </Text>
        )}
        {profile.experience_level && (
          <View className="mt-2 px-3 py-1 rounded-full bg-accent-subtle">
            <Text className="text-accent text-xs font-semibold capitalize">
              {profile.experience_level}
            </Text>
          </View>
        )}
        {actionSlot && <View className="mt-4">{actionSlot}</View>}
      </View>

      {/* Highlights — shown for a viewer only when non-empty (no empty state,
          same convention as Availability below); shown for the owner
          (onManageHighlights present) even when empty, so the manage
          affordance is discoverable. */}
      {(highlights.length > 0 || onManageHighlights) && (
        <View className="px-6 py-6 border-b border-border-subtle">
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-sm font-semibold text-foreground-tertiary uppercase tracking-wide">
              Highlights
            </Text>
            {onManageHighlights && (
              <TouchableOpacity onPress={onManageHighlights}>
                <Text className="text-accent text-xs font-semibold">Manage</Text>
              </TouchableOpacity>
            )}
          </View>
          {highlights.length === 0 ? (
            <Text className="text-sm text-foreground-muted">No highlights yet.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-3">
                {highlights.map((h) => (
                  <View key={h.post_id} className="w-24 h-24 rounded-xl overflow-hidden bg-surface-alt">
                    <HighlightThumb post={h.media_posts} />
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
        </View>
      )}

      {/* Availability — only shown when set, no empty state (noise on a profile that hasn't set it) */}
      {availability.length > 0 && (
        <View className="px-6 py-4 border-b border-border-subtle">
          <View className="flex-row flex-wrap gap-1.5">
            {availability.map((status) => (
              <View key={status} className="px-2.5 py-1 rounded-full bg-success-subtle border border-success-line">
                <Text className="text-success text-xs font-medium">{AVAILABILITY_LABELS[status]}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Intro Media */}
      {profile.intro_media_url && (
        <View className="px-6 py-6 border-b border-border-subtle">
          <Text className="text-sm font-semibold text-foreground-tertiary uppercase tracking-wide mb-3">
            Intro
          </Text>
          {profile.intro_media_type === 'image' && (
            <Image
              source={{ uri: profile.intro_media_url }}
              className="w-full h-64 rounded-xl"
              resizeMode="cover"
            />
          )}
          {profile.intro_media_type === 'video' && (
            <VideoPlayerBlock uri={profile.intro_media_url} />
          )}
          {profile.intro_media_type === 'audio' && (
            <AudioPlayer uri={profile.intro_media_url} />
          )}
        </View>
      )}

      {/* Bio */}
      {profile.bio && (
        <View className="px-6 py-6 border-b border-border-subtle">
          <Text className="text-sm font-semibold text-foreground-tertiary uppercase tracking-wide mb-2">
            About
          </Text>
          <Text className="text-base text-foreground-secondary leading-relaxed">{profile.bio}</Text>
        </View>
      )}

      {/* Instruments */}
      {instruments.length > 0 && (
        <View className="px-6 py-6 border-b border-border-subtle">
          <Text className="text-sm font-semibold text-foreground-tertiary uppercase tracking-wide mb-3">
            Instruments
          </Text>
          {instruments.map((pi) => (
            <View key={pi.instruments.id} className="flex-row items-center justify-between py-1.5">
              <Text className="text-base text-foreground font-medium">{pi.instruments.name}</Text>
              <View className="px-2 py-0.5 rounded-full bg-surface-alt">
                <Text className="text-xs text-foreground-tertiary capitalize">{pi.skill_level}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Genres */}
      {genres.length > 0 && (
        <View className="px-6 py-6">
          <Text className="text-sm font-semibold text-foreground-tertiary uppercase tracking-wide mb-3">
            Genres
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {genres.map((pg) => (
              <View
                key={pg.genres.id}
                className="px-3 py-1.5 rounded-full bg-accent-subtle border border-accent-line"
              >
                <Text className="text-accent text-sm font-medium">{pg.genres.name}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}
