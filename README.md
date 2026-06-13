# Geostats

Local-first, cloud-ready geocaching statistics for GPX and Pocket Query imports.

## Stack

- `pnpm` workspaces and Turborepo
- Next.js web app in `apps/web`
- NestJS API in `apps/api`
- BullMQ worker in `apps/worker`
- Prisma schema and migrations in `packages/db`
- Shared types in `packages/shared`
- Reusable statistics logic in `packages/stats`
- GPX/ZIP parsing in `packages/gpx-parser`
- PostgreSQL/PostGIS, Redis, and MinIO through Docker Compose

## Local Setup

1. Copy the environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Install dependencies:

   ```powershell
   corepack pnpm install
   ```

3. Start infrastructure:

   ```powershell
   docker compose up postgres redis minio minio-create-bucket
   ```

4. Run the database migration:

   ```powershell
   corepack pnpm db:migrate
   ```

5. Start the apps:

   ```powershell
   corepack pnpm dev
   ```

The web app runs on `http://localhost:3000`, and the API runs on `http://localhost:3001`.

## Authentication

Fresh installs use local email and password login by default:

```env
AUTH_MODE=password
NEXT_PUBLIC_AUTH_MODE=password
```

This makes the app usable without any external identity provider. For an internet-facing deployment, prefer putting Better Auth or another OIDC-compatible provider in front of login so you can centralize account security, MFA, password policies, and session controls outside the app.

To use Better Auth or another OIDC provider, set:

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
```

When external auth is enabled, the login page shows a single provider button instead of the password form.

## Docker Compose

For a full local deployment:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Run migrations before using a fresh database:

```powershell
pnpm db:migrate
```

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
EXTERNAL_AUTH_CLIENT_SECRET
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

Prebuilt `web` images must already have been built with the same `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_AUTH_MODE`, and `NEXT_PUBLIC_AUTH_PROVIDER_NAME` values you deploy with. Next.js bakes those values into the browser bundle at build time.

The Dockhand Compose file includes a one-shot `migrate` service, so fresh databases run Prisma migrations before `api`, `worker`, and `web` start.

## GitHub Container Images

Every push to `main` builds and publishes multi-platform `linux/amd64` and `linux/arm64` app images to GitHub Container Registry:

```text
ghcr.io/OWNER/REPO/api:latest
ghcr.io/OWNER/REPO/worker:latest
ghcr.io/OWNER/REPO/web:latest
```

Each image is also tagged with the commit SHA as `sha-<commit>`.
Each workflow run also publishes a shared timestamp release tag for all app images, for example `release-20260613-173045-utc`.

Before the first push to `main`, configure these GitHub Actions repository variables because they are compiled into the Next.js `web` image at build time:

```text
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_AUTH_MODE=password
NEXT_PUBLIC_AUTH_PROVIDER_NAME=Home Auth
```

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

## MVP Workflow

1. Register a local account.
2. Create a geocaching profile with your GC username and optional home coordinates.
3. Upload a `.gpx` My Finds file or `.zip` Pocket Query.
4. The API stores the original file in MinIO and queues a BullMQ import job.
5. The worker parses GPX data, upserts cache metadata, stores finds when found-log data is present, and recalculates stats.
6. The web dashboard, stats page, import history, and map placeholder read from the API.

## Useful Commands

```powershell
corepack pnpm build
corepack pnpm typecheck
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm --filter @geostats/api dev
corepack pnpm --filter @geostats/worker dev
corepack pnpm --filter @geostats/web dev
```

## Architecture Notes

- The backend API is the source of truth. The frontend never reads from Prisma directly.
- All user-owned data is scoped by `user_id`.
- Cache coordinates are stored as scalar latitude/longitude and as a PostGIS geography point.
- Object storage uses S3-compatible environment variables so MinIO can be replaced with cloud S3 later.
- Mobile is intentionally not scaffolded yet; API contracts and shared packages are shaped so an Expo app can be added later.

## Not In The MVP

- Android/Expo app
- public profile sharing
- friend comparison
- challenge checker
- Geocaching.com scraping
- live Geocaching.com sync
- advanced map filtering
- cloud deployment automation
