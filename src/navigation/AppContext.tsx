import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';

type AppState = 'loading' | 'unauthenticated' | 'onboarding' | 'authenticated';

interface AppContextValue {
  appState: AppState;
  session: Session | null;
  refreshProfile: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [appState, setAppState] = useState<AppState>('loading');

  const resolveState = useCallback(async (s: Session | null) => {
    if (!s) {
      setSession(null);
      setAppState('unauthenticated');
      return;
    }
    setSession(s);
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', s.user.id)
        .maybeSingle();
      setAppState(data ? 'authenticated' : 'onboarding');
    } catch {
      // Network error checking profile — treat as onboarding so user can retry
      setAppState('onboarding');
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession();
    await resolveState(s);
  }, [resolveState]);

  useEffect(() => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        setAppState('unauthenticated');
      }
    }, 8000);

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolveState(s);
      }
    }).catch(() => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        setAppState('unauthenticated');
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      clearTimeout(timeout);
      resolveState(s);
    });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [resolveState]);

  return (
    <AppContext.Provider value={{ appState, session, refreshProfile }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used inside AppProvider');
  return ctx;
}
