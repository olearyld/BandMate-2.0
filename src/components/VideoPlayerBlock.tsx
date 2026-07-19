import { useVideoPlayer, VideoView } from 'expo-video';

export default function VideoPlayerBlock({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return (
    <VideoView
      player={player}
      style={{ width: '100%', height: 240, borderRadius: 12 }}
      nativeControls
    />
  );
}
