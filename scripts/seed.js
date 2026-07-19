#!/usr/bin/env node
/**
 * Manual, on-demand seed script for the dedicated TEST Supabase project only
 * (the same one __tests__/integration/** uses) — NEVER production. See
 * CONVENTIONS.md's Testing section for why there's a separate test project
 * instead of a real Supabase branch (branching needs a Pro-plan upgrade this
 * account doesn't have).
 *
 * Run by hand: `npm run seed` (reset + reseed) or `npm run seed:reset`
 * (wipe only). This is NOT wired into CI and must never be — it uses the
 * test project's service_role key, which bypasses RLS entirely and is far
 * more powerful than the anon key already in use everywhere else. Refuses
 * to run if CI is set, as a belt-and-suspenders guard against that ever
 * happening by accident.
 *
 * Safety checks, in order, before touching any data:
 *   1. Refuses to run under CI.
 *   2. Confirms TEST_SUPABASE_SERVICE_ROLE_KEY / TEST_SUPABASE_URL /
 *      TEST_SUPABASE_ANON_KEY are all set (read from .env — gitignored,
 *      never committed, never imported anywhere in src/).
 *   3. Prints the target URL prominently.
 *   4. Refuses if TEST_SUPABASE_URL doesn't contain the known test project
 *      ref, or if the service_role key is a legacy JWT whose own `ref`/`role`
 *      claims don't match the test project / "service_role" (best-effort —
 *      the newer opaque sb_secret_* key format can't be decoded this way, in
 *      which case this check is skipped and a mismatched key will simply
 *      fail the first real request instead).
 *   5. Reuses check-migrations-parity.js's exact production-vs-test schema
 *      comparison and refuses to seed if it fails — seeding onto a schema
 *      that's drifted from what the migrations define would silently
 *      produce broken/partial data.
 *
 * Seed users/data are identifiable by a dedicated email domain
 * (@bandmate-seed.test) so reset() only ever touches rows this script
 * created — never the RLS suite's fixture accounts or critical-path test
 * leftovers that also live on this same test project.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const { faker } = require('@faker-js/faker');
const { checkParity, printReport } = require('./check-migrations-parity');

const TEST_PROJECT_REF = 'hgpsqjwghaujaxeumisl';
const SEED_EMAIL_DOMAIN = 'bandmate-seed.test';
const SEED_PASSWORD = 'BandmateSeed!23456';

const USER_COUNT_RANGE = [8, 12];
const POST_COUNT_RANGE = [30, 50];

const EXPERIENCE_LEVELS = ['beginner', 'intermediate', 'advanced', 'professional'];
const TAG_POOL = [
  'rock', 'jazz', 'livemusic', 'jam', 'acoustic', 'guitar', 'drums', 'vocals',
  'coversong', 'original', 'studio', 'rehearsal', 'gig', 'tour', 'newmusic',
];
const IMAGE_SEEDS = Array.from({ length: 40 }, (_, i) => `https://picsum.photos/seed/bandmate-${i}/800/800`);
const SAMPLE_VIDEOS = [
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
];
const SAMPLE_AUDIO = Array.from(
  { length: 16 },
  (_, i) => `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${i + 1}.mp3`
);

// ---------------------------------------------------------------- utilities

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

/** Mostly-low, occasionally-heavy engagement distribution. */
function skewedCount(max) {
  const r = Math.random();
  if (r < 0.25) return 0;
  if (r < 0.7) return randomInt(1, 5);
  if (r < 0.93) return randomInt(6, 15);
  return randomInt(16, max);
}

function randomLongformText({ emptyChance = 0.15, shortChance = 0.5, longChance = 0.9 }) {
  const r = Math.random();
  if (r < emptyChance) return null;
  if (r < shortChance) return faker.lorem.sentence();
  if (r < longChance) return faker.lorem.sentences(2);
  return faker.lorem.paragraphs(3);
}

