import { View, Text, Image, ScrollView } from 'react-native';
import type { ReactNode } from 'react';
import { AVAILABILITY_STATUSES, type FullProfile } from '../lib/types';
import AudioPlayer from './AudioPlayer';
import Avatar from './Avatar';
import VideoPlayerBlock from './VideoPlayerBlock';

const AVAILABILITY_LABELS = Object.fromEntries(
  AVAILABILITY_STATUSES.map((s) => [s.value, s.label])
);

export default function ProfileBody({
  profile,
  actionSlot,
}: {
  profile: FullProfile;
  /** Rendered in the header, below the experience badge — e.g. PublicProfileScreen's connect button. */
  actionSlot?: ReactNode;
}) {
  const instruments = profile.profile_instruments;
  const genres = profile.profile_genres;
  const availability = profile.availability_statuses;

  return (
    <ScrollView className="flex-1 bg-white" contentContainerClassName="pb-10">
      {/* Header */}
      <View className="items-center pt-10 pb-6 px-6 border-b border-gray-100">
        <Avatar
          uri={profile.avatar_url}
          name={profile.display_name ?? profile.username}
          size="xl"
          className="mb-3"
        />
        <Text className="text-xl font-bold text-gray-900">
          {profile.display_name ?? profile.username}
        </Text>
        <Text className="text-sm text-gray-500">@{profile.username}</Text>
        {(profile.location_city || profile.location_state) && (
          <Text className="text-sm text-gray-400 mt-1">
            📍 {[profile.location_city, profile.location_state].filter(Boolean).join(', ')}
          </Text>
        )}
        {profile.experience_level && (
          <View className="mt-2 px-3 py-1 rounded-full bg-purple-100">
            <Text className="text-brand-primary text-xs font-semibold capitalize">
              {profile.experience_level}
            </Text>
          </View>
        )}
        {actionSlot && <View className="mt-4">{actionSlot}</View>}
      </View>

      {/* Availability — only shown when set, no empty state (noise on a profile that hasn't set it) */}
      {availability.length > 0 && (
        <View className="px-6 py-4 border-b border-gray-100">
          <View className="flex-row flex-wrap gap-1.5">
            {availability.map((status) => (
              <View key={status} className="px-2.5 py-1 rounded-full bg-green-50 border border-green-200">
                <Text className="text-green-700 text-xs font-medium">{AVAILABILITY_LABELS[status]}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Intro Media */}
      {profile.intro_media_url && (
        <View className="px-6 py-6 border-b border-gray-100">
          <Text className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
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
        <View className="px-6 py-6 border-b border-gray-100">
          <Text className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            About
          </Text>
          <Text className="text-base text-gray-700 leading-relaxed">{profile.bio}</Text>
        </View>
      )}

      {/* Instruments */}
      {instruments.length > 0 && (
        <View className="px-6 py-6 border-b border-gray-100">
          <Text className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Instruments
          </Text>
          {instruments.map((pi) => (
            <View key={pi.instruments.id} className="flex-row items-center justify-between py-1.5">
              <Text className="text-base text-gray-800 font-medium">{pi.instruments.name}</Text>
              <View className="px-2 py-0.5 rounded-full bg-gray-100">
                <Text className="text-xs text-gray-500 capitalize">{pi.skill_level}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Genres */}
      {genres.length > 0 && (
        <View className="px-6 py-6">
          <Text className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Genres
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {genres.map((pg) => (
              <View
                key={pg.genres.id}
                className="px-3 py-1.5 rounded-full bg-purple-50 border border-purple-200"
              >
                <Text className="text-brand-primary text-sm font-medium">{pg.genres.name}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}
