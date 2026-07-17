# syntax=docker/dockerfile:1

FROM node:22-bookworm AS base
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
WORKDIR /app

# ---- deps: install workspace dependencies (needs build tools for better-sqlite3's native binding) ----
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY apps/backend/package.json apps/backend/package.json
RUN pnpm install --frozen-lockfile --filter @brewhub/shared-types --filter @brewhub/backend

# ---- build: compile shared-types (needed as plain JS, not TS-on-the-fly) then backend ----
FROM deps AS build
COPY packages/shared-types packages/shared-types
COPY apps/backend apps/backend
RUN pnpm --filter @brewhub/shared-types build
RUN pnpm --filter @brewhub/backend build

# ---- runtime: slim image, no build tools, just the compiled output + resolved node_modules ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared-types ./packages/shared-types
COPY --from=build /app/apps/backend ./apps/backend

WORKDIR /app/apps/backend
EXPOSE 3000
CMD ["node", "dist/index.js"]
