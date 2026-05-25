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
