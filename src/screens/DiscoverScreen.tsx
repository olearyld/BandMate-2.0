import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
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

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Discover'>,
  NativeStackScreenProps<MainStackParamList>
>;

const PAGE_SIZE = 20;
const RADIUS_OPTIONS = [10, 25, 50, 100];

export default function DiscoverScreen({ navigation }: Props) {
  const { session } = useAppContext();
  const userId = session?.user.id;

  const [allInstruments, setAllInstruments] = useState<Instrument[]>([]);
  const [allGenres, setAllGenres] = useState<Genre[]>([]);
  const [selectedInstruments, setSelectedInstruments] = useState<Set<number>>(new Set());
  const [selectedGenres, setSelectedGenres] = useState<Set<number>>(new Set());
  const [radiusMiles, setRadiusMiles] = useState<number | null>(null);

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

  const toggleInstrument = toggleInSet(setSelectedInstruments);
  const toggleGenre = toggleInSet(setSelectedGenres);

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

  // Single effect for both the initial load and any filter change — fires
  // once myCityLoaded flips true (gating the radius default), then again on
  // any instrument/genre/radius change, always resetting to page 0.
  useEffect(() => {
    if (!myCityLoaded) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const effectiveRadius = myMatchedCityId ? radiusMiles : null;
    Promise.all([
      discoverProfiles({
        instrumentIds: Array.from(selectedInstruments),
        genreIds: Array.from(selectedGenres),
        radiusMiles: effectiveRadius,
        pageLimit: PAGE_SIZE,
        pageOffset: 0,
      }),
      loadConnectionStatuses(),
    ])
      .then(([rows]) => {
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
  }, [myCityLoaded, myMatchedCityId, selectedInstruments, selectedGenres, radiusMiles, loadConnectionStatuses]);

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

  async function handleConnect(profileId: string) {
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
  }

  const radiusDisabled = !myMatchedCityId;

  return (
    <View className="flex-1 bg-white">
      {loading && results.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#6C47FF" />
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
              <Text className="text-2xl font-bold text-gray-900 mb-4">Discover</Text>

              <Text className="text-sm font-semibold text-gray-700 mb-2">Distance</Text>
              <View className="flex-row flex-wrap gap-2 mb-1">
                {[{ label: 'Any distance', value: null as number | null }, ...RADIUS_OPTIONS.map((mi) => ({ label: `${mi} mi`, value: mi }))].map(
                  (opt) => {
                    const isSel = radiusMiles === opt.value;
                    return (
                      <TouchableOpacity
                        key={opt.label}
                        disabled={radiusDisabled}
                        onPress={() => setRadiusMiles(opt.value)}
                        className={`px-4 py-2 rounded-full border ${
                          radiusDisabled
                            ? 'border-gray-200'
                            : isSel
                              ? 'bg-brand-primary border-brand-primary'
                              : 'border-gray-300'
                        }`}
                      >
                        <Text
                          className={`text-sm font-medium ${
                            radiusDisabled ? 'text-gray-300' : isSel ? 'text-white' : 'text-gray-700'
                          }`}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  }
                )}
              </View>
              {radiusDisabled && (
                <Text className="text-xs text-gray-400 mb-3">
                  Set your city in Edit Profile to enable distance search.
                </Text>
              )}

              <Text className="text-sm font-semibold text-gray-700 mt-3 mb-2">Instruments</Text>
              <ChipToggleGroup
                items={allInstruments}
                getKey={(inst) => inst.id}
                getLabel={(inst) => inst.name}
                isSelected={(inst) => selectedInstruments.has(inst.id)}
                onToggle={(inst) => toggleInstrument(inst.id)}
              />

              <Text className="text-sm font-semibold text-gray-700 mt-4 mb-2">Genres</Text>
              <ChipToggleGroup
                items={allGenres}
                getKey={(genre) => genre.id}
                getLabel={(genre) => genre.name}
                isSelected={(genre) => selectedGenres.has(genre.id)}
                onToggle={(genre) => toggleGenre(genre.id)}
              />

              {error && (
                <View className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mt-4">
                  <Text className="text-red-700 text-sm">{error}</Text>
                </View>
              )}

              <View className="h-px bg-gray-100 mt-4" />
            </View>
          }
          ListEmptyComponent={
            !loading ? (
              <View className="items-center justify-center px-6 py-16">
                <Text className="text-base text-gray-500 text-center">
                  No musicians match these filters yet.
                </Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            loadingMore ? (
              <View className="py-6">
                <ActivityIndicator color="#6C47FF" />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <DiscoverRow
              row={item}
              status={statusMap[item.id] ?? 'none'}
              busy={busyId === item.id}
              onPress={() => navigation.navigate('PublicProfile', { profileId: item.id })}
              onConnect={() => handleConnect(item.id)}
            />
          )}
        />
      )}
    </View>
  );
}

function DiscoverRow({
  row,
  status,
  busy,
  onPress,
  onConnect,
}: {
  row: DiscoverProfileRow;
  status: ConnectionStatusValue;
  busy: boolean;
  onPress: () => void;
  onConnect: () => void;
}) {
  return (
    <View className="flex-row items-center justify-between py-3 px-4 border-b border-gray-100">
      <TouchableOpacity activeOpacity={0.7} className="flex-row items-center flex-1 mr-3" onPress={onPress}>
        <Avatar uri={row.avatar_url} name={row.display_name ?? row.username} size="lg" className="mr-3" />
        <View className="flex-1">
          <Text className="text-base font-semibold text-gray-900" numberOfLines={1}>
            {row.display_name ?? row.username}
          </Text>
          {(row.location_city || row.location_state || row.distance_miles != null) && (
            <Text className="text-xs text-gray-400" numberOfLines={1}>
              📍 {[row.location_city, row.location_state].filter(Boolean).join(', ')}
              {row.distance_miles != null ? ` · ${Math.round(row.distance_miles)} mi` : ''}
            </Text>
          )}
          {(row.instruments.length > 0 || row.genres.length > 0) && (
            <View className="flex-row flex-wrap gap-1 mt-1">
              {row.instruments.slice(0, 3).map((inst) => (
                <View key={`i-${inst.id}`} className="px-2 py-0.5 rounded-full bg-gray-100">
                  <Text className="text-xs text-gray-500">{inst.name}</Text>
                </View>
              ))}
              {row.genres.slice(0, 2).map((genre) => (
                <View key={`g-${genre.id}`} className="px-2 py-0.5 rounded-full bg-purple-50 border border-purple-200">
                  <Text className="text-xs text-brand-primary">{genre.name}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </TouchableOpacity>
      {busy ? (
        <ActivityIndicator size="small" color="#6C47FF" />
      ) : status === 'accepted' ? (
        <View className="border border-green-300 bg-green-50 px-4 py-2 rounded-full">
          <Text className="text-green-700 text-xs font-semibold">Connected</Text>
        </View>
      ) : status === 'pending_sent' || status === 'pending_received' ? (
        <View className="bg-gray-100 px-4 py-2 rounded-full">
          <Text className="text-gray-500 text-xs font-semibold">Pending</Text>
        </View>
      ) : (
        <TouchableOpacity className="bg-brand-primary px-4 py-2 rounded-full" onPress={onConnect}>
          <Text className="text-white text-xs font-semibold">Connect</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
