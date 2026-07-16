import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import { pickImage, pickVideo, useMediaRecorder, uploadPostMedia, type PickedMedia } from '../lib/mediaUpload';
import { useAppContext } from '../navigation/AppContext';
import type { MainStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<MainStackParamList, 'CreatePost'>;

export default function CreatePostScreen({ navigation }: Props) {
  const { session } = useAppContext();
  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [caption, setCaption] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const { isRecording, start: startRecording, stop: stopRecording } = useMediaRecorder();
  const [saving, setSaving] = useState(false);
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
      const picked = await pickVideo();
      if (picked) setMedia(picked);
    } catch (e: any) {
      Alert.alert(e.message?.includes('60 seconds') ? 'Too long' : 'Permission needed', e.message);
    }
  }

  async function handleStartRecording() {
    try {
      await startRecording();
    } catch (e: any) {
      Alert.alert('Permission needed', e.message);
    }
  }

  async function handleStopRecording() {
    const recorded = await stopRecording();
    if (recorded) setMedia(recorded);
  }

  async function handlePost() {
    setError(null);
    if (!media) {
      setError('Add a photo, video, or audio clip to post.');
      return;
    }
    const userId = session?.user.id;
    if (!userId) {
      setError('Not authenticated.');
      return;
    }

    setSaving(true);
    try {
      const uploaded = await uploadPostMedia(userId, media);
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

      const { error: insertError } = await supabase.from('media_posts').insert({
        profile_id: userId,
        media_url: uploaded.url,
        media_type: media.type,
        thumbnail_url: uploaded.thumbnailUrl,
        caption: caption.trim() || null,
        tags: tags.length > 0 ? tags : null,
      });
      if (insertError) throw insertError;

      navigation.goBack();
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong.');
      setSaving(false);
    }
  }

  return (
    <View className="flex-1 bg-white">
      <ScrollView contentContainerClassName="px-6 py-6 pb-32">
        {error && (
          <View className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            <Text className="text-red-700 text-sm">{error}</Text>
          </View>
        )}

        <Text className="text-sm font-medium text-gray-700 mb-3">Media</Text>

        {media && media.type === 'image' && (
          <Image source={{ uri: media.uri }} className="w-full h-56 rounded-xl mb-4" resizeMode="cover" />
        )}
        {media && media.type !== 'image' && (
          <View className="bg-gray-100 rounded-xl p-4 mb-4 items-center">
            <Text className="text-gray-600 font-medium">
              {media.type === 'audio' ? '🎵 Audio clip recorded' : '🎬 Video selected'}
            </Text>
            <TouchableOpacity onPress={() => setMedia(null)}>
              <Text className="text-brand-secondary text-sm mt-1">Remove</Text>
            </TouchableOpacity>
          </View>
        )}

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
          <TouchableOpacity
            className={`flex-1 border rounded-lg py-3 items-center ${isRecording ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
            onPress={isRecording ? handleStopRecording : handleStartRecording}
          >
            <Text className="text-2xl mb-1">{isRecording ? '⏹' : '🎙'}</Text>
            <Text className={`text-xs font-medium ${isRecording ? 'text-red-600' : 'text-gray-600'}`}>
              {isRecording ? 'Stop' : 'Record'}
            </Text>
          </TouchableOpacity>
        </View>
        <Text className="text-xs text-gray-400 text-center mb-6">
          Videos and audio clips are capped at 60 seconds.
        </Text>

        <Text className="text-sm font-medium text-gray-700 mb-1">Caption</Text>
        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 text-base text-gray-900 mb-6"
          placeholder="Say something about this..."
          placeholderTextColor="#9CA3AF"
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          value={caption}
          onChangeText={setCaption}
          style={{ minHeight: 72 }}
        />

        <Text className="text-sm font-medium text-gray-700 mb-1">Tags</Text>
        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 text-base text-gray-900"
          placeholder="rock, jam, guitar"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          value={tagsInput}
          onChangeText={setTagsInput}
        />
        <Text className="text-xs text-gray-400 mt-1">Comma-separated.</Text>
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 px-6 py-4 bg-white border-t border-gray-100">
        <TouchableOpacity
          className="bg-brand-primary rounded-lg py-4 items-center"
          onPress={handlePost}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white font-semibold text-base">Post</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
