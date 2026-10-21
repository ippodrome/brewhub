# syntax=docker/dockerfile:1
#
# Caddy with the built frontend baked in.
#
# Before this existed, Caddy bind-mounted `apps/frontend/dist` off the host,
# which meant the machine running the stack needed a full checkout plus Node
# and pnpm just to produce static files — a hole in the "pull and go, nothing
# to build locally" story the backend image already delivered (DECISIONS.md
# ADR-023). Unraid has neither toolchain, so in practice the frontend was
# built on a laptop and copied across.
#
# The Caddyfile is baked in too, for the same reason: an image that still
# needed a file off the host would not have closed the hole. Editing it now
# means rebuilding the image — see docker-compose.dev.yml for the local loop.

FROM node:22-bookworm AS base
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
WORKDIR /app

# ---- deps: only the two workspaces the frontend build actually needs ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN pnpm install --frozen-lockfile --filter @brewhub/shared-types --filter @brewhub/frontend

# ---- build: shared-types first; the frontend's `tsc -b` needs its output ----
FROM deps AS build
# Baked into the bundle (vite define) so Settings can show the UI version.
ARG BREWHUB_VERSION=dev
ENV BREWHUB_VERSION=${BREWHUB_VERSION}
COPY packages/shared-types packages/shared-types
COPY apps/frontend apps/frontend
RUN pnpm --filter @brewhub/shared-types build
RUN pnpm --filter @brewhub/frontend build

# ---- runtime: stock Caddy plus static output; no Node, no toolchain ----
FROM caddy:2 AS runtime
ARG BREWHUB_VERSION=dev
LABEL org.opencontainers.image.version=${BREWHUB_VERSION}
COPY --from=build /app/apps/frontend/dist /srv/frontend
COPY docker/caddy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 8443
