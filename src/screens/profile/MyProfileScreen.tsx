import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { pickImage, pickVideo, useMediaRecorder, uploadIntroMedia, type PickedMedia } from '../../lib/mediaUpload';
import { supabase } from '../../lib/supabase';
import { saveHighlights } from '../../lib/highlights';
import {
  SKILL_LEVELS,
  AVAILABILITY_STATUSES,
  PROFILE_HIGHLIGHTS_SELECT,
  type FullProfile,
  type Instrument,
  type Genre,
  type ExperienceLevel,
  type AvailabilityStatus,
  type MediaPost,
} from '../../lib/types';
import ProfileBody, { HighlightThumb } from '../../components/ProfileBody';
import AudioPlayer from '../../components/AudioPlayer';
import CityPicker, { type CityPickerValue } from '../../components/CityPicker';
import ChipToggleGroup, { toggleInSet } from '../../components/ChipToggleGroup';
import ConnectionsScreen from '../ConnectionsScreen';
import { useTheme } from '../../theme/ThemeProvider';

type ProfileSegment = 'profile' | 'connections';

export default function MyProfileScreen() {
  const { colors } = useTheme();
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [managingHighlights, setManagingHighlights] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [segment, setSegment] = useState<ProfileSegment>('profile');

  async function handleSignOut() {
    await supabase.auth.signOut();
    // onAuthStateChange in AppContext fires → appState → 'unauthenticated'
  }

  const loadProfile = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error: err } = await supabase
      .from('profiles')
      .select(`
        *,
        profile_instruments(skill_level, instruments(id, name)),
        profile_genres(genre_id, genres(id, name)),
        ${PROFILE_HIGHLIGHTS_SELECT}
      `)
      .eq('id', user.id)
      .order('position', { referencedTable: 'profile_highlights' })
      .returns<FullProfile>()
      .single();
    if (err) setError(err.message);
    else setProfile(data);
    setLoading(false);
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  if (loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  if (error || !profile) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-6">
        <Text className="text-danger text-center">{error ?? 'Could not load profile.'}</Text>
      </View>
    );
  }

  if (editing) {
    return (
      <EditProfileForm
        profile={profile}
        onSaved={() => { setEditing(false); loadProfile(); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  if (managingHighlights) {
    return (
      <ManageHighlightsPanel
        profile={profile}
        onSaved={() => { setManagingHighlights(false); loadProfile(); }}
        onCancel={() => setManagingHighlights(false)}
      />
    );
  }

  return (
    <View className="flex-1 bg-background">
      <View className="pt-12 px-4 pb-3 flex-row items-center">
        <View className="w-16">
          <TouchableOpacity onPress={handleSignOut}>
            <Text className="text-foreground-muted text-sm font-medium">Sign out</Text>
          </TouchableOpacity>
        </View>
        <View className="flex-1 flex-row justify-center">
          <ProfileSegmentToggle segment={segment} onChange={setSegment} />
        </View>
        <View className="w-16 items-end">
          {segment === 'profile' && (
            <TouchableOpacity
              className="bg-accent px-4 py-2 rounded-full"
              onPress={() => setEditing(true)}
            >
              <Text className="text-on-accent font-semibold text-sm">Edit</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      {segment === 'profile' ? (
        <ProfileBody profile={profile} onManageHighlights={() => setManagingHighlights(true)} />
      ) : (
        <ConnectionsScreen />
      )}
    </View>
  );
}

// Profile/Connections segmented toggle (Phase 8b) -- Connections used to be
// its own root tab; its tab-bar slot is now the center Post button (see
// RootNavigator), so it lives here instead. Same pill-toggle visual pattern
// ConnectionsScreen's own Requests/Sent/Connections control already uses.
function ProfileSegmentToggle({
  segment,
  onChange,
}: {
  segment: ProfileSegment;
  onChange: (segment: ProfileSegment) => void;
}) {
  const options: { key: ProfileSegment; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    { key: 'connections', label: 'Connections' },
  ];
  return (
    <View className="flex-row bg-surface-alt rounded-full p-1">
      {options.map((opt) => (
        <TouchableOpacity
          key={opt.key}
          className={`px-4 py-1.5 rounded-full ${segment === opt.key ? 'bg-accent' : ''}`}
          onPress={() => onChange(opt.key)}
        >
          <Text
            className={`text-sm font-semibold ${
              segment === opt.key ? 'text-on-accent' : 'text-foreground-secondary'
            }`}
          >
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function EditProfileForm({
  profile,
  onSaved,
  onCancel,
}: {
  profile: FullProfile;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const [displayName, setDisplayName] = useState(profile.display_name ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [location, setLocation] = useState<CityPickerValue>({
    city: profile.location_city,
    state: profile.location_state,
    cityId: profile.matched_city_id,
  });

  const existingInstruments: Record<number, ExperienceLevel> = {};
  profile.profile_instruments.forEach((pi) => {
    existingInstruments[pi.instruments.id] = pi.skill_level;
  });
  const [selectedInstruments, setSelectedInstruments] = useState<Record<number, ExperienceLevel>>(existingInstruments);

  const existingGenres = new Set<number>(profile.profile_genres.map((pg) => pg.genres.id));
  const [selectedGenres, setSelectedGenres] = useState<Set<number>>(existingGenres);

  const [selectedAvailability, setSelectedAvailability] = useState<Set<AvailabilityStatus>>(
    new Set(profile.availability_statuses)
  );

  const [allInstruments, setAllInstruments] = useState<Instrument[]>([]);
  const [allGenres, setAllGenres] = useState<Genre[]>([]);

  const [newMedia, setNewMedia] = useState<PickedMedia | null>(null);
  const { isRecording, start: startRecording, stop: stopRecording } = useMediaRecorder();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadRef() {
      const [{ data: instr }, { data: gen }] = await Promise.all([
        supabase.from('instruments').select('*').order('name'),
        supabase.from('genres').select('*').order('name'),
      ]);
      setAllInstruments(instr ?? []);
      setAllGenres(gen ?? []);
    }
    loadRef();
  }, []);

  function toggleInstrument(id: number) {
    setSelectedInstruments((prev) => {
      if (id in prev) { const n = { ...prev }; delete n[id]; return n; }
      return { ...prev, [id]: 'beginner' };
    });
  }

  const toggleGenre = toggleInSet(setSelectedGenres);
  const toggleAvailability = toggleInSet(setSelectedAvailability);

  async function handlePickPhoto() {
    try {
      const picked = await pickImage();
      if (picked) setNewMedia(picked);
    } catch (e: any) {
      Alert.alert('Permission needed', e.message);
    }
  }

  async function handlePickVideo() {
    try {
      const picked = await pickVideo();
      if (picked) setNewMedia(picked);
    } catch (e: any) {
      Alert.alert(e.message?.includes('60 seconds') ? 'Too long' : 'Permission needed', e.message);
    }
  }

  async function handleStartRecording() {
    try {
      await startRecording();
    } catch (e: any) {
      Alert.alert('Permission needed', e.message);
    }
  }

  async function handleStopRecording() {
    const recorded = await stopRecording();
    if (recorded) setNewMedia(recorded);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      let introMediaUrl = profile.intro_media_url;
      let introMediaType = profile.intro_media_type;

      if (newMedia) {
        const uploaded = await uploadIntroMedia(user.id, newMedia);
        introMediaUrl = uploaded.url;
        introMediaType = newMedia.type;
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          display_name: displayName.trim() || null,
          bio: bio.trim() || null,
          location_city: location.city?.trim() || null,
          location_state: location.state?.trim() || null,
          matched_city_id: location.cityId,
          intro_media_url: introMediaUrl,
          intro_media_type: introMediaType,
          availability_statuses: Array.from(selectedAvailability),
        })
        .eq('id', user.id);
      if (profileError) throw profileError;

      // Instruments: upsert selected, then delete any that were removed.
      // Upsert first so existing data is never lost if a subsequent step fails.
      const instrRows = Object.entries(selectedInstruments).map(([id, skill]) => ({
        profile_id: user.id,
        instrument_id: Number(id),
        skill_level: skill,
      }));
      if (instrRows.length > 0) {
        const { error: instrErr } = await supabase
          .from('profile_instruments')
          .upsert(instrRows, { onConflict: 'profile_id,instrument_id' });
        if (instrErr) throw instrErr;
      }
      const removedInstrIds = profile.profile_instruments
        .map((pi) => pi.instruments.id)
        .filter((id) => !(id in selectedInstruments));
      if (removedInstrIds.length > 0) {
        const { error: delInstrErr } = await supabase
          .from('profile_instruments')
          .delete()
          .eq('profile_id', user.id)
          .in('instrument_id', removedInstrIds);
        if (delInstrErr) throw delInstrErr;
      }

      // Genres: same upsert-then-delete pattern.
      const genreRows = Array.from(selectedGenres).map((id) => ({ profile_id: user.id, genre_id: id }));
      if (genreRows.length > 0) {
        const { error: genreErr } = await supabase
          .from('profile_genres')
          .upsert(genreRows, { onConflict: 'profile_id,genre_id' });
        if (genreErr) throw genreErr;
      }
      const removedGenreIds = profile.profile_genres
        .map((pg) => pg.genres.id)
        .filter((id) => !selectedGenres.has(id));
      if (removedGenreIds.length > 0) {
        const { error: delGenreErr } = await supabase
          .from('profile_genres')
          .delete()
          .eq('profile_id', user.id)
          .in('genre_id', removedGenreIds);
        if (delGenreErr) throw delGenreErr;
      }

      onSaved();
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong.');
      setSaving(false);
    }
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerClassName="px-6 py-10 pb-32">
        <View className="flex-row items-center justify-between mb-6">
          <Text className="text-2xl font-bold text-foreground">Edit profile</Text>
          <TouchableOpacity onPress={onCancel}>
            <Text className="text-foreground-tertiary">Cancel</Text>
          </TouchableOpacity>
        </View>

        {error && (
          <View className="bg-danger-subtle border border-danger-line rounded-lg px-4 py-3 mb-4">
            <Text className="text-danger text-sm">{error}</Text>
          </View>
        )}

        <Text className="text-sm font-medium text-foreground-secondary mb-1">Display name</Text>
        <TextInput className="border border-border rounded-lg px-4 py-3 mb-4 text-base text-foreground" value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor={colors.foregroundMuted} />

        <CityPicker value={location} onChange={setLocation} />

        <Text className="text-sm font-medium text-foreground-secondary mb-1">Bio</Text>
        <TextInput className="border border-border rounded-lg px-4 py-3 mb-6 text-base text-foreground" value={bio} onChangeText={setBio} placeholder="About you..." placeholderTextColor={colors.foregroundMuted} multiline numberOfLines={4} textAlignVertical="top" style={{ minHeight: 96 }} />

        {/* Intro media */}
        <Text className="text-sm font-semibold text-foreground-secondary mb-3">Intro media</Text>
        {profile.intro_media_url && !newMedia && (
          <View className="mb-3">
            <Text className="text-xs text-foreground-tertiary mb-1">Current:</Text>
            {profile.intro_media_type === 'image' && (
              <Image source={{ uri: profile.intro_media_url }} className="w-full h-40 rounded-xl" resizeMode="cover" />
            )}
            {profile.intro_media_type === 'audio' && <AudioPlayer uri={profile.intro_media_url} />}
            {profile.intro_media_type === 'video' && (
              <View className="bg-surface-alt rounded-xl p-3"><Text className="text-foreground-secondary">🎬 Current video</Text></View>
            )}
          </View>
        )}
        {newMedia && (
          <View className="bg-surface-alt rounded-xl p-3 mb-3 flex-row items-center justify-between">
            <Text className="text-foreground-secondary">New {newMedia.type} selected</Text>
            <TouchableOpacity onPress={() => setNewMedia(null)}>
              <Text className="text-accent text-sm">Remove</Text>
            </TouchableOpacity>
          </View>
        )}
        <View className="flex-row gap-3 mb-8">
          <TouchableOpacity className="flex-1 border border-border rounded-lg py-3 items-center" onPress={handlePickPhoto}>
            <Text className="text-xl mb-0.5">📷</Text><Text className="text-xs text-foreground-secondary">Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity className="flex-1 border border-border rounded-lg py-3 items-center" onPress={handlePickVideo}>
            <Text className="text-xl mb-0.5">🎬</Text><Text className="text-xs text-foreground-secondary">Video</Text>
          </TouchableOpacity>
          <TouchableOpacity className={`flex-1 border rounded-lg py-3 items-center ${isRecording ? 'border-danger-line bg-danger-subtle' : 'border-border'}`} onPress={isRecording ? handleStopRecording : handleStartRecording}>
            <Text className="text-xl mb-0.5">{isRecording ? '⏹' : '🎙'}</Text>
            <Text className={`text-xs ${isRecording ? 'text-danger' : 'text-foreground-secondary'}`}>{isRecording ? 'Stop' : 'Record'}</Text>
          </TouchableOpacity>
        </View>

        {/* Instruments */}
        <Text className="text-sm font-semibold text-foreground-secondary mb-3">Instruments</Text>
        {allInstruments.map((inst) => {
          const isSel = inst.id in selectedInstruments;
          return (
            <View key={inst.id} className="mb-2">
              <TouchableOpacity
                className={`border rounded-lg px-4 py-2.5 flex-row items-center justify-between ${isSel ? 'border-accent bg-accent-subtle' : 'border-border-subtle'}`}
                onPress={() => toggleInstrument(inst.id)}
              >
                <Text className={`font-medium ${isSel ? 'text-accent' : 'text-foreground-secondary'}`}>{inst.name}</Text>
                <Text>{isSel ? '✓' : '+'}</Text>
              </TouchableOpacity>
              {isSel && (
                <View className="flex-row mt-1.5 gap-1.5">
                  {SKILL_LEVELS.map((sl) => (
                    <TouchableOpacity
                      key={sl.value}
                      className={`flex-1 py-1 rounded-full border items-center ${selectedInstruments[inst.id] === sl.value ? 'bg-accent border-accent' : 'border-border'}`}
                      onPress={() => setSelectedInstruments((p) => ({ ...p, [inst.id]: sl.value }))}
                    >
                      <Text className={`text-xs font-medium ${selectedInstruments[inst.id] === sl.value ? 'text-on-accent' : 'text-foreground-secondary'}`}>{sl.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          );
        })}

        {/* Genres */}
        <Text className="text-sm font-semibold text-foreground-secondary mt-4 mb-3">Genres</Text>
        <ChipToggleGroup
          items={allGenres}
          getKey={(genre) => genre.id}
          getLabel={(genre) => genre.name}
          isSelected={(genre) => selectedGenres.has(genre.id)}
          onToggle={(genre) => toggleGenre(genre.id)}
        />

        {/* Availability */}
        <Text className="text-sm font-semibold text-foreground-secondary mt-4 mb-3">Availability</Text>
        <ChipToggleGroup
          items={AVAILABILITY_STATUSES}
          getKey={(opt) => opt.value}
          getLabel={(opt) => opt.label}
          isSelected={(opt) => selectedAvailability.has(opt.value)}
          onToggle={(opt) => toggleAvailability(opt.value)}
        />
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 px-6 py-4 bg-surface border-t border-border-subtle">
        <TouchableOpacity className="bg-accent rounded-lg py-4 items-center" onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.onAccent} /> : <Text className="text-on-accent font-semibold text-base">Save changes</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

/**
 * Owner-only manage flow for the highlight reel (Phase 6a): pick up to 6 of
 * the profile's own ready posts, reorder the selection with up/down controls
 * (no existing drag-reorder pattern elsewhere in the app to follow — this is
 * the simplest reasonable interaction), then save via one reorder_profile_highlights
 * call. The client-side 6-cap here is just a fast UI disable; the DB trigger
 * is the real enforcement (see CONVENTIONS.md).
 */
function ManageHighlightsPanel({
  profile,
  onSaved,
  onCancel,
}: {
  profile: FullProfile;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const [posts, setPosts] = useState<MediaPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>(
    profile.profile_highlights.map((h) => h.post_id)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPosts() {
      const { data, error: err } = await supabase
        .from('media_posts')
        .select('id, profile_id, media_url, media_type, caption, tags, thumbnail_url, status, created_at')
        .eq('profile_id', profile.id)
        .eq('status', 'ready')
        .order('created_at', { ascending: false })
        .returns<MediaPost[]>();
      if (!err) setPosts(data ?? []);
      setPostsLoading(false);
    }
    loadPosts();
  }, [profile.id]);

  function toggle(postId: string) {
    setSelected((prev) => {
      if (prev.includes(postId)) return prev.filter((id) => id !== postId);
      if (prev.length >= 6) return prev;
      return [...prev, postId];
    });
  }

  function move(postId: string, direction: -1 | 1) {
    setSelected((prev) => {
      const idx = prev.indexOf(postId);
      const nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[nextIdx]] = [next[nextIdx], next[idx]];
      return next;
    });
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await saveHighlights(selected);
      onSaved();
    } catch (e: any) {
      setError(e.message ?? 'Could not save highlights.');
      setSaving(false);
    }
  }

  const postById = new Map(posts.map((p) => [p.id, p]));
  const selectedPosts = selected.map((id) => postById.get(id)).filter((p): p is MediaPost => !!p);

  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerClassName="px-6 py-10 pb-32">
        <View className="flex-row items-center justify-between mb-6">
          <Text className="text-2xl font-bold text-foreground">Manage highlights</Text>
          <TouchableOpacity onPress={onCancel}>
            <Text className="text-foreground-tertiary">Cancel</Text>
          </TouchableOpacity>
        </View>

        {error && (
          <View className="bg-danger-subtle border border-danger-line rounded-lg px-4 py-3 mb-4">
            <Text className="text-danger text-sm">{error}</Text>
          </View>
        )}

        <Text className="text-sm font-semibold text-foreground-secondary mb-3">Selected ({selected.length}/6)</Text>
        {selectedPosts.length === 0 ? (
          <Text className="text-sm text-foreground-muted mb-6">Tap posts below to pin them here.</Text>
        ) : (
          <View className="mb-6">
            {selectedPosts.map((post, idx) => (
              <View key={post.id} className="flex-row items-center gap-3 mb-2">
                <View className="w-14 h-14 rounded-lg overflow-hidden bg-surface-alt">
                  <HighlightThumb post={post} />
                </View>
                <Text className="flex-1 text-sm text-foreground-secondary" numberOfLines={1}>
                  {post.caption || post.media_type}
                </Text>
                <TouchableOpacity disabled={idx === 0} onPress={() => move(post.id, -1)}>
                  <Text className={idx === 0 ? 'text-foreground-muted' : 'text-foreground-tertiary text-base'}>↑</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={idx === selectedPosts.length - 1} onPress={() => move(post.id, 1)}>
                  <Text className={idx === selectedPosts.length - 1 ? 'text-foreground-muted' : 'text-foreground-tertiary text-base'}>↓</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => toggle(post.id)}>
                  <Text className="text-danger text-sm font-medium">Remove</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <Text className="text-sm font-semibold text-foreground-secondary mb-3">Your posts</Text>
        {postsLoading ? (
          <ActivityIndicator color={colors.accent} />
        ) : posts.length === 0 ? (
          <Text className="text-sm text-foreground-muted">No posts yet — create one from the Feed tab first.</Text>
        ) : (
          <View className="flex-row flex-wrap gap-3">
            {posts.map((post) => {
              const isSelected = selected.includes(post.id);
              const disabledByCap = !isSelected && selected.length >= 6;
              return (
                <TouchableOpacity
                  key={post.id}
                  disabled={disabledByCap}
                  onPress={() => toggle(post.id)}
                  className={`w-20 h-20 rounded-lg overflow-hidden ${
                    isSelected ? 'border-2 border-accent' : 'border border-border-subtle'
                  } ${disabledByCap ? 'opacity-40' : ''}`}
                >
                  <HighlightThumb post={post} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 px-6 py-4 bg-surface border-t border-border-subtle">
        <TouchableOpacity className="bg-accent rounded-lg py-4 items-center" onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.onAccent} /> : <Text className="text-on-accent font-semibold text-base">Save highlights</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}
