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
const MESSAGE_TEMPLATES = [
  'Hey, are you still looking for a bassist?',
  'Loved your last post, that solo was insane.',
  'What time works for practice this week?',
  'Can you send me the setlist for Friday?',
  "I've got a new amp, wanna jam this weekend?",
  'Running a bit late, be there in 10.',
  'That gig last night was awesome, great energy!',
  'Do you have a spare mic cable I could borrow?',
  "Let's talk about splitting the door money.",
  'I found a venue that might work for our next show.',
  'Can we push rehearsal to next Tuesday?',
  'Your cover of that song was so good.',
  "I'm in, count me for the summer tour.",
  'Need to swap out a broken string before Friday.',
  'Thanks for covering my shift at the studio.',
  'Let me know if you need a drummer for the demo.',
  'That new pedal you got sounds incredible.',
  'Can you email me the invoice for the studio time?',
  "I'm free Thursday if you want to jam.",
  'Great meeting you at the open mic last night!',
];

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

/**
 * Phase 4a: assigns roughly half of seeded profiles a real, matched city
 * (location_city/state + matched_city_id all sourced from the same `cities`
 * row) and leaves the rest on a faker-generated fake city with no match --
 * the first two users are pinned to matched/unmatched respectively so both
 * cases are always present regardless of random luck, since Phase 4b's
 * radius search and "no match" fallback both need real data to test
 * against. See CONVENTIONS.md.
 */
async function createProfiles(admin, users, cities) {
  const rows = users.map((u, i) => {
    const matchReal = cities.length > 0 && (i === 0 || (i !== 1 && Math.random() < 0.5));
    const city = matchReal ? pick(cities) : null;
    return {
      id: u.id,
      username: `seed_user_${u.index}`,
      display_name: faker.person.fullName(),
      bio: randomLongformText({ emptyChance: 0.15, shortChance: 0.3, longChance: 0.85 }),
      location_city: city ? city.city : faker.location.city(),
      location_state: city ? city.state : faker.location.state({ abbreviated: true }),
      matched_city_id: city ? city.id : null,
      experience_level: pick(EXPERIENCE_LEVELS),
    };
  });
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
  if (users.length < 4) return { pending: 0, accepted: 0, acceptedPairs: [] };

  const [u0, u1, u2, u3] = users;
  const rows = [
    { requester_id: u1.id, recipient_id: u0.id, status: 'pending' }, // incoming to u0
    { requester_id: u0.id, recipient_id: u2.id, status: 'pending' }, // outgoing from u0
    { requester_id: u0.id, recipient_id: u3.id, status: 'accepted' }, // accepted for u0
  ];

  const usedPairs = new Set(rows.map((r) => pairKey(r.requester_id, r.recipient_id)));
  const extraTarget = Math.min(7, Math.max(0, users.length - 4));
  let attempts = 0;
  while (rows.length - 3 < extraTarget && attempts < extraTarget * 10) {
    attempts++;
    const a = pick(users);
    const b = pick(users);
    if (a.id === b.id) continue;
    const key = pairKey(a.id, b.id);
    if (usedPairs.has(key)) continue;
    usedPairs.add(key);
    // 50/50 rather than 1-in-3 — createMessages() needs several accepted
    // pairs to seed more than one thread's worth of message data.
    rows.push({ requester_id: a.id, recipient_id: b.id, status: pick(['pending', 'accepted']) });
  }

  const { error } = await admin.from('connections').insert(rows);
  if (error) throw new Error(`insert connections failed: ${error.message}`);

  return {
    pending: rows.filter((r) => r.status === 'pending').length,
    accepted: rows.filter((r) => r.status === 'accepted').length,
    // messages_insert_own requires an accepted connection (see Data model) —
    // createMessages() needs every accepted pair, not just the guaranteed
    // u0<->u3 one, to seed more than a single conversation.
    acceptedPairs: rows
      .filter((r) => r.status === 'accepted')
      .map((r) => ({ requester_id: r.requester_id, recipient_id: r.recipient_id })),
  };
}

/**
 * A random, back-and-forth conversation between two ids (message content
 * drawn from MESSAGE_TEMPLATES, 3-10 lines, speaker switching ~70% of the
 * time rather than strictly alternating for a more natural feel). Spread
 * over a random recent window (not all ending at "now") so multiple seeded
 * threads don't all look identically fresh in ConversationsListScreen.
 */
function randomConversation(idA, idB) {
  const count = randomInt(5, 15);
  const now = Date.now();
  const endOffsetMinutes = randomInt(5, 60 * 24 * 3); // thread's last message: 5 min to 3 days ago
  const stepMinutes = randomInt(2, 20);

  let sender = Math.random() < 0.5 ? idA : idB;
  const lines = [];
  for (let i = 0; i < count; i++) {
    lines.push(sender);
    if (Math.random() < 0.7) sender = sender === idA ? idB : idA;
  }

  return lines.map((senderId, i) => ({
    senderId,
    recipientId: senderId === idA ? idB : idA,
    content: pick(MESSAGE_TEMPLATES),
    createdAt: new Date(now - endOffsetMinutes * 60 * 1000 - (count - i) * stepMinutes * 60 * 1000),
  }));
}

