import { Image, View, Text } from 'react-native';

const SIZES = {
  sm: { box: 'w-7 h-7', text: 'text-xs' },
  md: { box: 'w-9 h-9', text: 'text-sm' },
  lg: { box: 'w-11 h-11', text: 'text-base' },
  xl: { box: 'w-24 h-24', text: 'text-3xl' },
} as const;

export default function Avatar({
  uri,
  name,
  size = 'md',
  className = '',
}: {
  uri: string | null;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { box, text } = SIZES[size];
  if (uri) {
    return <Image source={{ uri }} className={`${box} rounded-full ${className}`} />;
  }
  return (
    <View className={`${box} rounded-full bg-brand-primary items-center justify-center ${className}`}>
      <Text className={`text-white font-bold ${text}`}>{name[0]?.toUpperCase() ?? '?'}</Text>
    </View>
  );
}
