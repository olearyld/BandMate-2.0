import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import type { OnboardingStackParamList } from '../../navigation/types';
import { useOnboarding } from '../../navigation/OnboardingContext';
import CityPicker, { type CityPickerValue } from '../../components/CityPicker';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Step1'>;

export default function Step1BasicInfo({ navigation }: Props) {
  const { draft, setDraft } = useOnboarding();
  const [username, setUsername] = useState(draft.username ?? '');
  const [displayName, setDisplayName] = useState(draft.display_name ?? '');
  const [location, setLocation] = useState<CityPickerValue>({
    city: draft.location_city ?? null,
    state: draft.location_state ?? null,
    cityId: draft.matched_city_id ?? null,
  });
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function handleNext() {
    setError(null);
    const trimmed = username.trim().toLowerCase();
    if (!trimmed) { setError('Username is required.'); return; }
    if (!/^[a-z0-9_]{3,30}$/.test(trimmed)) {
      setError('Username must be 3–30 characters: letters, numbers, underscores only.');
      return;
    }
    setChecking(true);
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', trimmed)
      .maybeSingle();
    setChecking(false);
    if (data) { setError('That username is already taken.'); return; }

    setDraft({
      ...draft,
      username: trimmed,
      display_name: displayName.trim() || null,
      location_city: location.city?.trim() || null,
      location_state: location.state?.trim() || null,
      matched_city_id: location.cityId,
    });
    navigation.navigate('Step2');
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerClassName="px-6 py-10">
        <Text className="text-xs font-semibold text-brand-primary mb-1 tracking-widest uppercase">
          Step 1 of 4
        </Text>
        <Text className="text-2xl font-bold text-gray-900 mb-1">The basics</Text>
        <Text className="text-sm text-gray-500 mb-8">How should other musicians find you?</Text>

        {error && (
          <View className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            <Text className="text-red-700 text-sm">{error}</Text>
          </View>
        )}

        <Text className="text-sm font-medium text-gray-700 mb-1">
          Username <Text className="text-red-500">*</Text>
        </Text>
        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 text-base text-gray-900 mb-4"
          placeholder="e.g. jimi_rocks"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          value={username}
          onChangeText={setUsername}
        />

        <Text className="text-sm font-medium text-gray-700 mb-1">Display name</Text>
        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 text-base text-gray-900 mb-4"
          placeholder="e.g. Jimi Henderson"
          placeholderTextColor="#9CA3AF"
          value={displayName}
          onChangeText={setDisplayName}
        />

        <CityPicker value={location} onChange={setLocation} />

        <TouchableOpacity
          className="bg-brand-primary rounded-lg py-4 items-center"
          onPress={handleNext}
          disabled={checking}
        >
          {checking ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white font-semibold text-base">Next →</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