/**
 * Phase 5a: message threads for every accepted connection (messages_insert_own
 * requires one — see Data model — so threads can't be scattered across
 * random pairs the way createConnections() does for its own extra rows;
 * every thread here has to target a pair createConnections() actually
 * accepted). The users[0]<->users[3] pair createConnections() guarantees is
 * always accepted gets a hand-written, deterministic conversation whose
 * last message (from users[3]) is left unread — so u0's Messages tab badge
 * and ConversationsListScreen unread state are both reachable without
 * depending on random luck, same "guarantee it for the most-likely-to-be-
 * manually-tested account" approach Phase 4a used for matched/unmatched
 * cities. Every *other* accepted pair (however many createConnections()
 * happened to generate this run) gets a randomized conversation instead, so
 * a reseed produces more than one thread's worth of data to browse.
 */
async function createMessages(admin, users, acceptedPairs) {
  if (users.length < 4) return 0;
  const [u0, , , u3] = users;

  const guaranteedIndex = acceptedPairs.findIndex(
    (p) =>
      (p.requester_id === u0.id && p.recipient_id === u3.id) ||
      (p.requester_id === u3.id && p.recipient_id === u0.id)
  );
  const guaranteedPair = acceptedPairs[guaranteedIndex];
  const otherPairs = acceptedPairs.filter((_, i) => i !== guaranteedIndex);

  const rows = [];

  if (guaranteedPair) {
    const lines = [
      { from: u0.id, content: "Hey, saw your profile — you play bass right?" },
      { from: u3.id, content: 'Yeah! Looking for a band actually.' },
      { from: u0.id, content: "Nice, we're looking for someone for weekend gigs." },
      { from: u3.id, content: 'That sounds great, what genre?' },
      { from: u0.id, content: 'Mostly rock/blues, some original stuff too.' },
      { from: u3.id, content: "I'm down, when do you usually rehearse?" },
      { from: u0.id, content: 'Tuesdays and Thursdays evenings usually.' },
      { from: u3.id, content: 'Works for me, see you there!' },
    ];
    const now = Date.now();
    for (const [i, line] of lines.entries()) {
      const recipientId = line.from === u0.id ? u3.id : u0.id;
      const createdAt = new Date(now - (lines.length - i) * 3 * 60 * 1000); // 3 min apart, most recent near "now"
      const isUnreadFromU3 = line.from === u3.id && i === lines.length - 1;
      rows.push({
        sender_id: line.from,
        recipient_id: recipientId,
        content: line.content,
        created_at: createdAt.toISOString(),
        read_at: isUnreadFromU3 ? null : new Date(createdAt.getTime() + 30 * 1000).toISOString(),
      });
    }
  }

  for (const pair of otherPairs) {
    const convo = randomConversation(pair.requester_id, pair.recipient_id);
    const leaveLastUnread = Math.random() < 0.5;
    for (const [i, line] of convo.entries()) {
      const isLast = i === convo.length - 1;
      rows.push({
        sender_id: line.senderId,
        recipient_id: line.recipientId,
        content: line.content,
        created_at: line.createdAt.toISOString(),
        read_at: isLast && leaveLastUnread ? null : new Date(line.createdAt.getTime() + 30 * 1000).toISOString(),
      });
    }
  }

  if (rows.length === 0) return 0;
  const { error } = await admin.from('messages').insert(rows);
  if (error) throw new Error(`insert messages failed: ${error.message}`);
  return rows.length;
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
  const { data: cities, error: citiesErr } = await admin.from('cities').select('id, city, state');
  if (citiesErr) throw new Error(`fetch cities failed: ${citiesErr.message}`);

  const userCount = randomInt(...USER_COUNT_RANGE);
  const postCount = randomInt(...POST_COUNT_RANGE);

  console.log(`Creating ${userCount} fake user(s)...`);
  const users = await createSeedUsers(admin, userCount);

  console.log('Creating profiles...');
  const profileRows = await createProfiles(admin, users, cities ?? []);
  const matchedCityCount = profileRows.filter((r) => r.matched_city_id).length;

  console.log('Assigning instruments/genres...');
  const tagCounts = await createProfileTags(admin, users, instruments, genres);

  console.log('Creating connections...');
  const connectionCounts = await createConnections(admin, users);

  console.log('Creating messages...');
  // One thread per accepted connection — messages_insert_own's connection
  // gate means any other pair would just fail to insert.
  const messageCount = await createMessages(admin, users, connectionCounts.acceptedPairs);

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
    matchedCities: matchedCityCount,
    unmatchedCities: users.length - matchedCityCount,
    connectionsPending: connectionCounts.pending,
    connectionsAccepted: connectionCounts.accepted,
    messages: messageCount,
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
  console.log(`  Profiles matched to a city:   ${counts.matchedCities}`);
  console.log(`  Profiles unmatched (fallback): ${counts.unmatchedCities}`);
  console.log(`  Connections (pending):    ${counts.connectionsPending}`);
  console.log(`  Connections (accepted):   ${counts.connectionsAccepted}`);
  console.log(`  Messages created:   ${counts.messages}`);
  console.log(`  Posts created:      ${counts.posts}`);
  console.log(`  Likes created:      ${counts.likes}`);
  console.log(`  Comments created:   ${counts.comments}`);
  console.log('='.repeat(72));
}

main().catch((err) => {
  console.error('\nseed.js failed:', err.message);
  process.exit(1);
});
