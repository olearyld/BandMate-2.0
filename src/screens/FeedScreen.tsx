import { memo, useCallback, useMemo, useRef, useState } from 'react';
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
import { listActiveStoryGroups } from '../lib/stories';
import type { MainTabParamList, MainStackParamList } from '../navigation/types';
import type { FeedPostRow, StoryGroup } from '../lib/types';
import AudioPlayer from '../components/AudioPlayer';
import Avatar from '../components/Avatar';
import StoriesTray from '../components/StoriesTray';
import { useTheme } from '../theme/ThemeProvider';
import { Ionicons } from '@react-native-vector-icons/ionicons';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Feed'>,
  NativeStackScreenProps<MainStackParamList>
>;

const PAGE_SIZE = 10;

// Purely cosmetic mock data — no `concerts` table, no backend, no
// persistence. Interleaved into the Feed's rendered list only, to see how
// concert promos + RSVP would look between posts. Not wired to anything real.
const MOCK_CONCERTS = [
  { id: 'mock-concert-1', title: 'Open Mic Night', venue: 'The Blue Note', date: 'Fri, Oct 3', time: '8:00 PM' },
  { id: 'mock-concert-2', title: 'Acoustic Sessions', venue: 'Riverside Park', date: 'Sat, Oct 11', time: '6:30 PM' },
  { id: 'mock-concert-3', title: 'Battle of the Bands', venue: 'The Fillmore', date: 'Fri, Oct 24', time: '7:00 PM' },
] as const;
type MockConcert = (typeof MOCK_CONCERTS)[number];
type FeedListItem = { kind: 'post'; post: FeedPostRow } | { kind: 'concert'; concert: MockConcert };
const CONCERT_EVERY_N_POSTS = 3;

const FEED_SELECT = `
  id, profile_id, media_url, media_type, caption, tags, thumbnail_url, status, created_at,
  profiles!media_posts_profile_id_fkey ( username, display_name, avatar_url ),
  likes ( user_id ),
  comments ( id )
`;

export default function FeedScreen({ navigation }: Props) {
  const { session } = useAppContext();
  const currentUserId = session?.user.id;
  const { colors } = useTheme();

  const [posts, setPosts] = useState<FeedPostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storyGroups, setStoryGroups] = useState<StoryGroup[]>([]);

  const refreshStoryGroups = useCallback(() => {
    listActiveStoryGroups().then(setStoryGroups).catch(() => {});
  }, []);

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
        refreshStoryGroups();
        return;
      }
      // Silent refresh on refocus (e.g. returning from Create Post, Post Detail,
      // Create Story, or the Story Viewer) so new posts / updated like counts /
      // newly-posted or newly-expired stories show up without a jarring
      // full-screen spinner.
      fetchPage(0)
        .then((rows) => {
          setPosts(rows);
          setHasMore(rows.length === PAGE_SIZE);
        })
        .catch(() => {});
      refreshStoryGroups();
    }, [loadInitial, fetchPage, refreshStoryGroups])
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

  // Stable across renders (functional setState updaters need no `posts`
  // dependency) so FeedCard's memoization below isn't defeated by a fresh
  // closure identity on every FeedScreen render.
  const handleToggleLike = useCallback(
    async (post: FeedPostRow) => {
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
    },
    [currentUserId]
  );

  const handlePressPost = useCallback(
    (postId: string) => navigation.navigate('PostDetail', { postId }),
    [navigation]
  );
  const handlePressAuthor = useCallback(
    (profileId: string) => navigation.navigate('PublicProfile', { profileId }),
    [navigation]
  );

  // Cosmetic only (see MOCK_CONCERTS above) — a display-only derived list,
  // not app state, so it's recomputed from `posts` rather than stored.
  const feedItems = useMemo((): FeedListItem[] => {
    const items: FeedListItem[] = [];
    posts.forEach((post, index) => {
      items.push({ kind: 'post', post });
      if ((index + 1) % CONCERT_EVERY_N_POSTS === 0) {
        items.push({
          kind: 'concert',
          concert: MOCK_CONCERTS[Math.floor(index / CONCERT_EVERY_N_POSTS) % MOCK_CONCERTS.length],
        });
      }
    });
    return items;
  }, [posts]);

  return (
    <View className="flex-1 bg-background">
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-danger text-center">{error}</Text>
        </View>
      ) : (
        <FlatList
          className="flex-1"
          data={feedItems}
          keyExtractor={(item) => (item.kind === 'post' ? item.post.id : item.concert.id)}
          contentContainerStyle={{ paddingVertical: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />}
          onEndReachedThreshold={0.5}
          onEndReached={handleLoadMore}
          ListHeaderComponent={
            <StoriesTray
              groups={storyGroups}
              currentUserId={currentUserId}
              onPressAdd={() => navigation.navigate('CreateStory')}
              onPressGroup={(index) => navigation.navigate('StoryViewer', { groups: storyGroups, startIndex: index })}
            />
          }
          ListEmptyComponent={
            <View className="items-center justify-center px-6 py-24">
              <Text className="text-3xl font-bold text-foreground mb-2">Feed</Text>
              <Text className="text-base text-foreground-tertiary text-center">
                No posts yet — be the first to share something.
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <View className="py-6">
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : null
          }
          renderItem={({ item }) =>
            item.kind === 'post' ? (
              <FeedCard
                post={item.post}
                currentUserId={currentUserId}
                onPress={handlePressPost}
                onPressAuthor={handlePressAuthor}
                onToggleLike={handleToggleLike}
              />
            ) : (
              <ConcertCard concert={item.concert} />
            )
          }
        />
      )}
    </View>
  );
}

