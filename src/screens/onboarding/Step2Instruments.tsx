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
import { useTheme } from '../../theme/ThemeProvider';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Step2'>;

export default function Step2Instruments({ navigation }: Props) {
  const { colors } = useTheme();
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
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerClassName="px-6 py-10 pb-32">
        <Text className="text-xs font-semibold text-accent mb-1 tracking-widest uppercase">
          Step 2 of 4
        </Text>
        <Text className="text-2xl font-bold text-foreground mb-1">Your instruments</Text>
        <Text className="text-sm text-foreground-tertiary mb-6">
          Select everything you play and your skill level for each.
        </Text>

        {error && (
          <View className="bg-danger-subtle border border-danger-line rounded-lg px-4 py-3 mb-4">
            <Text className="text-danger text-sm">{error}</Text>
          </View>
        )}

        {instruments.map((inst) => {
          const isSelected = inst.id in selected;
          return (
            <View key={inst.id} className="mb-3">
              <TouchableOpacity
                className={`border rounded-lg px-4 py-3 flex-row items-center justify-between ${
                  isSelected ? 'border-accent bg-accent-subtle' : 'border-border-subtle'
                }`}
                onPress={() => toggleInstrument(inst.id)}
              >
                <Text
                  className={`font-medium ${isSelected ? 'text-accent' : 'text-foreground-secondary'}`}
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
                          ? 'bg-accent border-accent'
                          : 'border-border'
                      }`}
                      onPress={() => setSkill(inst.id, sl.value)}
                    >
                      <Text
                        className={`text-xs font-medium ${
                          selected[inst.id] === sl.value ? 'text-on-accent' : 'text-foreground-secondary'
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

      <View className="absolute bottom-0 left-0 right-0 px-6 py-4 bg-surface border-t border-border-subtle">
        <TouchableOpacity
          className="bg-accent rounded-lg py-4 items-center"
          onPress={handleNext}
        >
          <Text className="text-on-accent font-semibold text-base">Next →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
