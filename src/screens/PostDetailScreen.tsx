import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import { useAppContext } from '../navigation/AppContext';
import type { MainStackParamList } from '../navigation/types';
import type { PostDetailRow } from '../lib/types';
import AudioPlayer from '../components/AudioPlayer';
import Avatar from '../components/Avatar';
import VideoPlayerBlock from '../components/VideoPlayerBlock';
import { useTheme } from '../theme/ThemeProvider';
import { Ionicons } from '@react-native-vector-icons/ionicons';

type Props = NativeStackScreenProps<MainStackParamList, 'PostDetail'>;

const POST_DETAIL_SELECT = `
  id, profile_id, media_url, media_type, caption, tags, thumbnail_url, status, created_at,
  profiles!media_posts_profile_id_fkey ( username, display_name, avatar_url ),
  likes ( user_id ),
  comments ( id, post_id, user_id, body, created_at, profiles ( username, display_name, avatar_url ) )
`;

export default function PostDetailScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { postId } = route.params;
  const { session } = useAppContext();
  const currentUserId = session?.user.id;

  const [post, setPost] = useState<PostDetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  const loadPost = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('media_posts')
      .select(POST_DETAIL_SELECT)
      .eq('id', postId)
      .order('created_at', { foreignTable: 'comments', ascending: true })
      .returns<PostDetailRow>()
      .single();
    if (err) setError(err.message);
    else setPost(data);
    setLoading(false);
  }, [postId]);

  useEffect(() => {
    loadPost();
  }, [loadPost]);

  async function handleToggleLike() {
    if (!post || !currentUserId) return;
    const previousLikes = post.likes;
    const alreadyLiked = previousLikes.some((l) => l.user_id === currentUserId);

    setPost((prev) =>
      prev
        ? {
            ...prev,
            likes: alreadyLiked
              ? prev.likes.filter((l) => l.user_id !== currentUserId)
              : [...prev.likes, { user_id: currentUserId }],
          }
        : prev
    );

    const { error: err } = alreadyLiked
      ? await supabase.from('likes').delete().eq('post_id', post.id).eq('user_id', currentUserId)
      : await supabase.from('likes').insert({ post_id: post.id, user_id: currentUserId });

    if (err) {
      setPost((prev) => (prev ? { ...prev, likes: previousLikes } : prev));
    }
  }

  async function handleAddComment() {
    const body = commentBody.trim();
    if (!body || !currentUserId || !post) return;

    setPostingComment(true);
    const { data, error: err } = await supabase
      .from('comments')
      .insert({ post_id: post.id, user_id: currentUserId, body })
      .select('id, post_id, user_id, body, created_at, profiles ( username, display_name, avatar_url )')
      .returns<PostDetailRow['comments'][number]>()
      .single();
    setPostingComment(false);
    if (err || !data) return;

    setCommentBody('');
    setPost((prev) => (prev ? { ...prev, comments: [...prev.comments, data] } : prev));
  }

  if (loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (error || !post) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-6">
        <Text className="text-danger text-center">{error ?? 'Post not found.'}</Text>
      </View>
    );
  }

  const author = post.profiles;
  const likedByMe = !!currentUserId && post.likes.some((l) => l.user_id === currentUserId);

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerClassName="pb-6">
        <TouchableOpacity
          activeOpacity={0.7}
          className="flex-row items-center px-4 pt-4 mb-3"
          onPress={() => navigation.navigate('PublicProfile', { profileId: post.profile_id })}
        >
          <Avatar uri={author.avatar_url} name={author.display_name ?? author.username} className="mr-3" />
          <View>
            <Text className="text-sm font-semibold text-foreground">
              {author.display_name ?? author.username}
            </Text>
            <Text className="text-xs text-foreground-muted">
              {new Date(post.created_at).toLocaleDateString()}
            </Text>
          </View>
        </TouchableOpacity>

        {post.media_type === 'image' && (
          <Image source={{ uri: post.media_url }} className="w-full h-80 bg-surface-alt" resizeMode="cover" />
        )}
        {post.media_type === 'video' && <VideoPlayerBlock uri={post.media_url} />}
        {post.media_type === 'audio' && (
          <View className="px-4">
            <AudioPlayer uri={post.media_url} />
          </View>
        )}

        <View className="px-4">
          {post.caption && <Text className="text-base text-foreground mt-4">{post.caption}</Text>}

          {post.tags && post.tags.length > 0 && (
            <View className="flex-row flex-wrap gap-1.5 mt-3">
              {post.tags.map((tag) => (
                <View key={tag} className="px-2.5 py-1 rounded-full bg-accent-subtle border border-accent-line">
                  <Text className="text-accent text-xs font-medium">#{tag}</Text>
                </View>
              ))}
            </View>
          )}

          <View className="flex-row items-center mt-4 gap-5 pb-4 border-b border-border-subtle">
            <TouchableOpacity onPress={handleToggleLike} className="flex-row items-center gap-1.5">
              <Ionicons
                name={likedByMe ? 'heart' : 'heart-outline'}
                size={30}
                color={likedByMe ? colors.danger : colors.foregroundSecondary}
              />
              <Text className="text-sm text-foreground-tertiary">{post.likes.length}</Text>
            </TouchableOpacity>
            <View className="flex-row items-center gap-1.5">
              <Ionicons name="chatbubble-outline" size={28} color={colors.foregroundSecondary} />
              {post.comments.length > 0 && (
                <Text className="text-sm text-foreground-tertiary">{post.comments.length}</Text>
              )}
            </View>
          </View>

          <Text className="text-sm font-semibold text-foreground-secondary mt-4 mb-2">Comments</Text>
          {post.comments.length === 0 && (
            <Text className="text-sm text-foreground-muted mb-2">No comments yet — say something.</Text>
          )}
          {post.comments.map((c) => {
            const commentAuthor = c.profiles;
            return (
              <View key={c.id} className="flex-row items-start mb-3">
                <Avatar
                  uri={commentAuthor.avatar_url}
                  name={commentAuthor.display_name ?? commentAuthor.username}
                  size="sm"
                  className="mr-2.5 mt-0.5"
                />
                <View className="flex-1">
                  <Text className="text-sm text-foreground">
                    <Text className="font-semibold">{commentAuthor.display_name ?? commentAuthor.username}</Text>
                    {'  '}
                    {c.body}
                  </Text>
                  <Text className="text-xs text-foreground-muted mt-0.5">
                    {new Date(c.created_at).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View className="flex-row items-center gap-2 px-4 py-3 border-t border-border-subtle bg-surface">
        <TextInput
          className="flex-1 border border-border rounded-full px-4 py-2.5 text-base text-foreground"
          placeholder="Add a comment..."
          placeholderTextColor={colors.foregroundMuted}
          value={commentBody}
          onChangeText={setCommentBody}
        />
        <TouchableOpacity
          className="bg-accent rounded-full px-4 py-2.5 items-center justify-center"
          onPress={handleAddComment}
          disabled={postingComment || !commentBody.trim()}
        >
          {postingComment ? (
            <ActivityIndicator color={colors.onAccent} size="small" />
          ) : (
            <Text className="text-on-accent font-semibold text-sm">Send</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
