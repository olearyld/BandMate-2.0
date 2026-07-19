import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import { useAppContext } from '../../navigation/AppContext';
import type { FullProfile, ConnectionStatusInfo } from '../../lib/types';
import type { MainStackParamList } from '../../navigation/types';
import ProfileBody from '../../components/ProfileBody';
import { acceptRequest, cancelOrDeclineOrRemove, getConnectionStatus, sendRequest } from '../../lib/connections';

type Props = NativeStackScreenProps<MainStackParamList, 'PublicProfile'>;

export default function PublicProfileScreen({ route }: Props) {
  const { profileId } = route.params;
  const { session } = useAppContext();
  const viewerId = session?.user.id;
  const isOwnProfile = !!viewerId && viewerId === profileId;

  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Fetched in parallel with the profile below (independent tables, no data
  // dependency) rather than only starting once the profile finishes loading.
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatusInfo | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(!isOwnProfile);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data, error: err } = await supabase
        .from('profiles')
        .select(`
          *,
          profile_instruments(skill_level, instruments(id, name)),
          profile_genres(genre_id, genres(id, name))
        `)
        .eq('id', profileId)
        .returns<FullProfile>()
        .single();
      if (err) setProfileError(err.message);
      else setProfile(data);
      setProfileLoading(false);
    }
    load();
  }, [profileId]);

  const loadConnectionStatus = useCallback(async () => {
    if (!viewerId || isOwnProfile) {
      setConnectionLoading(false);
      return;
    }
    try {
      const info = await getConnectionStatus(viewerId, profileId);
      setConnectionStatus(info);
      setConnectionError(null);
    } catch (e: any) {
      setConnectionError(e.message ?? 'Could not load connection status.');
    } finally {
      setConnectionLoading(false);
    }
  }, [viewerId, profileId, isOwnProfile]);

  useEffect(() => {
    loadConnectionStatus();
  }, [loadConnectionStatus]);

  if (profileLoading) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#6C47FF" />
      </View>
    );
  }

  if (profileError || !profile) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-6">
        <Text className="text-red-600 text-center">{profileError ?? 'Profile not found.'}</Text>
      </View>
    );
  }

  return (
    <ProfileBody
      profile={profile}
      actionSlot={
        !isOwnProfile && viewerId ? (
          <ConnectAction
            viewerId={viewerId}
            profileId={profileId}
            status={connectionStatus}
            loading={connectionLoading}
            error={connectionError}
            onRefresh={loadConnectionStatus}
          />
        ) : undefined
      }
    />
  );
}

function ConnectAction({
  viewerId,
  profileId,
  status,
  loading,
  error,
  onRefresh,
}: {
  viewerId: string;
  profileId: string;
  status: ConnectionStatusInfo | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function runAction(action: () => Promise<void>, failureTitle: string) {
    setBusy(true);
    try {
      await action();
      await onRefresh();
    } catch (e: any) {
      Alert.alert(failureTitle, e.message ?? 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  function handleConnect() {
    runAction(() => sendRequest(viewerId, profileId), 'Could not send request');
  }

  function handleCancelOrDecline() {
    if (!status?.connectionId) return;
    runAction(() => cancelOrDeclineOrRemove(status.connectionId!), 'Something went wrong');
  }

  function handleAccept() {
    if (!status?.connectionId) return;
    runAction(() => acceptRequest(status.connectionId!), 'Could not accept request');
  }

  function handleRemove() {
    if (!status?.connectionId) return;
    Alert.alert('Remove connection?', 'You will no longer be connected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: handleCancelOrDecline },
    ]);
  }

  if (loading) return <ActivityIndicator size="small" color="#6C47FF" />;
  if (error) return <Text className="text-red-600 text-xs">{error}</Text>;
  if (!status) return null;

  if (busy) {
    return (
      <View className="px-6 py-2.5 rounded-full bg-gray-100 items-center self-start">
        <ActivityIndicator size="small" color="#6C47FF" />
      </View>
    );
  }

  if (status.status === 'none') {
    return (
      <TouchableOpacity className="bg-brand-primary px-6 py-2.5 rounded-full self-center" onPress={handleConnect}>
        <Text className="text-white font-semibold text-sm">Connect</Text>
      </TouchableOpacity>
    );
  }

  if (status.status === 'pending_sent') {
    return (
      <TouchableOpacity
        className="bg-gray-100 px-6 py-2.5 rounded-full self-center"
        onPress={handleCancelOrDecline}
      >
        <Text className="text-gray-500 font-semibold text-sm">Request Sent · Tap to cancel</Text>
      </TouchableOpacity>
    );
  }

  if (status.status === 'pending_received') {
    return (
      <View className="flex-row gap-2 self-center">
        <TouchableOpacity className="bg-brand-primary px-5 py-2.5 rounded-full" onPress={handleAccept}>
          <Text className="text-white font-semibold text-sm">Accept</Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="border border-gray-300 px-5 py-2.5 rounded-full"
          onPress={handleCancelOrDecline}
        >
          <Text className="text-gray-600 font-semibold text-sm">Decline</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // accepted
  return (
    <TouchableOpacity
      className="border border-green-300 bg-green-50 px-6 py-2.5 rounded-full self-center"
      onPress={handleRemove}
    >
      <Text className="text-green-700 font-semibold text-sm">✓ Connected · Remove</Text>
    </TouchableOpacity>
  );
}
