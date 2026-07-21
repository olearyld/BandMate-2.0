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
};
