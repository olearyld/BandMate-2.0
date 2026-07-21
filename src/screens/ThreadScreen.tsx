import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import { useAppContext } from '../navigation/AppContext';
import type { MainStackParamList } from '../navigation/types';
import type { Message, ProfileSummary } from '../lib/types';
import { getThread, markThreadRead, NotConnectedError, sendMessage, subscribeToThread } from '../lib/messages';
import Avatar from '../components/Avatar';

type Props = NativeStackScreenProps<MainStackParamList, 'Thread'>;

const PAGE_SIZE = 30;

export default function ThreadScreen({ route, navigation }: Props) {
  const { otherUserId, otherProfile: otherProfileParam } = route.params;
  const { session } = useAppContext();
  const myUserId = session?.user.id;

  const [otherProfile, setOtherProfile] = useState<ProfileSummary | null>(otherProfileParam ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  // Fetch the other party's profile only if the navigating screen didn't
  // already have it to hand (e.g. a future deep link) — every current call
  // site (ConversationsListScreen, ConnectionsScreen, PublicProfileScreen)
  // passes it, so this is a fallback, not the common path.
  useEffect(() => {
    if (otherProfile) {
      navigation.setOptions({ title: otherProfile.display_name ?? otherProfile.username });
      return;
    }
    supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .eq('id', otherUserId)
      .single()
      .then(({ data }) => {
        if (data) {
          setOtherProfile(data);
          navigation.setOptions({ title: data.display_name ?? data.username });
        }
      });
  }, [otherProfile, otherUserId, navigation]);

  const loadInitial = useCallback(async () => {
    const page = await getThread(otherUserId, { limit: PAGE_SIZE });
    setMessages(page);
    setHasMore(page.length === PAGE_SIZE);
  }, [otherUserId]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    // markThreadRead doesn't depend on loadInitial's result — run them
    // concurrently rather than waiting on one before starting the other.
    Promise.all([loadInitial(), markThreadRead(otherUserId).catch(() => {})])
      .catch((e: any) => setError(e.message ?? 'Could not load messages.'))
      .finally(() => setLoading(false));
  }, [loadInitial, otherUserId]);

  async function loadMore() {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const oldest = messages[messages.length - 1];
      const page = await getThread(otherUserId, { before: oldest.created_at, limit: PAGE_SIZE });
      setMessages((prev) => [...prev, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch {
      // best-effort — leave hasMore as-is so the user can retry by scrolling again
    } finally {
      setLoadingMore(false);
    }
  }

  function handleIncoming(message: Message) {
    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [message, ...prev]));
    if (message.sender_id === otherUserId) {
      markThreadRead(otherUserId).catch(() => {});
    }
  }

  // Subscribe only while this thread is focused, per Phase 5a's spec —
  // unsubscribe on blur rather than leaving it running in the background.
  useFocusEffect(
    useCallback(() => {
      const unsubscribe = subscribeToThread(otherUserId, handleIncoming);
      return unsubscribe;
    }, [otherUserId])
  );

  async function handleSend() {
    const content = input.trim();
    if (!content || !myUserId) return;
    setInput('');
    setSending(true);
    const tempId = `temp-${Date.now()}`;
    const optimistic: Message = {
      id: tempId,
      sender_id: myUserId,
      recipient_id: otherUserId,
      content,
      read_at: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [optimistic, ...prev]);
    try {
      const real = await sendMessage(otherUserId, content);
      setMessages((prev) => {
        // The realtime subscription may have already delivered this exact
        // row (it fires for messages I send too, via the recipient_id
        // filter) — if so, just drop the optimistic placeholder instead of
        // creating a duplicate bubble.
        const withoutTemp = prev.filter((m) => m.id !== tempId);
        return withoutTemp.some((m) => m.id === real.id) ? withoutTemp : [real, ...withoutTemp];
      });
    } catch (e: any) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInput(content);
      if (e instanceof NotConnectedError) {
        Alert.alert('Not connected', e.message);
      } else {
        Alert.alert('Could not send message', e.message ?? 'Something went wrong.');
      }
    } finally {
      setSending(false);
    }
  }

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
    <KeyboardAvoidingView className="flex-1 bg-white" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        inverted
        contentContainerClassName="px-4 py-4"
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator size="small" color="#6C47FF" className="my-2" /> : null
        }
        ListEmptyComponent={
          <View className="items-center justify-center py-24">
            <Avatar
              uri={otherProfile?.avatar_url ?? null}
              name={otherProfile?.display_name ?? otherProfile?.username ?? '?'}
              size="xl"
              className="mb-3"
            />
            <Text className="text-base text-gray-500 text-center">
              Say hello to {otherProfile?.display_name ?? otherProfile?.username ?? 'them'}.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const isMine = item.sender_id === myUserId;
          return (
            <View className={`flex-row mb-2 ${isMine ? 'justify-end' : 'justify-start'}`}>
              <View
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                  isMine ? 'bg-brand-primary' : 'bg-gray-100'
                }`}
              >
                <Text className={isMine ? 'text-white text-base' : 'text-gray-900 text-base'}>
                  {item.content}
                </Text>
                <Text className={`text-xs mt-1 ${isMine ? 'text-white/70' : 'text-gray-400'}`}>
                  {new Date(item.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          );
        }}
      />

      <View className="flex-row items-center gap-2 px-4 py-3 border-t border-gray-100 bg-white">
        <TextInput
          className="flex-1 border border-gray-300 rounded-full px-4 py-2.5 text-base text-gray-900"
          placeholder="Message..."
          placeholderTextColor="#9CA3AF"
          value={input}
          onChangeText={setInput}
          multiline
        />
        <TouchableOpacity
          className="bg-brand-primary rounded-full px-4 py-2.5 items-center justify-center"
          onPress={handleSend}
          disabled={sending || !input.trim()}
        >
          {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text className="text-white font-semibold text-sm">Send</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
