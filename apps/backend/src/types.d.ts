import type Database from "better-sqlite3";
import type { MqttClient } from "mqtt";
import type { AppConfig } from "./config/env.js";
import type { MqttConnectionManager } from "./mqtt/manager.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Database.Database;
    appConfig: AppConfig;
    /** Stable proxy to the current client — survives broker switches. */
    mqttClient: MqttClient;
    mqttManager: MqttConnectionManager;
  }
}
