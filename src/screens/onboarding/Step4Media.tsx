import { useState } from 'react';
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
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { pickImage, pickVideo, useMediaRecorder, uploadIntroMedia, type PickedMedia } from '../../lib/mediaUpload';
import type { OnboardingStackParamList } from '../../navigation/types';
import { useOnboarding } from '../../navigation/OnboardingContext';
import { useAppContext } from '../../navigation/AppContext';
import type { ExperienceLevel } from '../../lib/types';
import { useTheme } from '../../theme/ThemeProvider';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Step4'>;

export default function Step4Media(_props: Props) {
  const { colors } = useTheme();
  const { draft } = useOnboarding();
  const { refreshProfile } = useAppContext();
  const [bio, setBio] = useState(draft.bio ?? '');
  const [media, setMedia] = useState<PickedMedia | null>(
    draft.intro_media_uri && draft.intro_media_type
      ? { uri: draft.intro_media_uri, type: draft.intro_media_type }
      : null
  );
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

  async function handleSave() {
    setError(null);
    if (!draft.username) { setError('Missing profile data — please restart onboarding.'); return; }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      let introMediaUrl: string | null = null;
      let introMediaType = media?.type ?? null;

      if (media) {
        const uploaded = await uploadIntroMedia(user.id, media);
        introMediaUrl = uploaded.url;
      }

      // Create profile
      const { error: profileError } = await supabase.from('profiles').insert({
        id: user.id,
        username: draft.username,
        display_name: draft.display_name ?? null,
        location_city: draft.location_city ?? null,
        location_state: draft.location_state ?? null,
        matched_city_id: draft.matched_city_id ?? null,
        bio: bio.trim() || null,
        intro_media_url: introMediaUrl,
        intro_media_type: introMediaType,
      });
      if (profileError) throw profileError;

      // Insert instruments
      if (draft.instruments && Object.keys(draft.instruments).length > 0) {
        const rows = Object.entries(draft.instruments).map(([id, skill]) => ({
          profile_id: user.id,
          instrument_id: Number(id),
          skill_level: skill as ExperienceLevel,
        }));
        const { error: instrError } = await supabase.from('profile_instruments').insert(rows);
        if (instrError) throw instrError;
      }

      // Insert genres
      if (draft.genres && draft.genres.length > 0) {
        const rows = draft.genres.map((id) => ({ profile_id: user.id, genre_id: id }));
        const { error: genreError } = await supabase.from('profile_genres').insert(rows);
        if (genreError) throw genreError;
      }

      // Signal RootNavigator to re-check profile and switch to MainTabs
      await refreshProfile();
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong.');
      setSaving(false);
    }
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerClassName="px-6 py-10 pb-32">
        <Text className="text-xs font-semibold text-accent mb-1 tracking-widest uppercase">
          Step 4 of 4
        </Text>
        <Text className="text-2xl font-bold text-foreground mb-1">Your intro</Text>
        <Text className="text-sm text-foreground-tertiary mb-8">
          Write a short bio and share a photo, video, or audio clip so other musicians can get a feel for you.
        </Text>

        {error && (
          <View className="bg-danger-subtle border border-danger-line rounded-lg px-4 py-3 mb-4">
            <Text className="text-danger text-sm">{error}</Text>
          </View>
        )}

        <Text className="text-sm font-medium text-foreground-secondary mb-1">Bio</Text>
        <TextInput
          className="border border-border rounded-lg px-4 py-3 text-base text-foreground mb-6"
          placeholder="Tell other musicians about yourself..."
          placeholderTextColor={colors.foregroundMuted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          value={bio}
          onChangeText={setBio}
          style={{ minHeight: 96 }}
        />

        <Text className="text-sm font-medium text-foreground-secondary mb-3">Intro media (optional)</Text>

        {media && media.type === 'image' && (
          <Image source={{ uri: media.uri }} className="w-full h-48 rounded-xl mb-4" resizeMode="cover" />
        )}
        {media && media.type !== 'image' && (
          <View className="bg-surface-alt rounded-xl p-4 mb-4 items-center">
            <Text className="text-foreground-secondary font-medium">
              {media.type === 'audio' ? '🎵 Audio clip recorded' : '🎬 Video selected'}
            </Text>
            <TouchableOpacity onPress={() => setMedia(null)}>
              <Text className="text-accent text-sm mt-1">Remove</Text>
            </TouchableOpacity>
          </View>
        )}

        <View className="flex-row gap-3 mb-3">
          <TouchableOpacity
            className="flex-1 border border-border rounded-lg py-3 items-center"
            onPress={handlePickPhoto}
          >
            <Text className="text-2xl mb-1">📷</Text>
            <Text className="text-xs text-foreground-secondary font-medium">Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 border border-border rounded-lg py-3 items-center"
            onPress={handlePickVideo}
          >
            <Text className="text-2xl mb-1">🎬</Text>
            <Text className="text-xs text-foreground-secondary font-medium">Video</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className={`flex-1 border rounded-lg py-3 items-center ${isRecording ? 'border-danger-line bg-danger-subtle' : 'border-border'}`}
            onPress={isRecording ? handleStopRecording : handleStartRecording}
          >
            <Text className="text-2xl mb-1">{isRecording ? '⏹' : '🎙'}</Text>
            <Text className={`text-xs font-medium ${isRecording ? 'text-danger' : 'text-foreground-secondary'}`}>
              {isRecording ? 'Stop' : 'Record'}
            </Text>
          </TouchableOpacity>
        </View>
        <Text className="text-xs text-foreground-muted text-center">Videos and audio clips are capped at 60 seconds.</Text>
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 px-6 py-4 bg-surface border-t border-border-subtle">
        <TouchableOpacity
          className="bg-accent rounded-lg py-4 items-center"
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text className="text-on-accent font-semibold text-base">Create my profile ✓</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
