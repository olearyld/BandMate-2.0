import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Image, Alert } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  pickImage,
  pickVideo,
  MAX_STORY_VIDEO_DURATION_MS,
  type PickedMedia,
} from '../lib/mediaUpload';
import { postStory } from '../lib/stories';
import { useAppContext } from '../navigation/AppContext';
import type { MainStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<MainStackParamList, 'CreateStory'>;

// Story posting flow (Phase 7): reuses the existing picker/compression
// pipeline (mediaUpload.ts) with the shorter MAX_STORY_VIDEO_DURATION_MS
// cap, not a new picker. No caption/tags step -- the stories table has
// neither column, unlike media_posts.
export default function CreateStoryScreen({ navigation }: Props) {
  const { session } = useAppContext();
  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePickPhoto() {
    try {
      const picked = await pickImage();
      if (picked) setMedia(picked);
    } catch (e: any) {
      Alert.alert('Permission needed', e.message);
    }
  }

  async function handlePickVideo() {
    try {
      const picked = await pickVideo(MAX_STORY_VIDEO_DURATION_MS);
      if (picked) setMedia(picked);
    } catch (e: any) {
      Alert.alert(e.message?.includes('seconds') ? 'Too long' : 'Permission needed', e.message);
    }
  }

  async function handlePost() {
    if (!media) {
      setError('Add a photo or video to post.');
      return;
    }
    const profileId = session?.user.id;
    if (!profileId) {
      setError('Not authenticated.');
      return;
    }

    setError(null);
    setPosting(true);
    try {
      await postStory(profileId, media);
      navigation.goBack();
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong.');
      setPosting(false);
    }
  }

  return (
    <View className="flex-1 bg-white">
      <View className="flex-1 px-6 py-6">
        {error && (
          <View className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            <Text className="text-red-700 text-sm">{error}</Text>
          </View>
        )}

        <Text className="text-sm font-medium text-gray-700 mb-3">Your story</Text>

        {media && media.type === 'image' && (
          <Image source={{ uri: media.uri }} className="w-full h-96 rounded-xl mb-4" resizeMode="cover" />
        )}
        {media && media.type === 'video' && (
          <View className="bg-gray-100 rounded-xl p-4 mb-4 items-center h-96 justify-center">
            <Text className="text-gray-600 font-medium">🎬 Video selected</Text>
            <TouchableOpacity onPress={() => setMedia(null)} className="mt-2">
              <Text className="text-brand-secondary text-sm">Remove</Text>
            </TouchableOpacity>
          </View>
        )}

        {!media && (
          <View className="flex-row gap-3 mb-3">
            <TouchableOpacity
              className="flex-1 border border-gray-300 rounded-lg py-3 items-center"
              onPress={handlePickPhoto}
            >
              <Text className="text-2xl mb-1">📷</Text>
              <Text className="text-xs text-gray-600 font-medium">Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 border border-gray-300 rounded-lg py-3 items-center"
              onPress={handlePickVideo}
            >
              <Text className="text-2xl mb-1">🎬</Text>
              <Text className="text-xs text-gray-600 font-medium">Video</Text>
            </TouchableOpacity>
          </View>
        )}
        <Text className="text-xs text-gray-400 text-center">
          Videos are capped at {MAX_STORY_VIDEO_DURATION_MS / 1000} seconds. Visible for 24 hours.
        </Text>
      </View>

      <View className="px-6 py-4 bg-white border-t border-gray-100">
        <TouchableOpacity
          className="bg-brand-primary rounded-lg py-4 items-center"
          onPress={handlePost}
          disabled={posting || !media}
          style={{ opacity: !media ? 0.5 : 1 }}
        >
          {posting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white font-semibold text-base">Post story</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
