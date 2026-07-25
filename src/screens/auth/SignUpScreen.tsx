import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../../lib/supabase';
import type { AuthStackParamList } from '../../navigation/types';
import { useTheme } from '../../theme/ThemeProvider';

type Props = NativeStackScreenProps<AuthStackParamList, 'SignUp'>;

export default function SignUpScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignUp() {
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    try {
      const { data, error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      if (!data.user) {
        setError('Account creation failed. Please try again.');
        setLoading(false);
        return;
      }

      // Dev-only: bypass email confirmation. Remove when enabling Supabase email confirmation.
      if (__DEV__) {
        await supabase.rpc('dev_confirm_user_email', { user_id: data.user.id });
      }

      // Sign in immediately now that email is confirmed.
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }
      // onAuthStateChange in AppContext fires → navigates to onboarding
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerClassName="flex-grow justify-center px-6 py-12">
        <Text className="text-3xl font-bold text-foreground mb-2">Join Bandmate</Text>
        <Text className="text-base text-foreground-tertiary mb-8">Find your next bandmate</Text>

        {error && (
          <View className="bg-danger-subtle border border-danger-line rounded-lg px-4 py-3 mb-4">
            <Text className="text-danger text-sm">{error}</Text>
          </View>
        )}

        <Text className="text-sm font-medium text-foreground-secondary mb-1">Email</Text>
        <TextInput
          className="border border-border rounded-lg px-4 py-3 text-base text-foreground mb-4"
          placeholder="you@example.com"
          placeholderTextColor={colors.foregroundMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />

        <Text className="text-sm font-medium text-foreground-secondary mb-1">Password</Text>
        <TextInput
          className="border border-border rounded-lg px-4 py-3 text-base text-foreground mb-4"
          placeholder="••••••••"
          placeholderTextColor={colors.foregroundMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        <Text className="text-sm font-medium text-foreground-secondary mb-1">Confirm password</Text>
        <TextInput
          className="border border-border rounded-lg px-4 py-3 text-base text-foreground mb-6"
          placeholder="••••••••"
          placeholderTextColor={colors.foregroundMuted}
          secureTextEntry
          value={confirmPassword}
          onChangeText={setConfirmPassword}
        />

        <TouchableOpacity
          className="bg-accent rounded-lg py-4 items-center mb-4"
          onPress={handleSignUp}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text className="text-on-accent font-semibold text-base">Create account</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Login')}>
          <Text className="text-center text-foreground-tertiary">
            Already have an account?{' '}
            <Text className="text-accent font-semibold">Log in</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