// Memoized so an unrelated FeedScreen re-render (or another row's like
// toggle, which only replaces that one post's object reference in
// setPosts's functional update) doesn't re-render every visible card.
// Requires the callback props to be stable references (see FeedScreen's
// useCallback-wrapped handlers above) -- an inline arrow per row here would
// defeat this entirely, so callbacks take the post id/object rather than
// being pre-bound closures per row.
const FeedCard = memo(function FeedCard({
  post,
  currentUserId,
  onPress,
  onPressAuthor,
  onToggleLike,
}: {
  post: FeedPostRow;
  currentUserId: string | undefined;
  onPress: (postId: string) => void;
  onPressAuthor: (profileId: string) => void;
  onToggleLike: (post: FeedPostRow) => void;
}) {
  const { colors, elevation } = useTheme();
  const author = post.profiles;
  const likeCount = post.likes.length;
  const commentCount = post.comments.length;
  const likedByMe = !!currentUserId && post.likes.some((l) => l.user_id === currentUserId);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => onPress(post.id)}
      className="mx-4 mb-6 p-5 bg-surface rounded-xl border border-border-subtle"
      style={{ shadowColor: '#000', ...elevation.sm }}
    >
      {post.media_type !== 'video' && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => onPressAuthor(post.profile_id)}
          className="flex-row items-center mb-3"
        >
          <Avatar uri={author.avatar_url} name={author.display_name ?? author.username} className="mr-3" />
          <View>
            <Text className="text-base font-bold text-foreground">
              {author.display_name ?? author.username}
            </Text>
            <Text className="text-xs text-foreground-muted">
              {new Date(post.created_at).toLocaleDateString()}
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {post.media_type === 'video' ? (
        <View className="relative">
          <FeedMedia post={post} />
          {/* TikTok-style overlay — video only, an experiment to compare against
              the below-media layout every other media type still uses. Dark
              translucent panels/chips (not a border/shadow treatment) so
              everything stays legible over any video frame, light or dark
              theme alike. Left: profile + caption + tags. Right: like/comment. */}
          <View className="absolute left-3 right-3 bottom-3 flex-row items-end justify-between">
            <View className="flex-1 mr-3 bg-black/30 rounded-lg px-3 py-2">
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => onPressAuthor(post.profile_id)}
                className="flex-row items-center mb-1.5"
              >
                <Avatar uri={author.avatar_url} name={author.display_name ?? author.username} size="sm" className="mr-2" />
                <Text className="text-white text-sm font-bold flex-1" numberOfLines={1}>
                  {author.display_name ?? author.username}
                </Text>
              </TouchableOpacity>
              {post.caption && (
                <Text className="text-white text-sm font-medium mb-1.5" numberOfLines={2}>
                  {post.caption}
                </Text>
              )}
              {post.tags && post.tags.length > 0 && (
                <View className="flex-row flex-wrap gap-1.5">
                  {post.tags.map((tag) => (
                    <Text key={tag} className="text-white text-xs font-semibold">
                      #{tag}
                    </Text>
                  ))}
                </View>
              )}
            </View>
            <View className="items-center gap-4">
              <TouchableOpacity onPress={() => onToggleLike(post)} className="items-center" hitSlop={8}>
                <View className="w-11 h-11 rounded-full bg-black/40 items-center justify-center">
                  <Ionicons
                    name={likedByMe ? 'heart' : 'heart-outline'}
                    size={26}
                    color={likedByMe ? colors.danger : '#FFFFFF'}
                  />
                </View>
                <Text className="text-white text-xs font-bold mt-1">{likeCount}</Text>
              </TouchableOpacity>
              <View className="items-center">
                <View className="w-11 h-11 rounded-full bg-black/40 items-center justify-center">
                  <Ionicons name="chatbubble-outline" size={24} color="#FFFFFF" />
                </View>
                {commentCount > 0 && <Text className="text-white text-xs font-bold mt-1">{commentCount}</Text>}
              </View>
            </View>
          </View>
        </View>
      ) : (
        <FeedMedia post={post} />
      )}

      {post.media_type !== 'video' && post.caption && (
        <Text className="text-base font-medium text-foreground mt-3">{post.caption}</Text>
      )}

      {post.media_type !== 'video' && post.tags && post.tags.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5 mt-2">
          {post.tags.map((tag) => (
            <View key={tag} className="px-2.5 py-1 rounded-full bg-accent-subtle border border-accent-line">
              <Text className="text-accent text-xs font-medium">#{tag}</Text>
            </View>
          ))}
        </View>
      )}

      {post.media_type !== 'video' && (
        <View className="flex-row items-center mt-3 gap-5">
          <TouchableOpacity onPress={() => onToggleLike(post)} className="flex-row items-center gap-1.5">
            <Ionicons
              name={likedByMe ? 'heart' : 'heart-outline'}
              size={28}
              color={likedByMe ? colors.danger : colors.foregroundSecondary}
            />
            <Text className="text-sm text-foreground-tertiary">{likeCount}</Text>
          </TouchableOpacity>
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="chatbubble-outline" size={26} color={colors.foregroundSecondary} />
            {commentCount > 0 && <Text className="text-sm text-foreground-tertiary">{commentCount}</Text>}
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
});

