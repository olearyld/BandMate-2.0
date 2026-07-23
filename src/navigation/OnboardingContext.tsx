import React, { createContext, useContext, useMemo, useState } from 'react';
import type { ExperienceLevel, MediaType } from '../lib/types';

export interface OnboardingDraft {
  username?: string;
  display_name?: string | null;
  location_city?: string | null;
  location_state?: string | null;
  matched_city_id?: string | null;
  instruments?: Record<number, ExperienceLevel>;
  genres?: number[];
  bio?: string | null;
  intro_media_uri?: string | null;
  intro_media_type?: MediaType | null;
}

interface OnboardingContextValue {
  draft: OnboardingDraft;
  setDraft: (draft: OnboardingDraft) => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<OnboardingDraft>({});
  // Memoized so every one of the 4 onboarding steps' useOnboarding() consumers
  // doesn't re-render on an OnboardingProvider re-render that didn't actually
  // change draft/setDraft -- setDraft is already stable (useState's setter),
  // so this only recomputes when draft itself changes.
  const value = useMemo(() => ({ draft, setDraft }), [draft]);
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used inside OnboardingProvider');
  return ctx;
}
