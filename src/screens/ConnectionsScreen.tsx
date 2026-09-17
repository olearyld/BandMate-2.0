import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppContext } from '../navigation/AppContext';
import type { MainStackParamList } from '../navigation/types';
import type { ConnectionListItem } from '../lib/types';
import Avatar from '../components/Avatar';
import { useTheme } from '../theme/ThemeProvider';
import {
  acceptRequest,
  cancelOrDeclineOrRemove,
  listAcceptedConnections,
  listIncomingRequests,
  listSentRequests,
} from '../lib/connections';

type Section = 'requests' | 'sent' | 'connections';

// Embedded as the "Connections" segment of MyProfileScreen (Phase 8b) rather
// than a top-level tab route, so navigation is resolved via the hook instead
// of a route prop -- see CONVENTIONS.md.
export default function ConnectionsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { session } = useAppContext();
  const userId = session?.user.id;
  const { colors } = useTheme();

  const [section, setSection] = useState<Section>('requests');
  const [requests, setRequests] = useState<ConnectionListItem[]>([]);
  const [sent, setSent] = useState<ConnectionListItem[]>([]);
  const [connections, setConnections] = useState<ConnectionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!userId) return;
    const [reqs, sentReqs, conns] = await Promise.all([
      listIncomingRequests(userId),
      listSentRequests(userId),
      listAcceptedConnections(userId),
    ]);
    setRequests(reqs);
    setSent(sentReqs);
    setConnections(conns);
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    loadAll()
      .catch((e: any) => setError(e.message ?? 'Could not load connections.'))
      .finally(() => setLoading(false));
  }, [loadAll]);

  const isFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
        return; // initial load above already covers first mount
      }
      // Silent refresh on refocus (e.g. returning from a public profile after
      // sending/accepting/removing a connection) so lists stay current.
      loadAll().catch(() => {});
    }, [loadAll])
  );

  async function handleAccept(item: ConnectionListItem) {
    setBusyId(item.id);
    try {
      await acceptRequest(item.id);
      setRequests((prev) => prev.filter((r) => r.id !== item.id));
      setConnections((prev) => [{ id: item.id, otherProfile: item.otherProfile }, ...prev]);
    } catch (e: any) {
      Alert.alert('Could not accept request', e.message ?? 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeclineOrCancel(item: ConnectionListItem, list: 'requests' | 'sent') {
    setBusyId(item.id);
    try {
      await cancelOrDeclineOrRemove(item.id);
      if (list === 'requests') setRequests((prev) => prev.filter((r) => r.id !== item.id));
      else setSent((prev) => prev.filter((r) => r.id !== item.id));
    } catch (e: any) {
      Alert.alert('Something went wrong', e.message ?? 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  function handleRemove(item: ConnectionListItem) {
    const name = item.otherProfile.display_name ?? item.otherProfile.username;
    Alert.alert('Remove connection?', `You and ${name} will no longer be connected.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusyId(item.id);
          try {
            await cancelOrDeclineOrRemove(item.id);
            setConnections((prev) => prev.filter((c) => c.id !== item.id));
          } catch (e: any) {
            Alert.alert('Could not remove connection', e.message ?? 'Something went wrong.');
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  }

  function goToProfile(profileId: string) {
    navigation.navigate('PublicProfile', { profileId });
  }

  function goToThread(item: ConnectionListItem) {
    navigation.navigate('Thread', { otherUserId: item.otherProfile.id, otherProfile: item.otherProfile });
  }

  const sections: { key: Section; label: string; count: number }[] = [
    { key: 'requests', label: 'Requests', count: requests.length },
    { key: 'sent', label: 'Sent', count: sent.length },
    { key: 'connections', label: 'Connections', count: connections.length },
  ];

  const activeList = section === 'requests' ? requests : section === 'sent' ? sent : connections;

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 pt-4 pb-2">
        <View className="flex-row gap-2">
          {sections.map((s) => (
            <TouchableOpacity
              key={s.key}
              className={`flex-1 py-2 rounded-full border items-center ${
                section === s.key ? 'bg-accent border-accent' : 'border-border'
              }`}
              onPress={() => setSection(s.key)}
            >
              <Text
                className={`text-sm font-semibold ${section === s.key ? 'text-on-accent' : 'text-foreground-secondary'}`}
              >
                {s.label}
                {s.count > 0 ? ` (${s.count})` : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-danger text-center">{error}</Text>
        </View>
      ) : (
        <ScrollView contentContainerClassName="px-4 py-4 pb-24">
          {activeList.length === 0 ? (
            <View className="items-center justify-center py-24">
              <Text className="text-base text-foreground-tertiary text-center">
                {section === 'requests' && 'No incoming requests.'}
                {section === 'sent' && 'No pending sent requests.'}
                {section === 'connections' && 'No connections yet.'}
              </Text>
            </View>
          ) : (
            activeList.map((item) => (
              <ConnectionRow
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onPress={() => goToProfile(item.otherProfile.id)}
                actions={
                  section === 'requests' ? (
                    <View className="flex-row gap-2">
                      <TouchableOpacity
                        className="bg-accent px-3 py-1.5 rounded-full"
                        disabled={busyId === item.id}
                        onPress={() => handleAccept(item)}
                      >
                        <Text className="text-on-accent text-xs font-semibold">Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        className="border border-border px-3 py-1.5 rounded-full"
                        disabled={busyId === item.id}
                        onPress={() => handleDeclineOrCancel(item, 'requests')}
                      >
                        <Text className="text-foreground-secondary text-xs font-semibold">Decline</Text>
                      </TouchableOpacity>
                    </View>
                  ) : section === 'sent' ? (
                    <TouchableOpacity
                      className="border border-border px-3 py-1.5 rounded-full"
                      disabled={busyId === item.id}
                      onPress={() => handleDeclineOrCancel(item, 'sent')}
                    >
                      <Text className="text-foreground-secondary text-xs font-semibold">Cancel</Text>
                    </TouchableOpacity>
                  ) : (
                    <View className="flex-row gap-2">
                      <TouchableOpacity
                        className="bg-accent px-3 py-1.5 rounded-full"
                        disabled={busyId === item.id}
                        onPress={() => goToThread(item)}
                      >
                        <Text className="text-on-accent text-xs font-semibold">Message</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        className="border border-danger-line px-3 py-1.5 rounded-full"
                        disabled={busyId === item.id}
                        onPress={() => handleRemove(item)}
                      >
                        <Text className="text-danger text-xs font-semibold">Remove</Text>
                      </TouchableOpacity>
                    </View>
                  )
                }
              />
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

function ConnectionRow({
  item,
  busy,
  onPress,
  actions,
}: {
  item: ConnectionListItem;
  busy: boolean;
  onPress: () => void;
  actions: React.ReactNode;
}) {
  const { otherProfile } = item;
  const { colors } = useTheme();
  return (
    <View className="flex-row items-center justify-between py-3 border-b border-border-subtle">
      <TouchableOpacity className="flex-row items-center flex-1 mr-3" onPress={onPress}>
        <Avatar
          uri={otherProfile.avatar_url}
          name={otherProfile.display_name ?? otherProfile.username}
          size="lg"
          className="mr-3"
        />
        <View className="flex-1">
          <Text className="text-base font-bold text-foreground" numberOfLines={1}>
            {otherProfile.display_name ?? otherProfile.username}
          </Text>
          <Text className="text-xs text-foreground-muted">@{otherProfile.username}</Text>
        </View>
      </TouchableOpacity>
      {busy ? <ActivityIndicator size="small" color={colors.accent} /> : actions}
    </View>
  );
}
