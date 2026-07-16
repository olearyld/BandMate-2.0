# Bandmate — Conventions & Architecture

_Last updated: 2026-07-16 (Phase 2). Update this file whenever a phase introduces or changes anything below — it should never go stale._

## Stack
- Expo SDK ~57.0.6, React Native 0.86.0, React 19.2.3, TypeScript ~6.0.3, strict mode on.
- **NativeWind v4** — Tailwind utility classes for RN styling, kept for a single mental model across future web/native work.
- **React Navigation v7** (`@react-navigation/native-stack` + `@react-navigation/bottom-tabs`) — stack-inside-tabs composition; see Navigation & state below.
- **Supabase** (`@supabase/supabase-js`) — Postgres + Auth + Storage backend, single project (`ktfrsgffgzepadmoryps`, ref also in `.env`).
- **Managed workflow** — no `ios`/`android` folders checked in (gitignored, regenerated on demand). All native modules used so far (`expo-audio`, `expo-video`, `expo-image-picker`, `expo-image-manipulator`, `expo-video-thumbnails`, `expo-asset`) are bundled in Expo Go for SDK 57, so the app runs there directly.
  - **What would force a custom dev client**: adding any native module *not* included in Expo Go — a custom Expo Modules API module, a third-party RN library without Expo Go support, background tasks/notifications requiring native entitlements, or anything needing a custom `Info.plist`/`AndroidManifest.xml` entry beyond what `app.json` config plugins cover.

## Data model
- Migrations live in `supabase/migrations/`, named `NNNN_description.sql` (`0001_init.sql`, `0002_media_feed.sql`, ...). Applied via the Supabase MCP `apply_migration` tool (no local Supabase CLI installed — see Known tech debt).
- **RLS pattern (the rule)**: read = any authenticated user (`for select to authenticated using (true)`); write (insert/update/delete) = scoped to the owning row via `auth.uid()` matching that table's owner column. Applied to `profiles`, `instruments`, `genres`, `profile_instruments`, `profile_genres`, `media_posts`, `likes`, `comments`.
- **Deviations from that pattern** (private-by-nature data, not public-read):
  - `connections` — read scoped to `requester_id = auth.uid() or recipient_id = auth.uid()`; insert by requester only; update (accept/decline) by recipient only.
  - `messages` — read/insert scoped to `sender_id = auth.uid() or recipient_id = auth.uid()`.
