import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableWithoutFeedback, TouchableOpacity, Image } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEventListener } from 'expo';
import type { MainStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<MainStackParamList, 'StoryViewer'>;

const IMAGE_DURATION_MS = 5000;

/**
 * Full-screen tap/swipe-to-advance story viewer (Phase 7), modal-presented
 * (see RootNavigator, same precedent as CreatePost). Left/right screen-half
 * taps step through the current author's stories oldest-to-newest, falling
 * through to the next/previous author's group at either end; advancing past
 * the very last story of the very last group closes the viewer.
 */
export default function StoryViewerScreen({ route, navigation }: Props) {
  const { groups, startIndex } = route.params;
  const [groupIndex, setGroupIndex] = useState(startIndex);
  const [storyIndex, setStoryIndex] = useState(0);

  const group = groups[groupIndex];
  const story = group?.stories[storyIndex];

  const advance = useCallback(() => {
    if (storyIndex < group.stories.length - 1) {
      setStoryIndex(storyIndex + 1);
      return;
    }
    if (groupIndex < groups.length - 1) {
      setGroupIndex(groupIndex + 1);
      setStoryIndex(0);
      return;
    }
    navigation.goBack();
  }, [group, groupIndex, storyIndex, groups, navigation]);

  const goBack = useCallback(() => {
    if (storyIndex > 0) {
      setStoryIndex(storyIndex - 1);
      return;
    }
    if (groupIndex > 0) {
      setGroupIndex(groupIndex - 1);
      setStoryIndex(groups[groupIndex - 1].stories.length - 1);
    }
    // First story of the first group: tap-back is a no-op, not a dismiss --
    // matches how tap-forward on the very last story closes explicitly
    // rather than the two directions being asymmetric by accident.
  }, [storyIndex, groupIndex, groups]);

  useEffect(() => {
    if (!story || story.media_type !== 'image') return;
    const timer = setTimeout(advance, IMAGE_DURATION_MS);
    return () => clearTimeout(timer);
  }, [story, advance]);

  if (!group || !story) return null;

  return (
    <View className="flex-1 bg-black">
      {story.media_type === 'image' ? (
        <Image source={{ uri: story.media_url }} className="flex-1" resizeMode="contain" />
      ) : (
        <StoryVideo uri={story.media_url} onEnd={advance} />
      )}

      <View className="absolute inset-0 flex-row">
        <TouchableWithoutFeedback onPress={goBack}>
          <View className="flex-1" />
        </TouchableWithoutFeedback>
        <TouchableWithoutFeedback onPress={advance}>
          <View className="flex-1" />
        </TouchableWithoutFeedback>
      </View>

      <View className="absolute top-3 left-3 right-3 flex-row gap-1 z-10">
        {group.stories.map((s, i) => (
          <View
            key={s.id}
            className={`flex-1 h-0.5 rounded-full ${i <= storyIndex ? 'bg-white' : 'bg-white/30'}`}
          />
        ))}
      </View>

      <View className="absolute top-8 left-4 right-4 flex-row items-center z-10">
        <Text className="text-white font-semibold flex-1" numberOfLines={1}>
          {group.profile.display_name ?? group.profile.username}
        </Text>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Text className="text-white text-2xl leading-none">✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function StoryVideo({ uri, onEnd }: { uri: string; onEnd: () => void }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  useEventListener(player, 'playToEnd', onEnd);
  return (
    <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls={false} />
  );
}