function decodeJwtClaims(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null; // not a legacy JWT (e.g. new sb_secret_* opaque key)
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ safety

function assertSafeToRun() {
  if (process.env.CI) {
    throw new Error('This is a manual, on-demand script — refusing to run with CI set.');
  }

  const testUrl = process.env.TEST_SUPABASE_URL;
  const testAnonKey = process.env.TEST_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  const productionUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const productionAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (!testUrl || !testAnonKey || !serviceRoleKey || !productionUrl || !productionAnonKey) {
    throw new Error(
      'Missing credentials. Need TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, ' +
        'TEST_SUPABASE_SERVICE_ROLE_KEY (test project only — get this from the Supabase ' +
        'dashboard, Settings -> API, on the TEST project, never production), plus ' +
        'EXPO_PUBLIC_SUPABASE_URL/ANON_KEY (needed to run the schema parity check). ' +
        'See CONVENTIONS.md.'
    );
  }

  console.log('='.repeat(72));
  console.log('SEED TARGET (never production):');
  console.log(`  ${testUrl}`);
  console.log('='.repeat(72));

  if (!testUrl.includes(TEST_PROJECT_REF)) {
    throw new Error(
      `TEST_SUPABASE_URL does not contain the known test project ref "${TEST_PROJECT_REF}". ` +
        'Refusing to run against an unrecognized project.'
    );
  }

  const claims = decodeJwtClaims(serviceRoleKey);
  if (claims) {
    if (claims.ref && claims.ref !== TEST_PROJECT_REF) {
      throw new Error(
        `TEST_SUPABASE_SERVICE_ROLE_KEY belongs to project "${claims.ref}", not the test ` +
          `project "${TEST_PROJECT_REF}". This looks like the wrong project's key (maybe ` +
          'production\'s?) — refusing to run.'
      );
    }
    if (claims.role && claims.role !== 'service_role') {
      throw new Error(
        `TEST_SUPABASE_SERVICE_ROLE_KEY does not look like a service_role key (role claim ` +
          `is "${claims.role}"). Refusing to run.`
      );
    }
    console.log(`service_role key verified: ref=${claims.ref ?? '?'}, role=${claims.role ?? '?'}`);
  } else {
    console.log(
      'service_role key is not a decodable legacy JWT (likely the newer sb_secret_* format) ' +
        '— skipping the offline ref/role check. A mismatched key will simply fail the first ' +
        'real request below instead.'
    );
  }

  return { testUrl, testAnonKey, serviceRoleKey, productionUrl, productionAnonKey };
}

async function assertSchemaCurrent({ productionUrl, productionAnonKey, testUrl, testAnonKey }) {
  console.log('\nChecking production/test schema parity before seeding...\n');
  const result = await checkParity({
    productionUrl,
    productionKey: productionAnonKey,
    testUrl,
    testKey: testAnonKey,
  });
  printReport(result);
  if (!result.ok) {
    throw new Error(
      '\nRefusing to seed onto a stale/mismatched schema — fix the mismatch reported above ' +
        '(apply the missing migration to whichever project is behind), then re-run.'
    );
  }
  console.log('');
}

// -------------------------------------------------------------------- reset

async function resetSeedData(admin) {
  console.log('Resetting previous seed data...');
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`listUsers failed: ${error.message}`);

  const seedUsers = data.users.filter((u) => u.email && u.email.endsWith(`@${SEED_EMAIL_DOMAIN}`));
  for (const u of seedUsers) {
    const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
    if (delErr) throw new Error(`deleteUser(${u.email}) failed: ${delErr.message}`);
  }
  console.log(`  Removed ${seedUsers.length} previous seed user(s) (profiles/posts/likes/comments cascade).`);
  return seedUsers.length;
}

// --------------------------------------------------------------------- seed

async function createSeedUsers(admin, count) {
  const users = [];
  for (let i = 0; i < count; i++) {
    const email = `seed.user.${i}@${SEED_EMAIL_DOMAIN}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: SEED_PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser(${email}) failed: ${error.message}`);
    users.push({ id: data.user.id, email, index: i });
  }
  return users;
}

async function createProfiles(admin, users) {
  const rows = users.map((u) => ({
    id: u.id,
    username: `seed_user_${u.index}`,
    display_name: faker.person.fullName(),
    bio: randomLongformText({ emptyChance: 0.15, shortChance: 0.3, longChance: 0.85 }),
    location_city: faker.location.city(),
    location_state: faker.location.state({ abbreviated: true }),
    experience_level: pick(EXPERIENCE_LEVELS),
  }));
  const { error } = await admin.from('profiles').insert(rows);
  if (error) throw new Error(`insert profiles failed: ${error.message}`);
  return rows;
}

