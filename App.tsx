import './global.css';
import { StatusBar, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppProvider } from './src/navigation/AppContext';
import RootNavigator from './src/navigation/RootNavigator';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { envBanner } from './src/theme/tokens';

// Set only by .env.test (via `npm run start:test`) — never by the default
// `npm start`, which loads .env (production) and leaves this undefined.
const IS_TEST_ENV = process.env.EXPO_PUBLIC_APP_ENV === 'test';

function AppShell() {
  const { colorScheme } = useTheme();

  return (
    <>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      {IS_TEST_ENV && (
        <SafeAreaView edges={['top']} style={{ backgroundColor: envBanner.background }}>
          <Text style={{ color: envBanner.text, textAlign: 'center', fontWeight: '700', paddingVertical: 4 }}>
            TEST PROJECT — seeded data, not production
          </Text>
        </SafeAreaView>
      )}
      <AppProvider>
        <RootNavigator />
      </AppProvider>
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
