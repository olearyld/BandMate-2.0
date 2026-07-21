import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// The only place push-token registration logic lives — AppContext calls
// registerPushToken()/subscribeToPushTokenChanges() on the authenticated
// transition (see AppContext.tsx) rather than duplicating this elsewhere.
//
// Requesting permission here — on the authenticated transition, which covers
// both "just finished onboarding" and "existing user signed in on a new
// device" — rather than at app launch (before we even know if there's a
// session) or bolted onto one specific onboarding screen (which would miss
// the returning-user-on-a-new-device case Task 3 explicitly asks for).

/**
 * Requests notification permission (if not already decided) and, if
 * granted, fetches an Expo push token and upserts it for profileId. Silent,
 * best-effort throughout — a user declining permission, being offline, or
 * running somewhere push isn't available (Simulator, Expo Go on Android
 * SDK 53+) are all expected, not error conditions.
 */
export async function registerPushToken(profileId: string): Promise<void> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return;

  if (Platform.OS === 'android') {
    // Required before requesting a token on Android 13+ — creates the
    // channel notify_push_webhook's payload will actually confirm
    // (`defaultChannel: "default"` in app.json's expo-notifications plugin
    // config), not just declares it here disconnected from the manifest.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  // getExpoPushTokenAsync needs an EAS project id (app.json's
  // extra.eas.projectId, normally populated by `eas init`/`eas build`) — no
  // EAS project exists for this app yet, so this is expected to no-op until
  // one is set up. See CONVENTIONS.md; not something client code can create.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return;

  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    token = result.data;
  } catch {
    return;
  }

  await upsertPushToken(profileId, token);
}

async function upsertPushToken(profileId: string, token: string): Promise<void> {
  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { profile_id: profileId, expo_push_token: token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
      { onConflict: 'profile_id,expo_push_token' }
    );
  if (error) throw error;
}

/**
 * Handles the rare case where the underlying device push token changes
 * during app runtime (see expo-notifications' own docs on
 * addPushTokenListener). Re-runs the full registration flow rather than
 * upserting the listener's own payload directly — that payload is the raw
 * native FCM/APNs token, not the Expo-formatted one push_tokens stores.
 */
export function subscribeToPushTokenChanges(profileId: string): () => void {
  const subscription = Notifications.addPushTokenListener(() => {
    registerPushToken(profileId).catch(() => {});
  });
  return () => subscription.remove();
}