async function createProfileTags(admin, users, instruments, genres) {
  const instrumentRows = [];
  const genreRows = [];
  for (const u of users) {
    for (const inst of faker.helpers.arrayElements(instruments, randomInt(1, 4))) {
      instrumentRows.push({ profile_id: u.id, instrument_id: inst.id, skill_level: pick(EXPERIENCE_LEVELS) });
    }
    for (const genre of faker.helpers.arrayElements(genres, randomInt(1, 3))) {
      genreRows.push({ profile_id: u.id, genre_id: genre.id });
    }
  }
  if (instrumentRows.length > 0) {
    const { error } = await admin.from('profile_instruments').insert(instrumentRows);
    if (error) throw new Error(`insert profile_instruments failed: ${error.message}`);
  }
  if (genreRows.length > 0) {
    const { error } = await admin.from('profile_genres').insert(genreRows);
    if (error) throw new Error(`insert profile_genres failed: ${error.message}`);
  }
  return { instrumentRows: instrumentRows.length, genreRows: genreRows.length };
}

function pairKey(a, b) {
  return [a, b].sort().join(':');
}

/**
 * A handful of connections in varied states so the Phase 3 connect/accept/
 * decline/remove UI is actually exercisable in the simulator, not just in
 * tests. Guarantees the first seed user (seed.user.0, the one most likely
 * to be manually tested) has one incoming pending request, one outgoing
 * pending request, and one accepted connection, then scatters a few more
 * random pairs among the rest for realism. Never inserts 'declined' — that
 * status is dead going forward (declining is a DELETE), see CONVENTIONS.md.
 */
async function createConnections(admin, users) {
  if (users.length < 4) return { pending: 0, accepted: 0 };

  const [u0, u1, u2, u3] = users;
  const rows = [
    { requester_id: u1.id, recipient_id: u0.id, status: 'pending' }, // incoming to u0
    { requester_id: u0.id, recipient_id: u2.id, status: 'pending' }, // outgoing from u0
    { requester_id: u0.id, recipient_id: u3.id, status: 'accepted' }, // accepted for u0
  ];

  const usedPairs = new Set(rows.map((r) => pairKey(r.requester_id, r.recipient_id)));
  const extraTarget = Math.min(5, Math.max(0, users.length - 4));
  let attempts = 0;
  while (rows.length - 3 < extraTarget && attempts < extraTarget * 10) {
    attempts++;
    const a = pick(users);
    const b = pick(users);
    if (a.id === b.id) continue;
    const key = pairKey(a.id, b.id);
    if (usedPairs.has(key)) continue;
    usedPairs.add(key);
    rows.push({ requester_id: a.id, recipient_id: b.id, status: pick(['pending', 'pending', 'accepted']) });
  }

  const { error } = await admin.from('connections').insert(rows);
  if (error) throw new Error(`insert connections failed: ${error.message}`);

  return {
    pending: rows.filter((r) => r.status === 'pending').length,
    accepted: rows.filter((r) => r.status === 'accepted').length,
  };
}

function randomTags() {
  const r = Math.random();
  if (r < 0.3) return null;
  if (r < 0.6) return [pick(TAG_POOL)];
  return faker.helpers.arrayElements(TAG_POOL, randomInt(2, 5));
}

function randomMedia() {
  const mediaType = pick(['image', 'image', 'image', 'video', 'audio']); // weighted toward photos
  if (mediaType === 'image') return { media_type: mediaType, media_url: pick(IMAGE_SEEDS), thumbnail_url: null };
  if (mediaType === 'video') {
    return { media_type: mediaType, media_url: pick(SAMPLE_VIDEOS), thumbnail_url: pick(IMAGE_SEEDS) };
  }
  return { media_type: mediaType, media_url: pick(SAMPLE_AUDIO), thumbnail_url: null };
}

async function createPosts(admin, users, count) {
  const rows = users.length
    ? Array.from({ length: count }, () => {
        const author = pick(users);
        const media = randomMedia();
        return {
          profile_id: author.id,
          ...media,
          caption: randomLongformText({ emptyChance: 0.15, shortChance: 0.5, longChance: 0.9 }),
          tags: randomTags(),
          // Spread over the last 60 days so chronological ordering is exercised.
          created_at: faker.date.recent({ days: 60 }).toISOString(),
        };
      })
    : [];
  const { data, error } = await admin.from('media_posts').insert(rows).select('id, profile_id');
  if (error) throw new Error(`insert media_posts failed: ${error.message}`);
  return data;
}

