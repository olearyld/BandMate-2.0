import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { supabase } from '../lib/supabase';
import type { City } from '../lib/types';

export interface CityPickerValue {
  city: string | null;
  state: string | null;
  cityId: string | null;
}

/**
 * Searchable city picker backed by the `cities` reference table, with a
 * free-text fallback ("my city isn't listed") for anyone not in it yet.
 * Used by onboarding (Step1BasicInfo) and My Profile's edit form — the two
 * places location is settable. Starts in fallback mode if the incoming
 * value already has city/state text but no resolved cityId (an existing
 * unmatched location), since that's what it actually is.
 */
export default function CityPicker({
  value,
  onChange,
}: {
  value: CityPickerValue;
  onChange: (next: CityPickerValue) => void;
}) {
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [fallback, setFallback] = useState(!value.cityId && !!(value.city || value.state));

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('cities').select('*').order('city');
      setCities(data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  const selectedCity = value.cityId ? cities.find((c) => c.id === value.cityId) ?? null : null;

  const filtered = query.trim()
    ? cities.filter((c) => `${c.city}, ${c.state}`.toLowerCase().includes(query.trim().toLowerCase()))
    : cities;

  function selectCity(c: City) {
    setQuery('');
    onChange({ city: c.city, state: c.state, cityId: c.id });
  }

  function useFallback() {
    setFallback(true);
    onChange({ city: value.city, state: value.state, cityId: null });
  }

  function backToPicker() {
    setFallback(false);
    onChange({ city: null, state: null, cityId: null });
  }

  if (fallback) {
    return (
      <View>
        <Text className="text-sm font-medium text-gray-700 mb-1">City</Text>
        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 text-base text-gray-900 mb-4"
          placeholder="e.g. Austin"
          placeholderTextColor="#9CA3AF"
          value={value.city ?? ''}
          onChangeText={(t) => onChange({ city: t, state: value.state, cityId: null })}
        />
        <Text className="text-sm font-medium text-gray-700 mb-1">State</Text>
        <TextInput
          className="border border-gray-300 rounded-lg px-4 py-3 text-base text-gray-900 mb-2"
          placeholder="e.g. TX"
          placeholderTextColor="#9CA3AF"
          value={value.state ?? ''}
          onChangeText={(t) => onChange({ city: value.city, state: t, cityId: null })}
        />
        <TouchableOpacity onPress={backToPicker}>
          <Text className="text-brand-secondary text-sm mb-4">Search cities instead</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) {
    return (
      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 mb-1">City</Text>
        <ActivityIndicator color="#6C47FF" />
      </View>
    );
  }

  if (selectedCity) {
    return (
      <View className="mb-4">
        <Text className="text-sm font-medium text-gray-700 mb-1">City</Text>
        <View className="border border-brand-primary bg-purple-50 rounded-lg px-4 py-3 flex-row items-center justify-between">
          <Text className="font-medium text-brand-primary">
            {selectedCity.city}, {selectedCity.state}
          </Text>
          <TouchableOpacity onPress={() => onChange({ city: null, state: null, cityId: null })}>
            <Text className="text-brand-secondary text-sm">Change</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View className="mb-4">
      <Text className="text-sm font-medium text-gray-700 mb-1">City</Text>
      <TextInput
        className="border border-gray-300 rounded-lg px-4 py-3 text-base text-gray-900 mb-2"
        placeholder="Search for your city..."
        placeholderTextColor="#9CA3AF"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="words"
      />
      <View className="border border-gray-200 rounded-lg max-h-48">
        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {filtered.length === 0 ? (
            <View className="px-4 py-3">
              <Text className="text-sm text-gray-500">No matching cities.</Text>
            </View>
          ) : (
            filtered.map((c) => (
              <TouchableOpacity
                key={c.id}
                className="px-4 py-3 border-b border-gray-100"
                onPress={() => selectCity(c)}
              >
                <Text className="text-gray-900">
                  {c.city}, {c.state}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </View>
      <TouchableOpacity onPress={useFallback} className="mt-2">
        <Text className="text-brand-secondary text-sm">My city isn't listed</Text>
      </TouchableOpacity>
    </View>
  );
}
