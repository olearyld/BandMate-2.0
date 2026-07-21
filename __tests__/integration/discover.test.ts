/**
 * Integration tests for the discover_profiles RPC (Phase 4b), against the
 * dedicated test Supabase project — never production. See CONVENTIONS.md.
 *
 * Fixture design deliberately deviates from rls.test.ts's
 * withDisposableConnection() pattern: there's no mutable per-run state to
 * clean up here (discover_profiles is read-only), so instead of
 * insert-then-delete-in-finally, this suite uses six FIXED, permanently
 * bootstrapped fixture profiles (bandmate.discover.fixture.*@gmail.com),
 * SQL-bootstrapped once via the Supabase MCP's elevated execute_sql access
 * — same technique, same rate-limit-avoidance reasoning, as the three
 * bandmate.rls.fixture.{a,b,c}@gmail.com accounts in rls.test.ts, just with
 * controlled instrument/genre/matched_city_id data baked in up front rather
 * than assembled per test run:
 *   - discover.caller         — matched_city_id: Boulder, CO. The "viewer"
 *                                for most tests.
 *   - discover.caller-nocity  — no matched_city_id. Used only for the
 *                                "caller has no matched city -> radius
 *                                silently ignored" case.
 *   - discover.near           — Denver, CO (~24 mi from Boulder). Guitar,
 *                                Rock.
 *   - discover.mid            — Fort Collins, CO (~41 mi from Boulder).
 *                                Drums, Jazz.
 *   - discover.far            — Austin, TX (~800 mi from Boulder). Guitar,
 *                                Jazz.
 *   - discover.nomatch        — no matched_city_id, no instruments, no
 *                                genres.
 * If these fixtures don't exist yet on a from-scratch test project, this
 * suite fails fast with a clear sign-in error rather than attempting a
 * signUp() fallback — unlike rls.test.ts's fallback, a bare signed-up
 * profile wouldn't have the instrument/genre/city data these specific
 * tests depend on, so a "successful" fallback would just produce confusing
 * failures later. Re-run the bootstrap SQL (see this file's git history /
 * CONVENTIONS.md) against a fresh project instead.
 *
 * Result-set assertions never rely on exact total counts from the RPC —
 * the test project also carries rls.test.ts's fixtures and scripts/seed.js
 * data, which legitimately also play instruments/have genres/etc. Every
 * assertion here checks only for the presence/absence of these six known
 * fixture ids within a result set, which is robust to that other data.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/lib/database.types';
import { makeClient, signIn } from './testHelpers';

jest.setTimeout(30000);

describe('discover_profiles RPC', () => {
  let callerClient: SupabaseClient<Database>;
  let callerNoCityClient: SupabaseClient<Database>;

  let callerId: string;
  let callerNoCityId: string;
  let nearId: string;
  let midId: string;
  let farId: string;
  let nomatchId: string;

  let guitarId: number;
  let drumsId: number;
  let rockId: number;
  let jazzId: number;

  beforeAll(async () => {
    callerClient = makeClient();
    callerNoCityClient = makeClient();

    callerId = await signIn(callerClient, 'bandmate.discover.fixture.caller@gmail.com');
    callerNoCityId = await signIn(callerNoCityClient, 'bandmate.discover.fixture.caller-nocity@gmail.com');

    const { data: profiles, error: profErr } = await callerClient
      .from('profiles')
      .select('id, username')
      .in('username', ['discover_near', 'discover_mid', 'discover_far', 'discover_nomatch']);
    if (profErr || !profiles) throw new Error(`could not resolve candidate fixtures: ${profErr?.message}`);
    const byUsername = Object.fromEntries(profiles.map((p) => [p.username, p.id]));
    nearId = byUsername['discover_near'];
    midId = byUsername['discover_mid'];
    farId = byUsername['discover_far'];
    nomatchId = byUsername['discover_nomatch'];
    if (!nearId || !midId || !farId || !nomatchId) {
      throw new Error('one or more discover_* candidate fixtures are missing — re-run the bootstrap SQL.');
    }

    const { data: instruments } = await callerClient
      .from('instruments')
      .select('id, name')
      .in('name', ['Guitar', 'Drums']);
    guitarId = instruments!.find((i) => i.name === 'Guitar')!.id;
    drumsId = instruments!.find((i) => i.name === 'Drums')!.id;

    const { data: genres } = await callerClient.from('genres').select('id, name').in('name', ['Rock', 'Jazz']);
    rockId = genres!.find((g) => g.name === 'Rock')!.id;
    jazzId = genres!.find((g) => g.name === 'Jazz')!.id;
  });

  afterAll(async () => {
    await Promise.all([callerClient?.auth.signOut(), callerNoCityClient?.auth.signOut()]);
  });

  function idsOf(rows: { id: string }[]): string[] {
    return rows.map((r) => r.id);
  }

  it('never includes the caller in their own results, filtered or not', async () => {
    const { data, error } = await callerClient.rpc('discover_profiles', {});
    expect(error).toBeFalsy();
    expect(idsOf(data!)).not.toContain(callerId);
  });

  it('instrument filter (single id): matches candidates who have it, excludes those who don\'t', async () => {
    const { data, error } = await callerClient.rpc('discover_profiles', {
      instrument_ids: [guitarId],
    });
    expect(error).toBeFalsy();
    const ids = idsOf(data!);
    expect(ids).toContain(nearId); // plays Guitar
    expect(ids).toContain(farId); // plays Guitar
    expect(ids).not.toContain(midId); // Drums only
    expect(ids).not.toContain(nomatchId); // no instruments
  });

  it('instrument filter (multiple ids): OR within the category', async () => {
    const { data, error } = await callerClient.rpc('discover_profiles', {
      instrument_ids: [guitarId, drumsId],
    });
    expect(error).toBeFalsy();
    const ids = idsOf(data!);
    expect(ids).toContain(nearId); // Guitar
    expect(ids).toContain(midId); // Drums
    expect(ids).toContain(farId); // Guitar
    expect(ids).not.toContain(nomatchId);
  });

  it('genre filter alone', async () => {
    const { data, error } = await callerClient.rpc('discover_profiles', {
      genre_ids: [jazzId],
    });
    expect(error).toBeFalsy();
    const ids = idsOf(data!);
    expect(ids).toContain(midId); // Jazz
    expect(ids).toContain(farId); // Jazz
    expect(ids).not.toContain(nearId); // Rock only
    expect(ids).not.toContain(nomatchId);

    // Filtering by the other genre narrows to exactly the opposite fixture.
    const { data: rockData, error: rockErr } = await callerClient.rpc('discover_profiles', {
      genre_ids: [rockId],
    });
    expect(rockErr).toBeFalsy();
    const rockIds = idsOf(rockData!);
    expect(rockIds).toContain(nearId); // Rock
    expect(rockIds).not.toContain(midId);
    expect(rockIds).not.toContain(farId);
  });

  it('combined instrument + genre filters: AND across categories, narrower than either alone', async () => {
    const { data, error } = await callerClient.rpc('discover_profiles', {
      instrument_ids: [guitarId],
      genre_ids: [jazzId],
    });
    expect(error).toBeFalsy();
    const ids = idsOf(data!);
    expect(ids).toContain(farId); // Guitar AND Jazz
    expect(ids).not.toContain(nearId); // Guitar but Rock, not Jazz
    expect(ids).not.toContain(midId); // Jazz but Drums, not Guitar
    expect(ids).not.toContain(nomatchId);
  });

  it('unfiltered results include a candidate with no matched_city_id', async () => {
    const { data, error } = await callerClient.rpc('discover_profiles', {});
    expect(error).toBeFalsy();
    const ids = idsOf(data!);
    expect(ids).toContain(nearId);
    expect(ids).toContain(midId);
    expect(ids).toContain(farId);
    expect(ids).toContain(nomatchId); // no radius active -> unmatched candidates still appear
  });

  it('radius filter (tight, 30mi from Boulder): includes Denver (~24mi), excludes Fort Collins (~41mi), Austin, and the unmatched candidate', async () => {
    const { data, error } = await callerClient.rpc('discover_profiles', {
      radius_miles: 30,
    });
    expect(error).toBeFalsy();
    const ids = idsOf(data!);
    expect(ids).toContain(nearId);
    expect(ids).not.toContain(midId);
    expect(ids).not.toContain(farId);
    expect(ids).not.toContain(nomatchId); // excluded whenever radius is active, unlike the unfiltered case

    const nearRow = data!.find((r) => r.id === nearId)!;
    expect(nearRow.distance_miles).not.toBeNull();
    expect(nearRow.distance_miles!).toBeGreaterThan(20);
    expect(nearRow.distance_miles!).toBeLessThan(30);
  });

  it('radius filter (wider, 50mi from Boulder): includes Denver and Fort Collins, excludes Austin', async () => {
    const { data, error } = await callerClient.rpc('discover_profiles', {
      radius_miles: 50,
    });
    expect(error).toBeFalsy();
    const ids = idsOf(data!);
    expect(ids).toContain(nearId);
    expect(ids).toContain(midId);
    expect(ids).not.toContain(farId);
  });

  it('distance_miles is null when no radius filter is applied, even for a candidate with a matched city', async () => {
    const { data, error } = await callerClient.rpc('discover_profiles', {});
    expect(error).toBeFalsy();
    const nearRow = data!.find((r) => r.id === nearId)!;
    expect(nearRow.distance_miles).toBeNull();
  });

  it('a caller with no matched_city_id gets the radius filter silently ignored, not an error', async () => {
    const { data, error } = await callerNoCityClient.rpc('discover_profiles', {
      radius_miles: 10, // tight enough that, if actually applied, would exclude mid/far/nomatch
    });
    expect(error).toBeFalsy();
    const ids = idsOf(data!);
    // Behaves as if radius weren't passed at all: unfiltered, so the
    // unmatched candidate still appears too.
    expect(ids).toContain(nearId);
    expect(ids).toContain(midId);
    expect(ids).toContain(farId);
    expect(ids).toContain(nomatchId);
    expect(ids).not.toContain(callerNoCityId);
  });

  it('pagination: concatenating small pages reproduces the single large-page result exactly, no dupes or gaps', async () => {
    const filterArgs = { instrument_ids: [guitarId, drumsId] };

    const { data: full, error: fullErr } = await callerClient.rpc('discover_profiles', {
      ...filterArgs,
      page_limit: 100,
      page_offset: 0,
    });
    expect(fullErr).toBeFalsy();
    const fullIds = idsOf(full!);
    // Sanity: this filter should surface at least our 3 known fixtures.
    expect(fullIds).toEqual(expect.arrayContaining([nearId, midId, farId]));

    const paginatedIds: string[] = [];
    let page = 0;
    const pageSize = 2;
    // Bounded loop mirroring how DiscoverScreen itself paginates.
    while (true) {
      const { data: pageRows, error: pageErr } = await callerClient.rpc('discover_profiles', {
        ...filterArgs,
        page_limit: pageSize,
        page_offset: page * pageSize,
      });
      expect(pageErr).toBeFalsy();
      const rows = pageRows!;
      paginatedIds.push(...idsOf(rows));
      if (rows.length < pageSize) break;
      page += 1;
      if (page > 50) throw new Error('pagination loop did not terminate — possible RPC bug');
    }

    expect(paginatedIds).toEqual(fullIds);
    expect(new Set(paginatedIds).size).toBe(paginatedIds.length); // no duplicates across pages
  });
});
