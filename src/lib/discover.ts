import { supabase } from './supabase';
import type { DiscoverProfileRow } from './types';

// The only place the discover_profiles RPC is called from — DiscoverScreen
// consumes this rather than calling supabase.rpc() directly, matching the
// src/lib/connections.ts pattern (single source of truth per concern).

export interface DiscoverFilters {
  instrumentIds: number[];
  genreIds: number[];
  radiusMiles: number | null;
  pageLimit: number;
  pageOffset: number;
}

export async function discoverProfiles(filters: DiscoverFilters): Promise<DiscoverProfileRow[]> {
  const { data, error } = await supabase
    .rpc('discover_profiles', {
      instrument_ids: filters.instrumentIds,
      genre_ids: filters.genreIds,
      // The generated RPC Args type is `number | undefined` (from the SQL
      // param's `default null`), not `number | null` — pass undefined for
      // "no radius filter" rather than null; same runtime effect via
      // PostgREST (an omitted arg falls back to the SQL default).
      radius_miles: filters.radiusMiles ?? undefined,
      page_limit: filters.pageLimit,
      page_offset: filters.pageOffset,
    })
    .returns<DiscoverProfileRow[]>();
  if (error) throw error;
  return data ?? [];
}
