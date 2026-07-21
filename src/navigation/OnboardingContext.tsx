import React, { createContext, useContext, useState } from 'react';
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
  return (
    <OnboardingContext.Provider value={{ draft, setDraft }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used inside OnboardingProvider');
  return ctx;
}
