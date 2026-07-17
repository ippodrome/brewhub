import Fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { AppConfig } from "./config/env.js";
import { healthRoutes } from "./routes/health.routes.js";
import { authPlugin } from "./plugins/auth.plugin.js";
import { authRoutes } from "./routes/auth.routes.js";
import { devicesRoutes } from "./routes/devices.routes.js";
import { profilesRoutes } from "./routes/profiles.routes.js";
import { wsRoutes } from "./routes/ws.routes.js";

export interface AppDeps {
  db: Database.Database;
  config: AppConfig;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: deps.config.NODE_ENV === "test" ? "silent" : "info",
    },
  });

  fastify.decorate("db", deps.db);
  fastify.decorate("appConfig", deps.config);

  await fastify.register(cors, { origin: true });
  await fastify.register(websocket);
  await fastify.register(authPlugin);

  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(devicesRoutes);
  await fastify.register(profilesRoutes);
  await fastify.register(wsRoutes);

  return fastify;
}
