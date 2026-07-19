import './global.css';
import { Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppProvider } from './src/navigation/AppContext';
import RootNavigator from './src/navigation/RootNavigator';

// Set only by .env.test (via `npm run start:test`) — never by the default
// `npm start`, which loads .env (production) and leaves this undefined.
const IS_TEST_ENV = process.env.EXPO_PUBLIC_APP_ENV === 'test';

export default function App() {
  return (
    <SafeAreaProvider>
      {IS_TEST_ENV && (
        <SafeAreaView edges={['top']} style={{ backgroundColor: '#dc2626' }}>
          <Text style={{ color: 'white', textAlign: 'center', fontWeight: '700', paddingVertical: 4 }}>
            TEST PROJECT — seeded data, not production
          </Text>
        </SafeAreaView>
      )}
      <AppProvider>
        <RootNavigator />
      </AppProvider>
    </SafeAreaProvider>
  );
}
