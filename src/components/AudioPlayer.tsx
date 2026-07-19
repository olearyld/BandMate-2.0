import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

interface Props {
  uri: string;
}

export default function AudioPlayer({ uri }: Props) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  function toggle() {
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  }

  function formatTime(seconds: number) {
    const s = Math.floor(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;

  return (
    <View className="bg-gray-50 rounded-xl px-4 py-4 flex-row items-center gap-4">
      <TouchableOpacity
        className="w-12 h-12 rounded-full bg-brand-primary items-center justify-center"
        onPress={toggle}
        disabled={!status.isLoaded}
      >
        {!status.isLoaded ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text className="text-white text-xl">{status.playing ? '⏸' : '▶'}</Text>
        )}
      </TouchableOpacity>
      <View className="flex-1">
        <View className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-1">
          <View
            className="h-full bg-brand-primary rounded-full"
            style={{ width: `${progress * 100}%` }}
          />
        </View>
        <Text className="text-xs text-gray-400">
          {formatTime(status.currentTime)}
          {status.duration > 0 ? ` / ${formatTime(status.duration)}` : ''}
        </Text>
      </View>
    </View>
  );
}
