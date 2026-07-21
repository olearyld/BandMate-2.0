import { useCallback, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import LoginScreen from '../screens/auth/LoginScreen';
import SignUpScreen from '../screens/auth/SignUpScreen';
import Step1BasicInfo from '../screens/onboarding/Step1BasicInfo';
import Step2Instruments from '../screens/onboarding/Step2Instruments';
import Step3Genres from '../screens/onboarding/Step3Genres';
import Step4Media from '../screens/onboarding/Step4Media';
import FeedScreen from '../screens/FeedScreen';
import DiscoverScreen from '../screens/DiscoverScreen';
import ConnectionsScreen from '../screens/ConnectionsScreen';
import ConversationsListScreen from '../screens/ConversationsListScreen';
import ThreadScreen from '../screens/ThreadScreen';
import MyProfileScreen from '../screens/profile/MyProfileScreen';
import PublicProfileScreen from '../screens/profile/PublicProfileScreen';
import PostDetailScreen from '../screens/PostDetailScreen';
import CreatePostScreen from '../screens/CreatePostScreen';
import { OnboardingProvider } from './OnboardingContext';
import { useAppContext } from './AppContext';
import { getUnreadCount, subscribeToUnreadCount } from '../lib/messages';

import type {
  AuthStackParamList,
  OnboardingStackParamList,
  MainTabParamList,
  MainStackParamList,
} from './types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const OnboardingStack = createNativeStackNavigator<OnboardingStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const MainStack = createNativeStackNavigator<MainStackParamList>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="SignUp" component={SignUpScreen} />
    </AuthStack.Navigator>
  );
}

function OnboardingNavigator() {
  return (
    <OnboardingProvider>
      <OnboardingStack.Navigator screenOptions={{ headerShown: false }}>
        <OnboardingStack.Screen name="Step1" component={Step1BasicInfo} />
        <OnboardingStack.Screen name="Step2" component={Step2Instruments} />
        <OnboardingStack.Screen name="Step3" component={Step3Genres} />
        <OnboardingStack.Screen name="Step4" component={Step4Media} />
      </OnboardingStack.Navigator>
    </OnboardingProvider>
  );
}

/**
 * Unread-message count for the Messages tab badge. Kept live by
 * subscribeToUnreadCount's realtime subscription (see src/lib/messages.ts —
 * the one place messaging Realtime subscriptions live), plus an explicit
 * `refresh()` exposed for the `tabPress` listener below: MainTabs itself
 * never unmounts, so a plain useFocusEffect on the tab screen wouldn't fire
 * on every re-tap of an already-active tab, and a resync independent of the
 * realtime channel is worth having since Postgres Changes doesn't replay
 * events missed during a brief disconnect.
 */
function useUnreadMessageBadge(userId: string | undefined) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!userId) return;
    getUnreadCount().then(setCount).catch(() => {});
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    refresh();
    return subscribeToUnreadCount(userId, setCount);
  }, [userId, refresh]);

  return { count, refresh };
}

function MainTabs() {
  const { session } = useAppContext();
  const { count: unreadCount, refresh: refreshUnreadBadge } = useUnreadMessageBadge(session?.user.id);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#6C47FF',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: { borderTopColor: '#F3F4F6' },
      }}
    >
      <Tab.Screen
        name="Feed"
        component={FeedScreen}
        options={{ title: 'Feed', tabBarIcon: () => <Text style={{ fontSize: 20 }}>🎵</Text> }}
      />
      <Tab.Screen
        name="Discover"
        component={DiscoverScreen}
        options={{ title: 'Discover', tabBarIcon: () => <Text style={{ fontSize: 20 }}>🔎</Text> }}
      />
      <Tab.Screen
        name="Connections"
        component={ConnectionsScreen}
        options={{ title: 'Connections', tabBarIcon: () => <Text style={{ fontSize: 20 }}>🤝</Text> }}
      />
      <Tab.Screen
        name="MyProfile"
        component={MyProfileScreen}
        options={{ title: 'Profile', tabBarIcon: () => <Text style={{ fontSize: 20 }}>👤</Text> }}
      />
      <Tab.Screen
        name="Messages"
        component={ConversationsListScreen}
        options={{
          title: 'Messages',
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>💬</Text>,
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
        }}
        listeners={{ tabPress: () => refreshUnreadBadge() }}
      />
    </Tab.Navigator>
  );
}

function MainNavigator() {
  return (
    <MainStack.Navigator screenOptions={{ headerShown: false }}>
      <MainStack.Screen name="Tabs" component={MainTabs} />
      <MainStack.Screen
        name="PublicProfile"
        component={PublicProfileScreen}
        options={{ headerShown: true, title: 'Profile' }}
      />
      <MainStack.Screen
        name="PostDetail"
        component={PostDetailScreen}
        options={{ headerShown: true, title: 'Post' }}
      />
      <MainStack.Screen
        name="CreatePost"
        component={CreatePostScreen}
        options={{ headerShown: true, title: 'New Post', presentation: 'modal' }}
      />
      <MainStack.Screen
        name="Thread"
        component={ThreadScreen}
        options={({ route }) => ({
          headerShown: true,
          title: route.params.otherProfile?.display_name ?? route.params.otherProfile?.username ?? 'Message',
        })}
      />
    </MainStack.Navigator>
  );
}

export default function RootNavigator() {
  const { appState } = useAppContext();

  if (appState === 'loading') {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" color="#6C47FF" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {appState === 'unauthenticated' && <AuthNavigator />}
      {appState === 'onboarding' && <OnboardingNavigator />}
      {appState === 'authenticated' && <MainNavigator />}
    </NavigationContainer>
  );
}
