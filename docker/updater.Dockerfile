# syntax=docker/dockerfile:1
#
# brewhub-updater: the only BrewHub component that can reach Docker, and
# only through docker-socket-proxy (never the raw socket). Zero npm runtime
# dependencies — just Node, the docker CLI and the compose plugin.

FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/updater/package.json apps/updater/package.json
RUN pnpm install --frozen-lockfile --filter @brewhub/updater
COPY apps/updater apps/updater
RUN pnpm --filter @brewhub/updater build

FROM node:22-alpine AS runtime
RUN apk add --no-cache docker-cli docker-cli-compose
ARG BREWHUB_VERSION=dev
LABEL org.opencontainers.image.version=${BREWHUB_VERSION}
ENV NODE_ENV=production \
    NODE_NO_WARNINGS=1 \
    DOCKER_HOST=tcp://docker-proxy:2375
WORKDIR /app
COPY --from=build /app/apps/updater/dist ./dist
COPY apps/updater/package.json ./package.json
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "dist/index.js"]
