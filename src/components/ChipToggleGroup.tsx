import type { Dispatch, SetStateAction } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

/** Toggles `value`'s membership in a Set, for use as an onPress handler factory. */
export function toggleInSet<T>(setter: Dispatch<SetStateAction<Set<T>>>) {
  return (value: T) => {
    setter((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  };
}

/**
 * Shared pill-toggle layout for a flat list of selectable options — genres,
 * availability (MyProfileScreen's edit form), instruments/genres filters
 * (DiscoverScreen). Promoted out of MyProfileScreen (Phase 3) once a second
 * screen needed the identical pattern (Phase 4b) — see CONVENTIONS.md's
 * "no duplicate implementations" rule.
 */
export default function ChipToggleGroup<T>({
  items,
  getKey,
  getLabel,
  isSelected,
  onToggle,
}: {
  items: T[];
  getKey: (item: T) => string | number;
  getLabel: (item: T) => string;
  isSelected: (item: T) => boolean;
  onToggle: (item: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {items.map((item) => {
        const isSel = isSelected(item);
        return (
          <TouchableOpacity
            key={getKey(item)}
            className={`px-4 py-2 rounded-full border ${isSel ? 'bg-brand-primary border-brand-primary' : 'border-gray-300'}`}
            onPress={() => onToggle(item)}
          >
            <Text className={`text-sm font-medium ${isSel ? 'text-white' : 'text-gray-700'}`}>
              {getLabel(item)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