function FeedMedia({ post }: { post: FeedPostRow }) {
  if (post.media_type === 'image') {
    return (
      <Image
        source={{ uri: post.media_url }}
        className="w-full h-80 rounded-xl bg-surface-alt"
        resizeMode="cover"
      />
    );
  }

  if (post.media_type === 'video') {
    // Show a lightweight thumbnail in the feed; full playback happens on Post Detail
    // (matching how PublicProfile plays video), so many cards never load a video player at once.
    return (
      <View className="w-full h-80 rounded-xl bg-gray-900 items-center justify-center overflow-hidden">
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

// Purely cosmetic — see MOCK_CONCERTS above. Not memoized: only ever a
// handful render at once (one per CONCERT_EVERY_N_POSTS posts), and RSVP
// state is local/component-scoped, not app state to protect from re-renders.
function ConcertCard({ concert }: { concert: MockConcert }) {
  const { colors } = useTheme();
  const [going, setGoing] = useState(false);

  return (
    <View className="mx-4 mb-6 p-5 bg-accent-subtle rounded-xl border border-accent-line">
      <View className="flex-row items-center mb-2">
        <Ionicons name="calendar" size={18} color={colors.accent} />
        <Text className="text-accent text-xs font-bold uppercase tracking-wide ml-2">Upcoming show</Text>
      </View>
      <Text className="text-lg font-bold text-foreground mb-1">{concert.title}</Text>
      <Text className="text-sm text-foreground-secondary mb-4">
        {concert.venue} · {concert.date} · {concert.time}
      </Text>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => setGoing((g) => !g)}
        className={`self-start px-4 py-2 rounded-full ${going ? 'bg-success-subtle border border-success-line' : 'bg-accent'}`}
      >
        <Text className={`text-sm font-bold ${going ? 'text-success' : 'text-on-accent'}`}>
          {going ? "You're going ✓" : 'RSVP'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
