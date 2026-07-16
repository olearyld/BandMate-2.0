import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, type CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import { useAppContext } from '../navigation/AppContext';
import type { MainTabParamList, MainStackParamList } from '../navigation/types';
import type { FeedPostRow } from '../lib/types';
import AudioPlayer from '../components/AudioPlayer';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Feed'>,
  NativeStackScreenProps<MainStackParamList>
>;

const PAGE_SIZE = 10;

const FEED_SELECT = `
  id, profile_id, media_url, media_type, caption, tags, thumbnail_url, status, created_at,
  profiles ( username, display_name, avatar_url ),
  likes ( user_id ),
  comments ( id )
`;

export default function FeedScreen({ navigation }: Props) {
  const { session } = useAppContext();
  const currentUserId = session?.user.id;

  const [posts, setPosts] = useState<FeedPostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(async (page: number): Promise<FeedPostRow[]> => {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error: err } = await supabase
      .from('media_posts')
      .select(FEED_SELECT)
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .range(from, to)
      .returns<FeedPostRow[]>();
    if (err) throw err;
    return data ?? [];
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchPage(0);
      setPosts(rows);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (e: any) {
      setError(e.message ?? 'Could not load feed.');
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  const isFirstFocus = useRef(true);

  useFocusEffect(
    useCallback(() => {
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
        loadInitial();
        return;
      }
      // Silent refresh on refocus (e.g. returning from Create Post or Post Detail)
      // so new posts / updated like counts show up without a jarring full-screen spinner.
      fetchPage(0)
        .then((rows) => {
          setPosts(rows);
          setHasMore(rows.length === PAGE_SIZE);
        })
        .catch(() => {});
    }, [loadInitial, fetchPage])
  );

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const rows = await fetchPage(0);
      setPosts(rows);
      setHasMore(rows.length === PAGE_SIZE);
    } catch {
      // Keep showing existing posts if a pull-to-refresh fails.
    } finally {
      setRefreshing(false);
    }
  }

  async function handleLoadMore() {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      const nextPage = Math.floor(posts.length / PAGE_SIZE);
      const rows = await fetchPage(nextPage);
      setPosts((prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch {
      // Silently stop paginating; pull-to-refresh can retry from the top.
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleToggleLike(post: FeedPostRow) {
    if (!currentUserId) return;
    const alreadyLiked = post.likes.some((l) => l.user_id === currentUserId);

    setPosts((prev) =>
      prev.map((p) =>
        p.id !== post.id
          ? p
          : {
              ...p,
              likes: alreadyLiked
                ? p.likes.filter((l) => l.user_id !== currentUserId)
                : [...p.likes, { user_id: currentUserId }],
            }
      )
    );

    const { error: err } = alreadyLiked
      ? await supabase.from('likes').delete().eq('post_id', post.id).eq('user_id', currentUserId)
      : await supabase.from('likes').insert({ post_id: post.id, user_id: currentUserId });

    if (err) {
      // Revert the optimistic update on failure.
      setPosts((prev) => prev.map((p) => (p.id === post.id ? post : p)));
    }
  }

  return (
    <View className="flex-1 bg-white">
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#6C47FF" />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-red-600 text-center">{error}</Text>
        </View>
      ) : (
        <FlatList
          className="flex-1"
          data={posts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingVertical: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#6C47FF" />}
          onEndReachedThreshold={0.5}
          onEndReached={handleLoadMore}
          ListEmptyComponent={
            <View className="items-center justify-center px-6 py-24">
              <Text className="text-2xl font-bold text-gray-900 mb-2">Feed</Text>
              <Text className="text-base text-gray-500 text-center">
                No posts yet — be the first to share something.
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <View className="py-6">
                <ActivityIndicator color="#6C47FF" />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <FeedCard
              post={item}
              currentUserId={currentUserId}
              onPress={() => navigation.navigate('PostDetail', { postId: item.id })}
              onToggleLike={() => handleToggleLike(item)}
            />
          )}
        />
      )}

      <TouchableOpacity
        className="absolute bottom-6 right-6 w-14 h-14 rounded-full bg-brand-primary items-center justify-center"
        style={{ shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 }}
        onPress={() => navigation.navigate('CreatePost')}
      >
        <Text className="text-white text-3xl leading-none" style={{ marginTop: -2 }}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

function FeedCard({
  post,
  currentUserId,
  onPress,
  onToggleLike,
}: {
  post: FeedPostRow;
  currentUserId: string | undefined;
  onPress: () => void;
  onToggleLike: () => void;
}) {
  const author = post.profiles;
  const likeCount = post.likes.length;
  const commentCount = post.comments.length;
  const likedByMe = !!currentUserId && post.likes.some((l) => l.user_id === currentUserId);

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} className="mb-6 px-4">
      <View className="flex-row items-center mb-3">
        {author.avatar_url ? (
          <Image source={{ uri: author.avatar_url }} className="w-9 h-9 rounded-full mr-3" />
        ) : (
          <View className="w-9 h-9 rounded-full bg-brand-primary items-center justify-center mr-3">
            <Text className="text-white text-sm font-bold">
              {(author.display_name ?? author.username)[0].toUpperCase()}
            </Text>
          </View>
        )}
        <View>
          <Text className="text-sm font-semibold text-gray-900">
            {author.display_name ?? author.username}
          </Text>
          <Text className="text-xs text-gray-400">
            {new Date(post.created_at).toLocaleDateString()}
          </Text>
        </View>
      </View>

      <FeedMedia post={post} />

      {post.caption && <Text className="text-base text-gray-800 mt-3">{post.caption}</Text>}

      {post.tags && post.tags.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5 mt-2">
          {post.tags.map((tag) => (
            <View key={tag} className="px-2.5 py-1 rounded-full bg-purple-50 border border-purple-200">
              <Text className="text-brand-primary text-xs font-medium">#{tag}</Text>
            </View>
          ))}
        </View>
      )}

      <View className="flex-row items-center mt-3 gap-5">
        <TouchableOpacity onPress={onToggleLike} className="flex-row items-center gap-1.5">
          <Text className="text-lg">{likedByMe ? '❤️' : '🤍'}</Text>
          <Text className="text-sm text-gray-500">{likeCount}</Text>
        </TouchableOpacity>
        <View className="flex-row items-center gap-1.5">
          <Text className="text-lg">💬</Text>
          <Text className="text-sm text-gray-500">{commentCount}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function FeedMedia({ post }: { post: FeedPostRow }) {
  if (post.media_type === 'image') {
    return (
      <Image
        source={{ uri: post.media_url }}
        className="w-full h-72 rounded-xl bg-gray-100"
        resizeMode="cover"
      />
    );
  }

  if (post.media_type === 'video') {
    // Show a lightweight thumbnail in the feed; full playback happens on Post Detail
    // (matching how PublicProfile plays video), so many cards never load a video player at once.
    return (
      <View className="w-full h-72 rounded-xl bg-gray-900 items-center justify-center overflow-hidden">
        {post.thumbnail_url ? (
          <Image source={{ uri: post.thumbnail_url }} className="w-full h-full absolute" resizeMode="cover" />
        ) : null}
        <View className="w-14 h-14 rounded-full bg-black/50 items-center justify-center">
          <Text className="text-white text-2xl">▶</Text>
        </View>
      </View>
    );
  }

  return <AudioPlayer uri={post.media_url} />;
}