async function createLikes(admin, posts, users) {
  const rows = [];
  for (const post of posts) {
    const eligible = users.filter((u) => u.id !== post.profile_id);
    const n = Math.min(skewedCount(30), eligible.length);
    for (const liker of faker.helpers.arrayElements(eligible, n)) {
      rows.push({ post_id: post.id, user_id: liker.id });
    }
  }
  if (rows.length > 0) {
    const { error } = await admin.from('likes').insert(rows);
    if (error) throw new Error(`insert likes failed: ${error.message}`);
  }
  return rows.length;
}

async function createComments(admin, posts, users) {
  const rows = [];
  for (const post of posts) {
    const n = skewedCount(12);
    for (let i = 0; i < n; i++) {
      rows.push({
        post_id: post.id,
        user_id: pick(users).id,
        body: randomLongformText({ emptyChance: 0, shortChance: 0.6, longChance: 0.9 }) || faker.lorem.sentence(),
      });
    }
  }
  if (rows.length > 0) {
    const { error } = await admin.from('comments').insert(rows);
    if (error) throw new Error(`insert comments failed: ${error.message}`);
  }
  return rows.length;
}

async function seed(admin) {
  const { data: instruments, error: instrErr } = await admin.from('instruments').select('id, name');
  if (instrErr) throw new Error(`fetch instruments failed: ${instrErr.message}`);
  const { data: genres, error: genreErr } = await admin.from('genres').select('id, name');
  if (genreErr) throw new Error(`fetch genres failed: ${genreErr.message}`);

  const userCount = randomInt(...USER_COUNT_RANGE);
  const postCount = randomInt(...POST_COUNT_RANGE);

  console.log(`Creating ${userCount} fake user(s)...`);
  const users = await createSeedUsers(admin, userCount);

  console.log('Creating profiles...');
  await createProfiles(admin, users);

  console.log('Assigning instruments/genres...');
  const tagCounts = await createProfileTags(admin, users, instruments, genres);

  console.log('Creating connections...');
  const connectionCounts = await createConnections(admin, users);

  console.log(`Creating ${postCount} media_posts...`);
  const posts = await createPosts(admin, users, postCount);

  console.log('Creating likes...');
  const likeCount = await createLikes(admin, posts, users);

  console.log('Creating comments...');
  const commentCount = await createComments(admin, posts, users);

  return {
    users: users.length,
    posts: posts.length,
    profileInstruments: tagCounts.instrumentRows,
    profileGenres: tagCounts.genreRows,
    connectionsPending: connectionCounts.pending,
    connectionsAccepted: connectionCounts.accepted,
    likes: likeCount,
    comments: commentCount,
  };
}

// -------------------------------------------------------------------- main

async function main() {
  const config = assertSafeToRun();
  await assertSchemaCurrent(config);

  // Node 20 has no native WebSocket, and createClient() eagerly initializes the
  // Realtime client — supply `ws` as the transport so client creation doesn't throw.
  const admin = createClient(config.testUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket },
  });

  const resetOnly = process.argv.includes('--reset-only');

  const removed = await resetSeedData(admin);

  if (resetOnly) {
    console.log(`\nReset only (--reset-only) — removed ${removed} seed user(s), not reseeding.`);
    return;
  }

  const counts = await seed(admin);

  console.log('\n' + '='.repeat(72));
  console.log('Seed complete.');
  console.log(`  Target:             ${config.testUrl}`);
  console.log(`  Users created:      ${counts.users}`);
  console.log(`  Profile-instrument links: ${counts.profileInstruments}`);
  console.log(`  Profile-genre links:      ${counts.profileGenres}`);
  console.log(`  Connections (pending):    ${counts.connectionsPending}`);
  console.log(`  Connections (accepted):   ${counts.connectionsAccepted}`);
  console.log(`  Posts created:      ${counts.posts}`);
  console.log(`  Likes created:      ${counts.likes}`);
  console.log(`  Comments created:   ${counts.comments}`);
  console.log('='.repeat(72));
}

main().catch((err) => {
  console.error('\nseed.js failed:', err.message);
  process.exit(1);
});
