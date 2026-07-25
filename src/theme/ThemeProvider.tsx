import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme as useSystemColorScheme, View } from 'react-native';
import { vars } from 'nativewind';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ColorScheme,
  colorsFor,
  varsFor,
  radius,
  spacing,
  typography,
  elevation,
  ThemeColors,
} from './tokens';

export type ThemePreference = 'system' | ColorScheme;

const STORAGE_KEY = '@bandmate/theme-preference';

type ThemeContextValue = {
  colorScheme: ColorScheme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  colors: ThemeColors;
  typography: typeof typography;
  spacing: typeof spacing;
  radius: typeof radius;
  elevation: typeof elevation;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setPreferenceState(stored);
      }
      setLoaded(true);
    });
  }, []);

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  };

  const colorScheme: ColorScheme =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      colorScheme,
      preference,
      setPreference,
      colors: colorsFor(colorScheme),
      typography,
      spacing,
      radius,
      elevation,
    }),
    [colorScheme, preference]
  );

  // Wait for the persisted preference to load before rendering, so the
  // app never flashes light mode for a frame on a device with a saved
  // dark-mode override.
  if (!loaded) return null;

  return (
    <ThemeContext.Provider value={value}>
      <View style={[{ flex: 1 }, vars(varsFor(colorScheme))]}>{children}</View>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
