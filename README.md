# Geostats

Self-hosted geocaching statistics for the web and Android, built around GPX,
Pocket Query, and owner-log imports.

## Features

- Import My Finds and My Hides GPX files, Pocket Query ZIP archives, and
  owner-log CSV files.
- Explore find statistics, milestones, achievement badges, FTF history, hides,
  and received logs.
- Compare summary stats, country coverage, and cache-type finds with friends who
  also use Geostats.
- Build reusable challenge checkers and publish a result page for a cache.
- Browse finds and hides on a map, or track country, region, and county coverage
  with the scratch map. Filter map points by cache metadata, ratings, location,
  date, and find or hide status.
- Plan caching trips and keep a synchronized mystery-solving journal, including
  computer access tokens for AI-assisted workflows.
- Generate downloadable profile HTML and public, dynamically updated statistics
  and scratch-map embeds.
- Use browser-assisted collectors for received Geocaching.com logs and
  Project-GC finder-country statistics.
- Use the responsive web app or the Expo-based Android app against the same API.
- Export or import portable geocaching data, or permanently delete the account
  and its server-side data, from profile settings.

## Stack

- `pnpm` workspaces and Turborepo
- Next.js web app in `apps/web`
- Expo/React Native mobile app in `apps/mobile`
- NestJS API in `apps/api`
- BullMQ worker in `apps/worker`
- Collector utilities in `apps/tools`
- Prisma schema and migrations in `packages/db`
- Shared types in `packages/shared`
- Reusable statistics logic in `packages/stats`
- GPX/ZIP parsing in `packages/gpx-parser`
- PostgreSQL/PostGIS, Redis, and MinIO through Docker Compose

## Requirements

- Docker Engine with Docker Compose for the full local stack
- Node.js 22 and Corepack when running workspace commands on the host
- PowerShell for the automated agent/dev bootstrap script

## Local Setup

### Full Docker stack

Copy the example environment file:

```bash
cp .env.example .env
```

PowerShell equivalent:

```powershell
Copy-Item .env.example .env
```

Replace the `replace-with-*` values in `.env`, then start the application:

```bash
docker compose up --build
```

Compose starts PostgreSQL, Redis, MinIO, the API, worker, and web app. It also
runs database migrations and creates the object-storage bucket. The web app is
available at `http://localhost:3000` and the API at `http://localhost:3001`.

### Agent/dev quick start

For an automated local Docker startup:

```powershell
corepack pnpm agent:up
```

If `.env` does not exist, that command copies `.env.agent.example`, enabling
automatic login as `dev@local.geostats`. It preserves an existing `.env`. The
command then builds and starts the Compose stack in the foreground; migrations
run before the API, worker, and web services start.

Use `.env.agent.example` only for local development. Its secrets are intentionally fixed so automation can launch the app without extra prompts.

## Authentication

Geostats supports password, external, and development authentication. The API's
runtime environment determines the effective mode:

| Environment | `AUTH_MODE`                           | Sign-in options                                                  |
| ----------- | ------------------------------------- | ---------------------------------------------------------------- |
| Development | unset or `password`                   | Local email and password                                         |
| Development | `external`                            | External provider plus local email and password                  |
| Development | `dev`                                 | Automatic disposable development user; password auth is disabled |
| Production  | `password`                            | Local email and password                                         |
| Production  | unset, `external`, or any other value | External provider plus local email and password                  |

Production deliberately ignores `AUTH_MODE=dev`. When production selects
external auth, Shoo is the provider unless `EXTERNAL_AUTH_PROVIDER_ID` names a
different provider.

The web app normally gets this mode from `GET /auth/config` at runtime.
`NEXT_PUBLIC_AUTH_MODE` is its build-time fallback when that request fails, so
keep it aligned with `AUTH_MODE`. `NEXT_PUBLIC_AUTH_PROVIDER_NAME` controls the
provider label shown by the web and mobile login screens.

### Password authentication

The example development environment uses local email and password login:

