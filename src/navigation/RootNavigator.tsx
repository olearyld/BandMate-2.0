import React from 'react';
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
import MessagesScreen from '../screens/MessagesScreen';
import MyProfileScreen from '../screens/profile/MyProfileScreen';
import PublicProfileScreen from '../screens/profile/PublicProfileScreen';
import PostDetailScreen from '../screens/PostDetailScreen';
import CreatePostScreen from '../screens/CreatePostScreen';
import { OnboardingProvider } from './OnboardingContext';
import { useAppContext } from './AppContext';

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

function MainTabs() {
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
        name="MyProfile"
        component={MyProfileScreen}
        options={{ title: 'Profile', tabBarIcon: () => <Text style={{ fontSize: 20 }}>👤</Text> }}
      />
      <Tab.Screen
        name="Messages"
        component={MessagesScreen}
        options={{ title: 'Messages', tabBarIcon: () => <Text style={{ fontSize: 20 }}>💬</Text> }}
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
