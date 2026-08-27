FROM --platform=$BUILDPLATFORM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared packages/shared
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_AUTH_MODE
ARG NEXT_PUBLIC_AUTH_PROVIDER_NAME
ARG NEXT_PUBLIC_DEV_AUTO_LOGIN
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_AUTH_MODE=$NEXT_PUBLIC_AUTH_MODE
ENV NEXT_PUBLIC_AUTH_PROVIDER_NAME=$NEXT_PUBLIC_AUTH_PROVIDER_NAME
ENV NEXT_PUBLIC_DEV_AUTO_LOGIN=$NEXT_PUBLIC_DEV_AUTO_LOGIN
ENV NEXT_STANDALONE=true
COPY apps/web/app apps/web/app
COPY apps/web/components apps/web/components
COPY apps/web/lib apps/web/lib
COPY apps/web/public apps/web/public
COPY apps/web/next-env.d.ts apps/web/next-env.d.ts
COPY apps/web/css.d.ts apps/web/css.d.ts
COPY apps/web/next.config.ts apps/web/next.config.ts
COPY apps/web/tsconfig.json apps/web/tsconfig.json
RUN pnpm --filter @geostats/shared build
RUN pnpm --filter @geostats/web build

FROM --platform=$TARGETPLATFORM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
CMD ["node", "apps/web/server.js"]