```env
AUTH_MODE=password
NEXT_PUBLIC_AUTH_MODE=password
```

Accounts can register and sign in without an external identity provider. Set
`AUTH_MODE=password` explicitly to use password-only authentication in
production.

### Shoo authentication

Shoo is the built-in external provider and the default in production:

```env
AUTH_MODE=external
NEXT_PUBLIC_AUTH_MODE=external
NEXT_PUBLIC_AUTH_PROVIDER_NAME=Shoo
EXTERNAL_AUTH_PROVIDER_ID=shoo
EXTERNAL_AUTH_CALLBACK_URL=https://api.example.com/auth/external/callback
SHOO_BASE_URL=https://shoo.dev
SHOO_ISSUER=https://shoo.dev
SHOO_REQUEST_PII=true
```

Set `EXTERNAL_AUTH_CALLBACK_URL` to the callback on the public API origin. Shoo
derives its client ID from that callback origin and does not use
`EXTERNAL_AUTH_CLIENT_ID`, `EXTERNAL_AUTH_CLIENT_SECRET`, or the generic
authorize, token, and user-info URL settings. Email consent and a verified email
are required when signing in with Shoo.

### Generic external authentication

To use another OIDC-compatible provider that supports authorization code flow
with PKCE and a user-info endpoint, choose a provider ID other than `shoo` and
set:

```env
AUTH_MODE=external
NEXT_PUBLIC_AUTH_MODE=external
NEXT_PUBLIC_AUTH_PROVIDER_NAME=Home Auth
EXTERNAL_AUTH_PROVIDER_ID=home-auth
EXTERNAL_AUTH_CLIENT_ID=your-client-id
EXTERNAL_AUTH_CLIENT_SECRET=your-client-secret-if-required
EXTERNAL_AUTH_AUTHORIZE_URL=https://auth.example.com/oauth2/authorize
EXTERNAL_AUTH_TOKEN_URL=https://auth.example.com/oauth2/token
EXTERNAL_AUTH_USERINFO_URL=https://auth.example.com/oauth2/userinfo
EXTERNAL_AUTH_CALLBACK_URL=https://api.example.com/auth/external/callback
EXTERNAL_AUTH_REQUIRE_VERIFIED_EMAIL=true
```

The client secret is optional for public clients. Unless
`EXTERNAL_AUTH_REQUIRE_VERIFIED_EMAIL=false`, the user-info response must contain
`email_verified: true`; it must always provide `sub` and `email`. External mode
keeps local password registration and sign-in available as an alternative.

### Development authentication

For local Docker development where you want the app to boot without signing in, enable dev auth and rebuild the web image so its public auth flags are baked in:

```env
AUTH_MODE=dev
NEXT_PUBLIC_AUTH_MODE=dev
NEXT_PUBLIC_DEV_AUTO_LOGIN=true
DEV_AUTH_EMAIL=dev@local.geostats
DEV_AUTH_USERNAME=dev
```

With those values, opening a protected web page redirects through `/auth/dev`, creates the development user if needed, sets the session cookie, and returns to the page. Keep `NEXT_PUBLIC_DEV_AUTO_LOGIN=false` outside development.

## AI mystery solver journal

An AI job on any computer can read and update the same Mystery workspace without sharing the user's password. Create a revocable token under **Settings → Profile → Computer access tokens**, then send it as `Authorization: Bearer <token>`.

- `GET /agent/mysteries` lists synchronized mysteries with notes, clues, tried entries, and not-yet-tried entries.
- `GET /agent/mysteries/:gcCode` gets one solver context.
- `POST /agent/mysteries/:gcCode/attempts` atomically creates or updates an entry.

Example body:

```json
{
  "kind": "approach",
  "answer": "Try ROT13 on the cache title",
  "state": "planned",
  "note": "Different from the Caesar shifts already tested",
  "source": "garage-pc-agent"
}
```

