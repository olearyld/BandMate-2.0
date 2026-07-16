import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useVideoPlayer, VideoView } from 'expo-video';
import { supabase } from '../../lib/supabase';
import type { FullProfile } from '../../lib/types';
import type { MainStackParamList } from '../../navigation/types';
import AudioPlayer from '../../components/AudioPlayer';

type Props = NativeStackScreenProps<MainStackParamList, 'PublicProfile'>;

export default function PublicProfileScreen({ route }: Props) {
  const { profileId } = route.params;
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data, error: err } = await supabase
        .from('profiles')
        .select(`
          *,
          profile_instruments(skill_level, instruments(id, name)),
          profile_genres(genre_id, genres(id, name))
        `)
        .eq('id', profileId)
        .returns<FullProfile>()
        .single();
      if (err) setError(err.message);
      else setProfile(data);
      setLoading(false);
    }
    load();
  }, [profileId]);

  if (loading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#6C47FF" />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-6">
        <Text className="text-red-600 text-center">{error ?? 'Profile not found.'}</Text>
      </View>
    );
  }

  return <ProfileBody profile={profile} />;
}

export function ProfileBody({ profile }: { profile: FullProfile }) {
  const instruments = profile.profile_instruments;
  const genres = profile.profile_genres;

  return (
    <ScrollView className="flex-1 bg-white" contentContainerClassName="pb-10">
      {/* Header */}
      <View className="items-center pt-10 pb-6 px-6 border-b border-gray-100">
        {profile.avatar_url ? (
          <Image
            source={{ uri: profile.avatar_url }}
            className="w-24 h-24 rounded-full mb-3"
          />
        ) : (
          <View className="w-24 h-24 rounded-full bg-brand-primary items-center justify-center mb-3">
            <Text className="text-white text-3xl font-bold">
              {(profile.display_name ?? profile.username)[0].toUpperCase()}
            </Text>
          </View>
        )}
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
      </View>

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

export function VideoPlayerBlock({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return (
    <VideoView
      player={player}
      style={{ width: '100%', height: 240, borderRadius: 12 }}
      nativeControls
    />
  );
}
