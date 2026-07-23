import type { StoryGroup } from '../lib/types';

export type AuthStackParamList = {
  Login: undefined;
  SignUp: undefined;
};

export type OnboardingStackParamList = {
  Step1: undefined;
  Step2: undefined;
  Step3: undefined;
  Step4: undefined;
};

export type MainTabParamList = {
  Feed: undefined;
  Discover: undefined;
  Connections: undefined;
  MyProfile: undefined;
  Messages: undefined;
};

export type MainStackParamList = {
  Tabs: undefined;
  PublicProfile: { profileId: string };
  PostDetail: { postId: string };
  CreatePost: undefined;
  Thread: {
    otherUserId: string;
    otherProfile?: { id: string; username: string; display_name: string | null; avatar_url: string | null };
  };
  CreateStory: undefined;
  // groups/startIndex are passed directly from FeedScreen, which already has
  // the active story groups loaded for the tray -- same "pass what the
  // caller already has" optimization Thread's otherProfile param uses,
  // except non-optional here since there's no other entry point into the
  // viewer yet that wouldn't already have this loaded.
  StoryViewer: { groups: StoryGroup[]; startIndex: number };
};