- **Naming**: snake_case columns throughout. The FK to the acting user is `profile_id` on tables tied to a profile-owned resource (`media_posts`, `profile_instruments`, `profile_genres`), but `user_id` on `likes`/`comments` (matches the Phase 2 spec's naming, still references `profiles(id)`) — this inconsistency is intentional-by-spec, not a bug; don't "fix" it without checking both.
- `updated_at` columns are maintained by the shared `update_updated_at()` trigger where present (`profiles`, `connections`); most tables don't need it and don't have the column.

## Storage
- Single bucket: **`media`** — holds both profile/onboarding intro media and feed post media.
- Path convention:
  - Profile/onboarding intro media: `{user_id}/intro.{ext}` — always the same key (`upsert: true`), since a profile has exactly one intro slot.
  - Feed post media: `{user_id}/posts/{random_id}.{ext}`, thumbnail (video only) at `{user_id}/posts/{random_id}_thumb.jpg` — unique per post, since a user can have many posts.
- Per-media-type handling (all in `src/lib/mediaUpload.ts`):
  - **Photo**: resized to max 1600px on the long edge (only ever downsizes, never upscales small images) + recompressed to JPEG at 0.8 quality via `expo-image-manipulator`'s context-based API (`ImageManipulator.manipulate(uri).resize(...).renderAsync()` → `.saveAsync()` — the old `manipulateAsync` free function is deprecated as of the installed version).
  - **Video**: capped at 60s + medium quality via picker options only — no client-side transcoding.
  - **Audio**: capped at 60s via an auto-stop timer inside the recording hook.
  - **Video thumbnail**: generated via `expo-video-thumbnails` at `time: 0`, best-effort — upload proceeds without one if generation fails.

## Shared services
- `src/lib/supabase.ts` — the Supabase client singleton, typed via the generated `Database` type.
- `src/lib/database.types.ts` — **generated**, do not hand-edit. Regenerate after any schema change via the Supabase MCP `generate_typescript_types` tool (no local Supabase CLI — see Known tech debt).
- `src/lib/types.ts` — hand-written domain types: plain entity interfaces (`Profile`, `MediaPost`, `Like`, `Comment`, ...), and composed row types matching the exact shape of specific joined queries (`FullProfile`, `FeedPostRow`, `PostDetailRow`) — used with `.returns<T>()` on the relevant Supabase query rather than relying on postgrest-js's automatic embed inference, which doesn't handle multi-level nested embeds well.
- `src/lib/mediaUpload.ts` — owns **all** media picking, recording, compression, thumbnailing, and upload logic. Used by onboarding (`Step4Media`), My Profile's edit form, and Create Post.
- **Rule**: no duplicate implementations of the same concern. Extend the shared module instead of writing a parallel one — this is exactly what Phase 2 fixed (onboarding and My Profile had copy-pasted upload logic before being consolidated).

## Navigation & state
- `AppContext` (`src/navigation/AppContext.tsx`) owns a single state machine, `appState`:
  - `loading` — initial, while `supabase.auth.getSession()` resolves (8s timeout falls back to `unauthenticated`).
  - `unauthenticated` — no session.
  - `onboarding` — session exists, but no row in `profiles` yet for that user.
  - `authenticated` — session exists and a `profiles` row exists.
  - Transitions are driven by `supabase.auth.onAuthStateChange`, plus a manual `refreshProfile()` call (used by `Step4Media` after onboarding completes) to re-check and flip to `authenticated` without waiting for an auth event.
- `RootNavigator` picks one of three navigators based on `appState`:
  - **AuthStack**: `Login`, `SignUp`.
  - **OnboardingStack** (wrapped in `OnboardingProvider`, which holds the in-progress draft): `Step1`–`Step4`.
  - **MainStack** (top-level, `headerShown: false` except where overridden): `Tabs` (bottom tabs: `Feed`, `MyProfile`, `Messages`), `PublicProfile`, `PostDetail`, `CreatePost` (`presentation: 'modal'`).
- Screens that navigate from a tab (e.g. `Feed`) to a `MainStack`-level screen (`PostDetail`, `CreatePost`) use the `CompositeScreenProps<BottomTabScreenProps<...>, NativeStackScreenProps<...>>` pattern — established in Phase 2 since no cross-navigator navigation existed before it.

## Known tech debt / deferred decisions
- **Feed video rendering**: Feed cards show a thumbnail + play icon only, never a live video player — intentional, to avoid instantiating many video players in a scrolling list. Full playback only happens on Post Detail. Don't "fix" this by making Feed autoplay video.
- **Like/comment counts** are computed client-side from full embedded arrays (`likes(user_id)`, `comments(id)`), not database aggregates. Fine at current scale; will need count aggregates or an RPC if a post's like count grows large.
- **Post Detail interactions not automation-verified**: the like-toggle and Send-comment buttons were not confirmed via UI automation (simulator has no synthetic-touch API, and blind coordinate tapping proved unreliable at that precision). The code path is verified by type-checking, live schema validation, and structural parity with Feed's already-verified like-toggle — but do a manual pass before shipping.
- **`dev_confirm_user_email` RPC**: bypasses email confirmation, gated behind `__DEV__` in `SignUpScreen`. Remove/disable before any real email-confirmation flow ships.
- **Pre-existing security advisories** (not introduced by Phase 2, not yet addressed): `update_updated_at()` has a mutable search_path; the `media` bucket allows public listing; `dev_confirm_user_email` is callable by `anon`/`authenticated` as `SECURITY DEFINER`; leaked-password protection is disabled. None are blocking for development; worth a pass before production.
- **No local Supabase CLI**: schema changes are applied and types regenerated via the Supabase MCP tools (`apply_migration`, `generate_typescript_types`), not `supabase` CLI commands. If the CLI gets installed later, prefer it for local dev workflows per the MCP server's own guidance, but keep migration files as the source of truth either way.

## Phase log
- Phase 0 — Initial Expo + TypeScript scaffold.
- Phase 1 — Auth (email/password), 4-step onboarding, profile view/edit; initial schema (`profiles`, `instruments`, `genres`, `media_posts`, `connections`, `messages`) with RLS.
- Phase 2 — Media feed: real generated Supabase types wired in, `likes`/`comments` tables added, upload logic consolidated into `src/lib/mediaUpload.ts`, chronological Feed with like/comment counts, Create Post flow, Post Detail with comments.