Kinds are `approach`, `keyword`, and `coordinate`. States are `planned` (not tried), `wrong`, `correct`, and `unchecked`. Coordinate entries use numeric `latitude` and `longitude`; an optional solved result uses `finalLatitude` and `finalLongitude`. Reposting the same approach, keyword, or coordinate updates its state instead of creating a duplicate, making it safe for several solver jobs to coordinate through the journal.

## Data portability

Every signed-in user can download a server-independent JSON backup from **Settings → Profile → Move or back up all your data** and import it into an account on another Geostats server.

The versioned `geostats-portable-data` format contains the geocaching profile, finds and log text, hides and received logs, associated cache metadata, corrected coordinates, finder-country statistics, generated stat snapshots, and owned mystery workspaces. Import is transactional and can safely be repeated. It merges by stable cache code and record identity, updates matching user-owned records, and keeps unrelated records already in the destination account.

Authentication secrets and server-local capabilities are intentionally not portable: password hashes, OAuth links, login sessions, collector tokens, object-storage keys, and mystery sharing grants remain on the server that issued them. The export includes account identity only as informational metadata and never changes the destination account's email or username.

The authenticated endpoints are:

- `GET /portability/export` — download the current version of the JSON archive.
- `POST /portability/import` — upload the archive in a multipart `file` field (50 MiB hard maximum, optionally lowered with `PORTABILITY_MAX_BYTES`). The API spools uploads to temporary disk and processes one archive at a time per API process.
- `DELETE /portability/account` — permanently delete the authenticated account and its data after sending `{"confirmation":"DELETE"}`. Uploaded objects are removed through a durable retry queue.

## Docker Compose

