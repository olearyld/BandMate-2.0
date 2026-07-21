import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
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
import {
  SKILL_LEVELS,
  AVAILABILITY_STATUSES,
  type FullProfile,
  type Instrument,
  type Genre,
  type ExperienceLevel,
  type AvailabilityStatus,
} from '../../lib/types';
import ProfileBody from '../../components/ProfileBody';
import AudioPlayer from '../../components/AudioPlayer';
import CityPicker, { type CityPickerValue } from '../../components/CityPicker';

/** Toggles `value`'s membership in a Set, for use as an onPress handler factory. */
function toggleInSet<T>(setter: Dispatch<SetStateAction<Set<T>>>) {
  return (value: T) => {
    setter((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  };
}

/** Shared pill-toggle layout for a flat list of selectable options (genres, availability). */
function ChipToggleGroup<T>({
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

export default function MyProfileScreen() {
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        profile_genres(genre_id, genres(id, name))
      `)
      .eq('id', user.id)
      .returns<FullProfile>()
      .single();
    if (err) setError(err.message);
    else setProfile(data);
    setLoading(false);
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  if (loading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#6C47FF" />
      </View>
    );
  }
  if (error || !profile) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-6">
        <Text className="text-red-600 text-center">{error ?? 'Could not load profile.'}</Text>
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

  return (
    <View className="flex-1">
      <View className="absolute top-12 left-4 z-10">
        <TouchableOpacity onPress={handleSignOut}>
          <Text className="text-gray-400 text-sm font-medium">Sign out</Text>
        </TouchableOpacity>
      </View>
      <View className="absolute top-12 right-4 z-10">
        <TouchableOpacity
          className="bg-brand-primary px-4 py-2 rounded-full"
          onPress={() => setEditing(true)}
        >
          <Text className="text-white font-semibold text-sm">Edit</Text>
        </TouchableOpacity>
      </View>
      <ProfileBody profile={profile} />
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
    <View className="flex-1 bg-white">
      <ScrollView contentContainerClassName="px-6 py-10 pb-32">
        <View className="flex-row items-center justify-between mb-6">
          <Text className="text-2xl font-bold text-gray-900">Edit profile</Text>
          <TouchableOpacity onPress={onCancel}>
            <Text className="text-gray-500">Cancel</Text>
          </TouchableOpacity>
        </View>

        {error && (
          <View className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4">
            <Text className="text-red-700 text-sm">{error}</Text>
          </View>
        )}

        <Text className="text-sm font-medium text-gray-700 mb-1">Display name</Text>
        <TextInput className="border border-gray-300 rounded-lg px-4 py-3 mb-4 text-base text-gray-900" value={displayName} onChangeText={setDisplayName} placeholder="Your name" placeholderTextColor="#9CA3AF" />

        <CityPicker value={location} onChange={setLocation} />

        <Text className="text-sm font-medium text-gray-700 mb-1">Bio</Text>
        <TextInput className="border border-gray-300 rounded-lg px-4 py-3 mb-6 text-base text-gray-900" value={bio} onChangeText={setBio} placeholder="About you..." placeholderTextColor="#9CA3AF" multiline numberOfLines={4} textAlignVertical="top" style={{ minHeight: 96 }} />

        {/* Intro media */}
        <Text className="text-sm font-semibold text-gray-700 mb-3">Intro media</Text>
        {profile.intro_media_url && !newMedia && (
          <View className="mb-3">
            <Text className="text-xs text-gray-500 mb-1">Current:</Text>
            {profile.intro_media_type === 'image' && (
              <Image source={{ uri: profile.intro_media_url }} className="w-full h-40 rounded-xl" resizeMode="cover" />
            )}
            {profile.intro_media_type === 'audio' && <AudioPlayer uri={profile.intro_media_url} />}
            {profile.intro_media_type === 'video' && (
              <View className="bg-gray-100 rounded-xl p-3"><Text className="text-gray-600">🎬 Current video</Text></View>
            )}
          </View>
        )}
        {newMedia && (
          <View className="bg-gray-100 rounded-xl p-3 mb-3 flex-row items-center justify-between">
            <Text className="text-gray-600">New {newMedia.type} selected</Text>
            <TouchableOpacity onPress={() => setNewMedia(null)}>
              <Text className="text-brand-secondary text-sm">Remove</Text>
            </TouchableOpacity>
          </View>
        )}
        <View className="flex-row gap-3 mb-8">
          <TouchableOpacity className="flex-1 border border-gray-300 rounded-lg py-3 items-center" onPress={handlePickPhoto}>
            <Text className="text-xl mb-0.5">📷</Text><Text className="text-xs text-gray-600">Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity className="flex-1 border border-gray-300 rounded-lg py-3 items-center" onPress={handlePickVideo}>
            <Text className="text-xl mb-0.5">🎬</Text><Text className="text-xs text-gray-600">Video</Text>
          </TouchableOpacity>
          <TouchableOpacity className={`flex-1 border rounded-lg py-3 items-center ${isRecording ? 'border-red-400 bg-red-50' : 'border-gray-300'}`} onPress={isRecording ? handleStopRecording : handleStartRecording}>
            <Text className="text-xl mb-0.5">{isRecording ? '⏹' : '🎙'}</Text>
            <Text className={`text-xs ${isRecording ? 'text-red-600' : 'text-gray-600'}`}>{isRecording ? 'Stop' : 'Record'}</Text>
          </TouchableOpacity>
        </View>

        {/* Instruments */}
        <Text className="text-sm font-semibold text-gray-700 mb-3">Instruments</Text>
        {allInstruments.map((inst) => {
          const isSel = inst.id in selectedInstruments;
          return (
            <View key={inst.id} className="mb-2">
              <TouchableOpacity
                className={`border rounded-lg px-4 py-2.5 flex-row items-center justify-between ${isSel ? 'border-brand-primary bg-purple-50' : 'border-gray-200'}`}
                onPress={() => toggleInstrument(inst.id)}
              >
                <Text className={`font-medium ${isSel ? 'text-brand-primary' : 'text-gray-700'}`}>{inst.name}</Text>
                <Text>{isSel ? '✓' : '+'}</Text>
              </TouchableOpacity>
              {isSel && (
                <View className="flex-row mt-1.5 gap-1.5">
                  {SKILL_LEVELS.map((sl) => (
                    <TouchableOpacity
                      key={sl.value}
                      className={`flex-1 py-1 rounded-full border items-center ${selectedInstruments[inst.id] === sl.value ? 'bg-brand-primary border-brand-primary' : 'border-gray-300'}`}
                      onPress={() => setSelectedInstruments((p) => ({ ...p, [inst.id]: sl.value }))}
                    >
                      <Text className={`text-xs font-medium ${selectedInstruments[inst.id] === sl.value ? 'text-white' : 'text-gray-600'}`}>{sl.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          );
        })}

        {/* Genres */}
        <Text className="text-sm font-semibold text-gray-700 mt-4 mb-3">Genres</Text>
        <ChipToggleGroup
          items={allGenres}
          getKey={(genre) => genre.id}
          getLabel={(genre) => genre.name}
          isSelected={(genre) => selectedGenres.has(genre.id)}
          onToggle={(genre) => toggleGenre(genre.id)}
        />

        {/* Availability */}
        <Text className="text-sm font-semibold text-gray-700 mt-4 mb-3">Availability</Text>
        <ChipToggleGroup
          items={AVAILABILITY_STATUSES}
          getKey={(opt) => opt.value}
          getLabel={(opt) => opt.label}
          isSelected={(opt) => selectedAvailability.has(opt.value)}
          onToggle={(opt) => toggleAvailability(opt.value)}
        />
      </ScrollView>

      <View className="absolute bottom-0 left-0 right-0 px-6 py-4 bg-white border-t border-gray-100">
        <TouchableOpacity className="bg-brand-primary rounded-lg py-4 items-center" onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-semibold text-base">Save changes</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}
