import type Database from "better-sqlite3";
import type { AppConfig } from "./config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database.Database;
    appConfig: AppConfig;
  }
}