The local Compose workflow is described in [Local Setup](#local-setup). The
Compose file includes a one-shot `migrate` service, so fresh databases run
Prisma migrations before `api`, `worker`, and `web` start.

The web and API ports bind to `127.0.0.1` by default. If the reverse proxy or
Cloudflare Tunnel runs on another trusted machine, set
`WEB_BIND_ADDRESS=0.0.0.0` and `API_BIND_ADDRESS=0.0.0.0` so it can reach them
over the LAN, and restrict the configured web and API ports (3000 and 3001 by
default) with the host firewall.

## Dockhand

For Dockhand, use `docker-compose.dockhand.yml` as the Compose file and paste the environment values from `.env.dockhand.example` into Dockhand's environment editor.

Before deploying, replace these public URLs with the real URLs from your Dockhand host or reverse proxy:

```env
WEB_ORIGIN=https://geostats.example.com
API_ORIGIN=https://geostats-api.example.com
NEXT_PUBLIC_API_URL=https://geostats-api.example.com
EXTERNAL_AUTH_CALLBACK_URL=https://geostats-api.example.com/auth/external/callback
```

Then replace all `change-this-*` secrets in the env file. Mark these as secrets in Dockhand if you use its secret toggle:

```text
POSTGRES_PASSWORD
REDIS_PASSWORD
MINIO_ROOT_PASSWORD
JWT_SECRET
COLLECTOR_TOKEN_ENCRYPTION_KEY
EXTERNAL_AUTH_CLIENT_SECRET (when configured)
```

For a Git-backed Dockhand stack that builds this repo, keep:

```env
GEOSTATS_IMAGE_PREFIX=geostats
GEOSTATS_IMAGE_TAG=dockhand
```

To deploy prebuilt GitHub Container Registry images instead, set:

```env
GEOSTATS_IMAGE_PREFIX=ghcr.io/owner/repo
GEOSTATS_IMAGE_TAG=release-YYYYMMDD-HHMMSS-utc
```

Prebuilt `web` images must be built with the public API URL you deploy with. The login page reads auth mode and provider name from the API at runtime.

The Dockhand Compose file includes a one-shot `migrate` service, so fresh databases run Prisma migrations before `api`, `worker`, and `web` start.

## GitHub Container Images

Run the **Docker Images** workflow manually in GitHub Actions to build and
publish multi-platform `linux/amd64` and `linux/arm64` app images to GitHub
Container Registry:

```text
ghcr.io/OWNER/REPO/api:<tag>
ghcr.io/OWNER/REPO/worker:<tag>
ghcr.io/OWNER/REPO/web:<tag>
```

Every run publishes `sha-<commit>`. A run dispatched from `main` additionally
publishes `latest` and a shared timestamp release tag for all app images, for
example `release-20260613-173045-utc`.

The workflow accepts these GitHub Actions repository variables as web-image
build settings:

- `NEXT_PUBLIC_API_URL` — public API URL embedded in the web image; defaults to
  `http://localhost:3001` and must be changed for a remote deployment.
- `NEXT_PUBLIC_AUTH_MODE` — fallback login mode if `/auth/config` cannot be
  reached; defaults to `external`.
- `NEXT_PUBLIC_AUTH_PROVIDER_NAME` — fallback provider label; defaults to
  `Shoo`.

On deployment hardware, set the image prefix and pull the prebuilt app images before starting Compose:

```bash
export GEOSTATS_IMAGE_PREFIX="ghcr.io/OWNER/REPO"
export GEOSTATS_IMAGE_TAG="release-20260613-173045-utc"
docker compose pull api worker web
docker compose up -d
```

PowerShell:

```powershell
$env:GEOSTATS_IMAGE_PREFIX = "ghcr.io/OWNER/REPO"
$env:GEOSTATS_IMAGE_TAG = "release-20260613-173045-utc"
docker compose pull api worker web
docker compose up -d
```

Replace `OWNER/REPO` with the lowercase GitHub repository path. If the package visibility is private, log in first:

```powershell
docker login ghcr.io
```

## Import Workflow

1. Sign in with the configured provider or register a local password account.
2. Create a geocaching profile with your GC username and optional home coordinates.
3. Upload a `.gpx` My Finds/My Hides file or a `.zip` Pocket Query.
4. The API stores the original file in MinIO and queues a BullMQ import job.
5. The worker parses GPX data, upserts cache metadata, stores finds when found-log data is present, and recalculates stats.
6. The web and mobile dashboards, statistics, import history, and maps read from
   the API.

## Useful Commands

Install workspace dependencies before running these commands. API, worker, and
database commands run on the host only when their required environment variables
are exported; the `.env` values supplied for Compose use container hostnames.

```powershell
corepack pnpm build
corepack pnpm lint
corepack pnpm test
corepack pnpm typecheck
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm --filter @geostats/api dev
corepack pnpm --filter @geostats/worker dev
corepack pnpm --filter @geostats/web dev
corepack pnpm mobile:start
```

## Mobile

The Expo app lives in `apps/mobile`.

- By default it targets the Android emulator alias `http://10.0.2.2:3001`, so a local `expo start` works against a local API without extra config.
- To point a device or Expo Go session at the hosted API instead, set `EXPO_PUBLIC_API_URL=https://geostats-api.hampusek.com` before starting Expo.

### Android production builds

The repo now includes EAS build profiles in `eas.json`:

- `preview`: installs as a downloadable `.apk`
- `production`: builds a Play Store `.aab`

Before building, create `apps/mobile/.env` from `apps/mobile/.env.example` and set your public API URL:

```powershell
Copy-Item apps/mobile/.env.example apps/mobile/.env
```

```env
EXPO_PUBLIC_API_URL=https://api.example.com
EXPO_PUBLIC_MOBILE_AUTH_REDIRECT_URI=geostats://auth
EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY=your-google-maps-android-api-key
```

The Android map and scratch map screens require a Google Maps SDK for Android API key. After adding or changing `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY`, rebuild and reinstall the Android app; a JS reload will not update the native manifest value.

Then log into Expo and build:

```powershell
corepack pnpm mobile:build:apk
```

That produces an installable Android APK you can download and sideload onto your phone.

Preview builds reuse the EAS-managed Android signing key and remotely increment the Android version code. Each new APK can therefore update the previous installation without uninstalling it. Do not replace or reset the Android credentials in EAS, because Android rejects an in-place update signed with a different key. After installing a preview APK with OTA updates enabled, compatible JavaScript, styling, and asset-only revisions can be delivered over the air:

```powershell
corepack pnpm mobile:update:preview
```

The app checks for a compatible revision when it starts, downloads it, and offers to restart. Changes to Expo SDK packages, native plugins, permissions, maps configuration, or other native code still require a new APK build.

For Play Store submission instead:

```powershell
corepack pnpm mobile:build:aab
```

If you use external auth in production, make sure the API deployment allows the mobile redirect URI:

```env
MOBILE_AUTH_REDIRECT_URI=geostats://auth
```

Production API deployments reject mobile external-auth redirects unless `MOBILE_AUTH_REDIRECT_URI` is set exactly.

### GitHub mobile releases

The **Mobile Release** workflow in GitHub Actions provides three manually selected release paths. `preview-release` is the default and handles both preview distribution paths with one button:

- `preview-release`: creates an installable APK for first-time users and manual native updates, attaches it to a GitHub prerelease, and publishes the same compatible JavaScript/assets revision to installed preview apps over the air. Its deployment and workflow summary link directly to the download page.
- `production-update`: publishes a JavaScript/assets update to installed production builds.
- `play-internal`: builds an Android App Bundle and submits it to Google Play internal testing.

Preview releases may be dispatched from any branch. `production-update` and
`play-internal` are accepted only when dispatched from `main`.

Android does not allow a sideloaded app to silently replace its installed APK. The automatic part of `preview-release` therefore covers JavaScript, styling, and asset changes. Changes to native packages, plugins, permissions, or Android configuration require the user to install the new APK from the release page; use Google Play distribution when automatic native-binary updates are required.

Configure the following before the first workflow run:

1. Create GitHub environments named `mobile-preview` and `mobile-production`. Require approval on `mobile-production` if production releases should be gated.
2. Add an Expo access token as the `EXPO_TOKEN` secret to both environments.
3. In the EAS project, define `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_MOBILE_AUTH_REDIRECT_URI`, and `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY` for the `preview` and `production` environments. Values embedded in a mobile app are public; restrict the Google Maps key to the Android package and signing certificate in Google Cloud.
4. Preserve the signing identity of existing preview installs by retaining the Android credentials already managed by EAS. Do not generate or select a replacement key.
5. For `play-internal`, create the Play Console app and upload a Google Play service-account key to the Android app's EAS submit credentials.

The repository does not contain signing keystores or service-account credentials. Preview and production signing credentials and Play submission credentials remain managed by EAS.

After a successful `preview-release` run, open the repository's **Releases**
page in GitHub and select the newest **Geostats Mobile ... Preview** prerelease.
Expand **Assets** in the GitHub mobile app, then tap the `.apk` file. Failed
builds do not create a release.

## Architecture Notes

- The API is the source of truth for accounts, imported cache records, and
  calculated statistics. Web and mobile clients never read from Prisma
  directly.
- User-owned records are scoped through user or owner relations. Cache metadata
  is user-scoped by the `(user_id, gc_code)` pair.
- Cache coordinates are stored as scalar latitude/longitude and as a PostGIS geography point.
- Object storage uses S3-compatible environment variables so MinIO can be replaced with cloud S3 later.
- The mobile app uses the same API contracts and shared packages as web.

## Work in progress

- Trackable logbook with owned, discovered, retrieved, dropped, and visited
  states; GPX or CSV history import; distance and journey maps; and a last-seen
  warning for trackables that may be stuck.
- Shared trip lists so friends can collect solved mysteries, vote on stops, and
  open one route on caching day.
- Personal goals for yearly find counts, Jasmer months, D/T grid cells, counties,
  cache types, and streaks.
- Owner maintenance board with disabled-cache reminders, maintenance history,
  supply notes, and a route across caches that need attention.
- Opt-in group challenges and small leaderboards for clubs, trips, and events.
