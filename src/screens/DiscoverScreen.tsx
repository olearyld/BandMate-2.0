import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import Slider from '@react-native-community/slider';
import { useFocusEffect, type CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import { useAppContext } from '../navigation/AppContext';
import type { MainTabParamList, MainStackParamList } from '../navigation/types';
import type { Instrument, Genre, DiscoverProfileRow, ConnectionStatusValue } from '../lib/types';
import { discoverProfiles } from '../lib/discover';
import { sendRequest, listIncomingRequests, listSentRequests, listAcceptedConnections } from '../lib/connections';
import Avatar from '../components/Avatar';
import ChipToggleGroup, { toggleInSet } from '../components/ChipToggleGroup';
import { useTheme } from '../theme/ThemeProvider';
import { Ionicons } from '@react-native-vector-icons/ionicons';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Discover'>,
  NativeStackScreenProps<MainStackParamList>
>;

const PAGE_SIZE = 20;
// Distance's old fixed chip set (10/25/50/100 mi) is gone, replaced by a
// continuous slider — same range the chips used to cover end-to-end (5 to
// 100, the top end an explicit user choice to match the old max rather than
// go wider), not a new value space. `discover_profiles` already accepts any
// numeric radius_miles, not just those four presets, so this needed no
// backend change at all.
const DISTANCE_SLIDER_MIN = 5;
const DISTANCE_SLIDER_MAX = 100;
const DISTANCE_SLIDER_DEFAULT = 25;
// Collapse cap for Instruments/Genres only — an approximation of "one
// line", not an exact measurement (chip width isn't knowable without
// runtime layout measurement, so this is a rough chars-per-label estimate
// instead).
const FILTER_COLLAPSE_COUNT = 4;

// Cosmetic-only, not linked to any profile's real `bio` column — see
// CONVENTIONS.md's Known tech debt for why (discover_profiles' RPC doesn't
// select bio at all, and wiring that in would mean a migration on both
// Supabase projects, out of scope for this aesthetics pass per the user's
// own explicit fallback instruction). Deterministic per profile id (not
// random per render) so a given row always shows the same fake bio.
const FAKE_BIOS = [
  'Weekend warrior looking to jam and maybe start something real.',
  "Been playing since I was a kid — always down for a good cover session.",
  'Songwriter first, instrumentalist second. Let\'s write something together.',
  'Studio rat by day, stage performer by night.',
  'New to the scene and love learning from other musicians.',
  'Touring between projects right now — open to collabs.',
  'Self-taught and still figuring it out, one riff at a time.',
  'Looking for a band that takes the music seriously but not themselves.',
  'Mostly play for fun, but always open to something bigger.',
  'Into tight arrangements and long rehearsals. Let\'s make something good.',
] as const;

function fakeBioFor(profileId: string): string {
  let hash = 0;
  for (let i = 0; i < profileId.length; i++) {
    hash = (hash * 31 + profileId.charCodeAt(i)) | 0;
  }
  return FAKE_BIOS[Math.abs(hash) % FAKE_BIOS.length];
}

export default function DiscoverScreen({ navigation }: Props) {
  const { session } = useAppContext();
  const userId = session?.user.id;
  const { colors } = useTheme();

  const [allInstruments, setAllInstruments] = useState<Instrument[]>([]);
  const [allGenres, setAllGenres] = useState<Genre[]>([]);
  const [selectedInstruments, setSelectedInstruments] = useState<Set<number>>(new Set());
  const [selectedGenres, setSelectedGenres] = useState<Set<number>>(new Set());
  const [radiusMiles, setRadiusMiles] = useState<number | null>(null);
  // "Any distance" checkbox — true by default, matching radiusMiles's own
  // null default. sliderDraft is separate from radiusMiles: it tracks the
  // thumb's live position while dragging (for the "N mi" label), but only
  // gets committed into radiusMiles (which actually drives the results
  // fetch, via the effect below) onSlidingComplete — dragging itself never
  // fires a new query, per the user's own explicit choice.
  const [distanceAny, setDistanceAny] = useState(true);
  const [sliderDraft, setSliderDraft] = useState(DISTANCE_SLIDER_DEFAULT);

  // Whether the caller has a matched_city_id at all — gates the radius
  // control (disabled, not hidden, when false). Loaded once per screen
  // mount; myCityLoaded gates the very first results fetch so a radius
  // isn't fetched-then-immediately-refetched once this resolves.
  const [myMatchedCityId, setMyMatchedCityId] = useState<string | null>(null);
  const [myCityLoaded, setMyCityLoaded] = useState(false);

  const [results, setResults] = useState<DiscoverProfileRow[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, ConnectionStatusValue>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [instrumentsExpanded, setInstrumentsExpanded] = useState(false);
  const [genresExpanded, setGenresExpanded] = useState(false);

  const toggleInstrument = toggleInSet(setSelectedInstruments);
  const toggleGenre = toggleInSet(setSelectedGenres);

  useEffect(() => {
    async function loadRef() {
      // profile_instruments/profile_genres are authenticated-readable for
      // every row (not owner-scoped — see their RLS policies), so this is a
      // plain unfiltered count query, not a new access path. Used only to
      // rank the filter chips by popularity; the counts themselves aren't
      // displayed anywhere.
      const [{ data: instr }, { data: gen }, { data: piRows }, { data: pgRows }] = await Promise.all([
        supabase.from('instruments').select('*').order('name'),
        supabase.from('genres').select('*').order('name'),
        supabase.from('profile_instruments').select('instrument_id'),
        supabase.from('profile_genres').select('genre_id'),
      ]);

      const instrumentCounts = new Map<number, number>();
      (piRows ?? []).forEach((r) => instrumentCounts.set(r.instrument_id, (instrumentCounts.get(r.instrument_id) ?? 0) + 1));
      const genreCounts = new Map<number, number>();
      (pgRows ?? []).forEach((r) => genreCounts.set(r.genre_id, (genreCounts.get(r.genre_id) ?? 0) + 1));

      // Most-popular-first, alphabetical as the tiebreaker (including the
      // common "0 for both" case, so unpopular chips don't end up in a
      // meaningless order).
      const sortedInstruments = [...(instr ?? [])].sort((a, b) => {
        const diff = (instrumentCounts.get(b.id) ?? 0) - (instrumentCounts.get(a.id) ?? 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
      const sortedGenres = [...(gen ?? [])].sort((a, b) => {
        const diff = (genreCounts.get(b.id) ?? 0) - (genreCounts.get(a.id) ?? 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });

      setAllInstruments(sortedInstruments);
      setAllGenres(sortedGenres);
    }
    loadRef();
  }, []);

  useEffect(() => {
    if (!userId) return;
    supabase
      .from('profiles')
      .select('matched_city_id')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        setMyMatchedCityId(data?.matched_city_id ?? null);
        setMyCityLoaded(true);
      });
  }, [userId]);

  const loadConnectionStatuses = useCallback(async () => {
    if (!userId) return;
    // Fetched once per load (not per result row) and merged client-side —
    // the same N+1 problem the RPC exists to avoid, just moved to a
    // different service, so this stays a single batch fetch.
    const [incoming, sent, accepted] = await Promise.all([
      listIncomingRequests(userId),
      listSentRequests(userId),
      listAcceptedConnections(userId),
    ]);
    const map: Record<string, ConnectionStatusValue> = {};
    incoming.forEach((item) => { map[item.otherProfile.id] = 'pending_received'; });
    sent.forEach((item) => { map[item.otherProfile.id] = 'pending_sent'; });
    accepted.forEach((item) => { map[item.otherProfile.id] = 'accepted'; });
    setStatusMap(map);
  }, [userId]);

  // Connection statuses have no dependency on the instrument/genre/radius
  // filters, so this is its own mount-time-only effect (keyed on userId,
  // same as loadConnectionStatuses itself) rather than living inside the
  // filtered-results effect below -- previously every chip toggle re-ran
  // this alongside the results fetch, tripling the query count per toggle
  // for no reason (the incoming/sent/accepted lists don't change when a
  // filter changes). Refresh-on-refocus is still handled separately by the
  // useFocusEffect below.
  useEffect(() => {
    loadConnectionStatuses();
  }, [loadConnectionStatuses]);

  // Fires once myCityLoaded flips true (gating the radius default), then
  // again on any instrument/genre/radius change, always resetting to page 0.
  useEffect(() => {
    if (!myCityLoaded) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const effectiveRadius = myMatchedCityId ? radiusMiles : null;
    discoverProfiles({
      instrumentIds: Array.from(selectedInstruments),
      genreIds: Array.from(selectedGenres),
      radiusMiles: effectiveRadius,
      pageLimit: PAGE_SIZE,
      pageOffset: 0,
    })
      .then((rows) => {
        if (cancelled) return;
        setResults(rows);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e.message ?? 'Could not load results.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [myCityLoaded, myMatchedCityId, selectedInstruments, selectedGenres, radiusMiles]);

  const isFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
        return;
      }
      // Silent refresh of connection statuses only (e.g. returning from a
      // profile after connecting) — not the filtered results list, so
      // scroll position and filter state aren't disturbed on every refocus.
      loadConnectionStatuses().catch(() => {});
    }, [loadConnectionStatuses])
  );

  async function handleLoadMore() {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      const nextPage = Math.floor(results.length / PAGE_SIZE);
      const rows = await discoverProfiles({
        instrumentIds: Array.from(selectedInstruments),
        genreIds: Array.from(selectedGenres),
        radiusMiles: myMatchedCityId ? radiusMiles : null,
        pageLimit: PAGE_SIZE,
        pageOffset: nextPage * PAGE_SIZE,
      });
      setResults((prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch {
      // Silently stop paginating.
    } finally {
      setLoadingMore(false);
    }
  }

  // useCallback so DiscoverRow's memoization below isn't defeated by a
  // fresh closure identity on every DiscoverScreen render.
  const handleConnect = useCallback(
    async (profileId: string) => {
      if (!userId) return;
      setBusyId(profileId);
      try {
        await sendRequest(userId, profileId);
        setStatusMap((prev) => ({ ...prev, [profileId]: 'pending_sent' }));
      } catch (e: any) {
        Alert.alert('Could not send request', e.message ?? 'Something went wrong.');
      } finally {
        setBusyId(null);
      }
    },
    [userId]
  );

  const handlePressProfile = useCallback(
    (profileId: string) => navigation.navigate('PublicProfile', { profileId }),
    [navigation]
  );

  const radiusDisabled = !myMatchedCityId;

  return (
    <View className="flex-1 bg-background">
      {loading && results.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <FlatList
          className="flex-1"
          data={results}
          keyExtractor={(item) => item.id}
          onEndReachedThreshold={0.5}
          onEndReached={handleLoadMore}
          ListHeaderComponent={
            <View className="px-4 pt-12 pb-2">
              <Text className="text-3xl font-bold text-foreground mb-3">Discover</Text>

              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-sm font-semibold text-foreground-secondary">Distance</Text>
                <TouchableOpacity
                  className="flex-row items-center gap-1.5"
                  disabled={radiusDisabled}
                  onPress={() => {
                    const nextAny = !distanceAny;
                    setDistanceAny(nextAny);
                    setRadiusMiles(nextAny ? null : sliderDraft);
                  }}
                >
                  <View
                    className={`w-4 h-4 rounded border items-center justify-center ${
                      radiusDisabled ? 'border-border-subtle' : distanceAny ? 'bg-accent border-accent' : 'border-border'
                    }`}
                  >
                    {distanceAny && <Ionicons name="checkmark" size={12} color={colors.onAccent} />}
                  </View>
                  <Text
                    className={`text-xs font-medium ${radiusDisabled ? 'text-foreground-muted' : 'text-foreground-secondary'}`}
                  >
                    Any distance
                  </Text>
                </TouchableOpacity>
              </View>
              <Slider
                disabled={radiusDisabled || distanceAny}
                minimumValue={DISTANCE_SLIDER_MIN}
                maximumValue={DISTANCE_SLIDER_MAX}
                step={1}
                value={sliderDraft}
                onValueChange={setSliderDraft}
                onSlidingComplete={(value) => {
                  setSliderDraft(value);
                  if (!distanceAny) setRadiusMiles(value);
                }}
                minimumTrackTintColor={colors.accent}
                maximumTrackTintColor={colors.borderSubtle}
                thumbTintColor={colors.accent}
                style={{ opacity: radiusDisabled || distanceAny ? 0.5 : 1 }}
              />
              {!distanceAny && (
                <Text className="text-xs text-foreground-muted -mt-1">{Math.round(sliderDraft)} mi</Text>
              )}
              {radiusDisabled && (
                <Text className="text-xs text-foreground-muted mt-1">
                  Set your city in Edit Profile to enable distance search.
                </Text>
              )}

              <View className="flex-row items-center justify-between mt-2 mb-1">
                <Text className="text-sm font-semibold text-foreground-secondary">Instruments</Text>
                {allInstruments.length > FILTER_COLLAPSE_COUNT && (
                  <TouchableOpacity onPress={() => setInstrumentsExpanded((e) => !e)}>
                    <Text className="text-accent text-xs font-semibold">
                      {instrumentsExpanded ? 'Collapse' : 'Expand'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <ChipToggleGroup
                items={allInstruments}
                getKey={(inst) => inst.id}
                getLabel={(inst) => inst.name}
                isSelected={(inst) => selectedInstruments.has(inst.id)}
                onToggle={(inst) => toggleInstrument(inst.id)}
                maxVisible={FILTER_COLLAPSE_COUNT}
                expanded={instrumentsExpanded}
              />

              <View className="flex-row items-center justify-between mt-2 mb-1">
                <Text className="text-sm font-semibold text-foreground-secondary">Genres</Text>
                {allGenres.length > FILTER_COLLAPSE_COUNT && (
                  <TouchableOpacity onPress={() => setGenresExpanded((e) => !e)}>
                    <Text className="text-accent text-xs font-semibold">
                      {genresExpanded ? 'Collapse' : 'Expand'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <ChipToggleGroup
                items={allGenres}
                getKey={(genre) => genre.id}
                getLabel={(genre) => genre.name}
                isSelected={(genre) => selectedGenres.has(genre.id)}
                onToggle={(genre) => toggleGenre(genre.id)}
                maxVisible={FILTER_COLLAPSE_COUNT}
                expanded={genresExpanded}
              />

              {error && (
                <View className="bg-danger-subtle border border-danger-line rounded-lg px-4 py-3 mt-3">
                  <Text className="text-danger text-sm">{error}</Text>
                </View>
              )}

              <View className="h-px bg-surface-alt mt-3" />
            </View>
          }
          ListEmptyComponent={
            !loading ? (
              <View className="items-center justify-center px-6 py-16">
                <Text className="text-base text-foreground-tertiary text-center">
                  No musicians match these filters yet.
                </Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            loadingMore ? (
              <View className="py-6">
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <DiscoverRow
              row={item}
              status={statusMap[item.id] ?? 'none'}
              busy={busyId === item.id}
              onPress={handlePressProfile}
              onConnect={handleConnect}
            />
          )}
        />
      )}
    </View>
  );
}

// Memoized so a statusMap/busyId change (handleConnect's optimistic update,
// or the useFocusEffect's silent connection-status refresh) only re-renders
// the rows whose own status/busy prop actually changed, not every visible
// row -- `results` itself is untouched by either of those, so unrelated
// rows' `row` prop keeps the same reference. Callback props are stable
// references from DiscoverScreen (see above), not per-row closures, so the
// memoization actually holds.
const DiscoverRow = memo(function DiscoverRow({
  row,
  status,
  busy,
  onPress,
  onConnect,
}: {
  row: DiscoverProfileRow;
  status: ConnectionStatusValue;
  busy: boolean;
  onPress: (profileId: string) => void;
  onConnect: (profileId: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View className="flex-row items-center justify-between py-3 px-4 border-b border-border-subtle">
      <TouchableOpacity
        activeOpacity={0.7}
        className="flex-row items-center flex-1 mr-3"
        onPress={() => onPress(row.id)}
      >
        <Avatar uri={row.avatar_url} name={row.display_name ?? row.username} size="lg" className="mr-3" />
        <View className="flex-1">
          <Text className="text-base font-bold text-foreground" numberOfLines={1}>
            {row.display_name ?? row.username}
          </Text>
          {(row.location_city || row.location_state || row.distance_miles != null) && (
            <Text className="text-xs text-foreground-muted" numberOfLines={1}>
              📍 {[row.location_city, row.location_state].filter(Boolean).join(', ')}
              {row.distance_miles != null ? ` · ${Math.round(row.distance_miles)} mi` : ''}
            </Text>
          )}
          {/* Cosmetic-only fake bio, not real profile data — see Known tech debt. */}
          <Text className="text-sm text-foreground-secondary mt-1" numberOfLines={2}>
            {fakeBioFor(row.id)}
          </Text>
          {(row.instruments.length > 0 || row.genres.length > 0) && (
            <View className="flex-row flex-wrap gap-1 mt-1">
              {row.instruments.slice(0, 3).map((inst) => (
                <View key={`i-${inst.id}`} className="px-2 py-0.5 rounded-full bg-surface-alt">
                  <Text className="text-xs text-foreground-tertiary">{inst.name}</Text>
                </View>
              ))}
              {row.genres.slice(0, 2).map((genre) => (
                <View key={`g-${genre.id}`} className="px-2 py-0.5 rounded-full border border-accent">
                  <Text className="text-xs text-accent">{genre.name}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </TouchableOpacity>
      {busy ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : status === 'accepted' ? (
        <View className="border border-success-line bg-success-subtle px-4 py-2 rounded-full">
          <Text className="text-success text-xs font-semibold">Connected</Text>
        </View>
      ) : status === 'pending_sent' || status === 'pending_received' ? (
        <View className="bg-surface-alt px-4 py-2 rounded-full">
          <Text className="text-foreground-tertiary text-xs font-semibold">Pending</Text>
        </View>
      ) : (
        <TouchableOpacity className="bg-accent px-4 py-2 rounded-full" onPress={() => onConnect(row.id)}>
          <Text className="text-on-accent text-xs font-semibold">Connect</Text>
        </TouchableOpacity>
      )}
    </View>
  );
});
