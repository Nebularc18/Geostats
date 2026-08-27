FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/worker/src apps/worker/src
COPY apps/worker/tsconfig.json apps/worker/tsconfig.json
RUN pnpm --filter @geostats/shared build
RUN pnpm --filter @geostats/stats build
RUN pnpm --filter @geostats/gpx-parser build
RUN pnpm --filter @geostats/db build
RUN pnpm --filter @geostats/worker build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/worker/dist ./apps/worker/dist
RUN node -e "require('./packages/db/node_modules/@prisma/client')"
USER node
CMD ["node", "apps/worker/dist/main.js"]
