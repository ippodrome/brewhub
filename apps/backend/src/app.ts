import Fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import type { AppConfig } from "./config/env.js";
import { healthRoutes } from "./routes/health.routes.js";
import { authPlugin } from "./plugins/auth.plugin.js";
import { authRoutes } from "./routes/auth.routes.js";
import { backupRoutes, MAX_RESTORE_UPLOAD_BYTES } from "./routes/backup.routes.js";
import { devicesRoutes } from "./routes/devices.routes.js";
import { discoveredDevicesRoutes } from "./routes/discovered-devices.routes.js";
import { firmwareRoutes, MAX_FIRMWARE_BYTES } from "./routes/firmware.routes.js";
import { gravityIngestRoutes } from "./routes/gravity-ingest.routes.js";
import { historyRoutes } from "./routes/history.routes.js";
import { hydrometersRoutes } from "./routes/hydrometers.routes.js";
import { notificationsRoutes } from "./routes/notifications.routes.js";
import { profilesRoutes } from "./routes/profiles.routes.js";
import { sensorsRoutes } from "./routes/sensors.routes.js";
import { tapsRoutes } from "./routes/taps.routes.js";
import { wsRoutes } from "./routes/ws.routes.js";
import { systemRoutes } from "./routes/system.routes.js";

export interface AppDeps {
  db: Database.Database;
  config: AppConfig;
  /** Injected in tests to stand in for the updater service. */
  fetchImpl?: typeof fetch;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: deps.config.NODE_ENV === "test" ? "silent" : "info",
    },
  });

  fastify.decorate("db", deps.db);
  fastify.decorate("appConfig", deps.config);

  // origin: true (reflect-any-origin) is intentional, not an oversight: auth
  // is a bearer token in the Authorization header (read from localStorage by
  // the app's own JS), never a cookie, so there's no session for a
  // cross-origin page to ride on — the classic CORS/CSRF risk this setting
  // usually implies doesn't apply here. Matches the LAN-only trust model
  // already accepted for MQTT in DECISIONS.md ADR-008; this isn't exposed
  // beyond the LAN per claude.md's own non-goals.
  await fastify.register(cors, { origin: true });
  await fastify.register(websocket);
  // The global limit has to accommodate the largest thing anyone uploads
  // (a database restore), not the smallest (a firmware binary) — the
  // firmware route enforces its own tighter MAX_FIRMWARE_BYTES explicitly,
  // see firmware.routes.ts.
  await fastify.register(multipart, {
    attachFieldsToBody: "keyValues",
    limits: { fileSize: MAX_RESTORE_UPLOAD_BYTES },
  });
  await fastify.register(authPlugin);

  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(backupRoutes);
  await fastify.register(devicesRoutes);
  await fastify.register(discoveredDevicesRoutes);
  await fastify.register(firmwareRoutes);
  await fastify.register(gravityIngestRoutes);
  await fastify.register(historyRoutes);
  await fastify.register(hydrometersRoutes);
  await fastify.register(notificationsRoutes);
  await fastify.register(profilesRoutes);
  await fastify.register(sensorsRoutes);
  await fastify.register(tapsRoutes);
  await fastify.register(wsRoutes);
  await fastify.register(systemRoutes, { fetchImpl: deps.fetchImpl ?? fetch });

  return fastify;
}
