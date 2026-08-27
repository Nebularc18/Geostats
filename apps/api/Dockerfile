FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/api/src apps/api/src
COPY apps/tools/src apps/tools/src
COPY apps/api/nest-cli.json apps/api/nest-cli.json
COPY apps/api/tsconfig.json apps/api/tsconfig.json
RUN pnpm --filter @geostats/shared build
RUN pnpm --filter @geostats/stats build
RUN pnpm --filter @geostats/db build
RUN pnpm --filter @geostats/api build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/src/stats/map-assets ./apps/api/dist/stats/map-assets
COPY --from=build --chown=node:node /app/apps/tools/src ./apps/tools/src
RUN node -e "require('./packages/db/node_modules/@prisma/client')"
USER node
CMD ["sh", "-c", "node packages/db/node_modules/prisma/build/index.js migrate deploy --schema packages/db/prisma/schema.prisma && exec node apps/api/dist/main.js"]
