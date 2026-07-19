import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { SKILL_LEVELS, type Instrument, type ExperienceLevel } from '../../lib/types';
import type { OnboardingStackParamList } from '../../navigation/types';
import { useOnboarding } from '../../navigation/OnboardingContext';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Step2'>;

export default function Step2Instruments({ navigation }: Props) {
  const { draft, setDraft } = useOnboarding();
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [selected, setSelected] = useState<Record<number, ExperienceLevel>>(
    draft.instruments ?? {}
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data, error: err } = await supabase.from('instruments').select('*').order('name');
      if (err) setError(err.message);
      else setInstruments(data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  function toggleInstrument(id: number) {
    setSelected((prev) => {
      if (id in prev) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: 'beginner' };
    });
  }

  function setSkill(id: number, level: ExperienceLevel) {
    setSelected((prev) => ({ ...prev, [id]: level }));
  }

  function handleNext() {
    if (Object.keys(selected).length === 0) {
      setError('Pick at least one instrument.');
      return;
    }
    setError(null);
    setDraft({ ...draft, instruments: selected });
    navigation.navigate('Step3');
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
          Step 2 of 4
        </Text>
        <Text className="text-2xl font-bold text-gray-900 mb-1">Your instruments</Text>
        <Text className="text-sm text-gray-500 mb-6">
          Select everything you play and your skill level for each.
        </Text>

        {error && (
          <View className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            <Text className="text-red-700 text-sm">{error}</Text>
          </View>
        )}

        {instruments.map((inst) => {
          const isSelected = inst.id in selected;
          return (
            <View key={inst.id} className="mb-3">
              <TouchableOpacity
                className={`border rounded-lg px-4 py-3 flex-row items-center justify-between ${
                  isSelected ? 'border-brand-primary bg-purple-50' : 'border-gray-200'
                }`}
                onPress={() => toggleInstrument(inst.id)}
              >
                <Text
                  className={`font-medium ${isSelected ? 'text-brand-primary' : 'text-gray-700'}`}
                >
                  {inst.name}
                </Text>
                <Text className="text-lg">{isSelected ? '✓' : '+'}</Text>
              </TouchableOpacity>

              {isSelected && (
                <View className="flex-row mt-2 gap-2">
                  {SKILL_LEVELS.map((sl) => (
                    <TouchableOpacity
                      key={sl.value}
                      className={`flex-1 py-1.5 rounded-full border items-center ${
                        selected[inst.id] === sl.value
                          ? 'bg-brand-primary border-brand-primary'
                          : 'border-gray-300'
                      }`}
                      onPress={() => setSkill(inst.id, sl.value)}
                    >
                      <Text
                        className={`text-xs font-medium ${
                          selected[inst.id] === sl.value ? 'text-white' : 'text-gray-600'
                        }`}
                      >
                        {sl.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          );
        })}
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
