import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  uri: string;
}

export default function AudioPlayer({ uri }: Props) {
  const { colors } = useTheme();
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
    <View className="bg-surface-alt rounded-xl px-4 py-4 flex-row items-center gap-4">
      <TouchableOpacity
        className="w-12 h-12 rounded-full bg-accent items-center justify-center"
        onPress={toggle}
        disabled={!status.isLoaded}
      >
        {!status.isLoaded ? (
          <ActivityIndicator color={colors.onAccent} size="small" />
        ) : (
          <Text className="text-on-accent text-xl">{status.playing ? '⏸' : '▶'}</Text>
        )}
      </TouchableOpacity>
      <View className="flex-1">
        <View className="h-1.5 bg-surface-alt rounded-full overflow-hidden mb-1">
          <View
            className="h-full bg-accent rounded-full"
            style={{ width: `${progress * 100}%` }}
          />
        </View>
        <Text className="text-xs text-foreground-muted">
          {formatTime(status.currentTime)}
          {status.duration > 0 ? ` / ${formatTime(status.duration)}` : ''}
        </Text>
      </View>
    </View>
  );
}
