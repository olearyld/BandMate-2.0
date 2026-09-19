import { useState, type Dispatch, type SetStateAction } from 'react';
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
  maxVisible,
  expanded: expandedProp,
}: {
  items: T[];
  getKey: (item: T) => string | number;
  getLabel: (item: T) => string;
  isSelected: (item: T) => boolean;
  onToggle: (item: T) => void;
  /** Collapse to this many items. Omit to always show every item (the
   * original, unaffected behavior — MyProfileScreen's edit form and
   * onboarding's Step2Instruments don't pass this and aren't affected by
   * it; only DiscoverScreen's filters do). */
  maxVisible?: number;
  /** Controlled expand state — pass this (with the caller owning its own
   * useState) to render an Expand/Collapse control elsewhere, e.g. next to
   * the section's own label instead of below the chips. Omit to fall back
   * to an uncontrolled internal toggle rendered below the chips. */
  expanded?: boolean;
}) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const controlled = expandedProp != null;
  const expanded = controlled ? expandedProp : internalExpanded;
  const collapsible = maxVisible != null && items.length > maxVisible;
  const visibleItems = collapsible && !expanded ? items.slice(0, maxVisible) : items;

  return (
    <View>
      <View className="flex-row flex-wrap gap-2">
        {visibleItems.map((item) => {
          const isSel = isSelected(item);
          return (
            <TouchableOpacity
              key={getKey(item)}
              className={`px-4 py-1.5 rounded-full border ${isSel ? 'bg-accent border-accent' : 'border-border'}`}
              onPress={() => onToggle(item)}
            >
              <Text className={`text-sm font-medium ${isSel ? 'text-on-accent' : 'text-foreground-secondary'}`}>
                {getLabel(item)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {collapsible && !controlled && (
        <TouchableOpacity onPress={() => setInternalExpanded((e) => !e)} className="self-end mt-2">
          <Text className="text-accent text-xs font-semibold">{expanded ? 'Collapse' : 'Expand'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
