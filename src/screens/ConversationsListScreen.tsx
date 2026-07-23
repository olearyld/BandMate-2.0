import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, FlatList } from 'react-native';
import { useFocusEffect, type CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainTabParamList, MainStackParamList } from '../navigation/types';
import type { ConversationSummary } from '../lib/types';
import { listConversations } from '../lib/messages';
import Avatar from '../components/Avatar';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Messages'>,
  NativeStackScreenProps<MainStackParamList>
>;

export default function ConversationsListScreen({ navigation }: Props) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const convos = await listConversations();
    setConversations(convos);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    load()
      .catch((e: any) => setError(e.message ?? 'Could not load conversations.'))
      .finally(() => setLoading(false));
  }, [load]);

  // Silent refresh on refocus (e.g. returning from a thread after reading or
  // sending) so unread badges and previews stay current — same pattern as
  // ConnectionsScreen.
  const isFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
        return;
      }
      load().catch(() => {});
    }, [load])
  );

  // Stable reference so ConversationRow's memoization below isn't defeated
  // by a fresh closure identity on every ConversationsListScreen render.
  const goToThread = useCallback(
    (item: ConversationSummary) =>
      navigation.navigate('Thread', { otherUserId: item.otherProfile.id, otherProfile: item.otherProfile }),
    [navigation]
  );

  if (loading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#6C47FF" />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-6">
        <Text className="text-red-600 text-center">{error}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <View className="pt-12 px-4 pb-2">
        <Text className="text-2xl font-bold text-gray-900">Messages</Text>
      </View>
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.otherProfile.id}
        contentContainerClassName="px-4 pb-24"
        ListEmptyComponent={
          <View className="items-center justify-center py-24">
            <Text className="text-base text-gray-500 text-center">
              No conversations yet — message a connection to get started.
            </Text>
          </View>
        }
        renderItem={({ item }) => <ConversationRow item={item} onPress={goToThread} />}
      />
    </View>
  );
}

// Memoized for the same reason as FeedCard/DiscoverRow -- listConversations()
// currently rebuilds the whole array fresh on every load(), so this doesn't
// yet skip a re-render in practice, but it keeps this screen resistant to
// becoming a footgun if a future change (e.g. incremental per-conversation
// updates) makes conversations' object identity stable across unrelated
// re-renders. onPress is a stable reference from ConversationsListScreen
// (see above), not a per-row closure, so the memoization is real once that's true.
const ConversationRow = memo(function ConversationRow({
  item,
  onPress,
}: {
  item: ConversationSummary;
  onPress: (item: ConversationSummary) => void;
}) {
  return (
    <TouchableOpacity
      className="flex-row items-center py-3 border-b border-gray-100"
      onPress={() => onPress(item)}
    >
      <Avatar
        uri={item.otherProfile.avatar_url}
        name={item.otherProfile.display_name ?? item.otherProfile.username}
        size="lg"
        className="mr-3"
      />
      <View className="flex-1 mr-2">
        <Text className="text-base font-semibold text-gray-900" numberOfLines={1}>
          {item.otherProfile.display_name ?? item.otherProfile.username}
        </Text>
        <Text
          className={`text-sm ${item.unreadCount > 0 ? 'text-gray-900 font-medium' : 'text-gray-500'}`}
          numberOfLines={1}
        >
          {item.lastMessage.content}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-xs text-gray-400 mb-1">
          {new Date(item.lastMessage.createdAt).toLocaleDateString()}
        </Text>
        {item.unreadCount > 0 && (
          <View className="bg-brand-primary rounded-full min-w-[20px] h-5 px-1.5 items-center justify-center">
            <Text className="text-white text-xs font-bold">{item.unreadCount}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});
