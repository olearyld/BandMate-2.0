import { View, Text } from 'react-native';

export default function MessagesScreen() {
  return (
    <View className="flex-1 bg-white items-center justify-center px-6">
      <Text className="text-2xl font-bold text-gray-900 mb-2">Messages</Text>
      <Text className="text-base text-gray-500 text-center">
        Messages coming soon — connect and chat with other musicians.
      </Text>
    </View>
  );
}
