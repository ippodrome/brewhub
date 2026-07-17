import Fastify, { type FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import cors from "@fastify/cors";
import type { AppConfig } from "./config/env.js";
import { healthRoutes } from "./routes/health.routes.js";

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

  await fastify.register(healthRoutes);

  return fastify;
}
