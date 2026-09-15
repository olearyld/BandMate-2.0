import { ScrollView, TouchableOpacity, View, Text } from 'react-native';
import Avatar from './Avatar';
import type { StoryGroup } from '../lib/types';

const TILE_WIDTH = 64;

/**
 * Horizontal tray atop Feed (Phase 7): a leading "add story" tile plus one
 * avatar per author with an active story. Tapping any author's tile
 * (including the current user's own, if they already posted one) opens the
 * full-screen viewer starting at that author -- no special-cased "view my
 * own story" affordance on the leading tile, it always opens the picker, to
 * avoid a second interaction pattern for the one-tile case.
 */
export default function StoriesTray({
  groups,
  currentUserId,
  onPressAdd,
  onPressGroup,
}: {
  groups: StoryGroup[];
  currentUserId: string | undefined;
  onPressAdd: () => void;
  onPressGroup: (index: number) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="pt-2 pb-4 border-b border-border-subtle"
      contentContainerClassName="px-4 gap-4"
    >
      <TouchableOpacity onPress={onPressAdd} className="items-center" style={{ width: TILE_WIDTH }}>
        <View className="w-14 h-14 rounded-full border-2 border-dashed border-border items-center justify-center">
          <Text className="text-2xl text-foreground-muted leading-none">+</Text>
        </View>
        <Text className="text-xs text-foreground-tertiary mt-1" numberOfLines={1}>
          Add story
        </Text>
      </TouchableOpacity>

      {groups.map((group, index) => (
        <TouchableOpacity
          key={group.profile.id}
          onPress={() => onPressGroup(index)}
          className="items-center"
          style={{ width: TILE_WIDTH }}
        >
          <View className="w-14 h-14 rounded-full border-2 border-accent p-0.5">
            <Avatar
              uri={group.profile.avatar_url}
              name={group.profile.display_name ?? group.profile.username}
              size="lg"
            />
          </View>
          <Text className="text-xs text-foreground-secondary mt-1" numberOfLines={1}>
            {group.profile.id === currentUserId
              ? 'You'
              : group.profile.display_name ?? group.profile.username}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
