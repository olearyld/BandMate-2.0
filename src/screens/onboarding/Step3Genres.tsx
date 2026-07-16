import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import type { Genre } from '../../lib/types';
import type { OnboardingStackParamList } from '../../navigation/types';
import { useOnboarding } from '../../navigation/OnboardingContext';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Step3'>;

export default function Step3Genres({ navigation }: Props) {
  const { draft, setDraft } = useOnboarding();
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selected, setSelected] = useState<Set<number>>(
    new Set(draft.genres ?? [])
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data, error: err } = await supabase.from('genres').select('*').order('name');
      if (err) setError(err.message);
      else setGenres(data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleNext() {
    if (selected.size === 0) {
      setError('Pick at least one genre.');
      return;
    }
    setError(null);
    setDraft({ ...draft, genres: Array.from(selected) });
    navigation.navigate('Step4');
  }

  if (loading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#6C47FF" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <ScrollView contentContainerClassName="px-6 py-10 pb-32">
        <Text className="text-xs font-semibold text-brand-primary mb-1 tracking-widest uppercase">
          Step 3 of 4
        </Text>
        <Text className="text-2xl font-bold text-gray-900 mb-1">Your genres</Text>
        <Text className="text-sm text-gray-500 mb-6">
          What kind of music are you into? Pick all that apply.
        </Text>

        {error && (
          <View className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            <Text className="text-red-700 text-sm">{error}</Text>
          </View>
        )}

        <View className="flex-row flex-wrap gap-2">
          {genres.map((genre) => {
            const isSelected = selected.has(genre.id);
            return (
              <TouchableOpacity
                key={genre.id}
                className={`px-4 py-2 rounded-full border ${
                  isSelected
                    ? 'bg-brand-primary border-brand-primary'
                    : 'border-gray-300 bg-white'
                }`}
                onPress={() => toggle(genre.id)}
              >
                <Text
                  className={`font-medium text-sm ${
                    isSelected ? 'text-white' : 'text-gray-700'
                  }`}
                >
                  {genre.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 px-6 py-4 bg-white border-t border-gray-100">
        <TouchableOpacity
          className="bg-brand-primary rounded-lg py-4 items-center"
          onPress={handleNext}
        >
          <Text className="text-white font-semibold text-base">Next →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
