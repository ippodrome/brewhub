import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DB_PATH: z.string().min(1).default("./data/brewhub.db"),
  MQTT_URL: z.string().min(1).default("mqtt://localhost:1883"),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  // A token that never expires is valid forever if it ever leaks. 30 days
  // balances that against not being annoying to re-log-in to for a home
  // app with no refresh-token flow — accepts @fastify/jwt's own duration
  // string format (e.g. "30d", "12h").
  JWT_EXPIRES_IN: z.string().min(1).default("30d"),
  // Only needed to trigger OTA updates — the backend otherwise has no way to
  // know its own LAN-reachable address (it only knows it's listening on
  // 0.0.0.0:3000 internally; Caddy is what's actually exposed). e.g.
  // https://192.168.1.50:8443. OTA-trigger requests 400 with a clear error
  // if this isn't set, rather than publishing a broken download URL.
  // "" is treated the same as unset — docker-compose.yml's ${PUBLIC_URL:-}
  // substitution sets an empty string, not an absent key, when the .env
  // doesn't define it, which z.string().url() would otherwise reject.
  PUBLIC_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
  PRESENCE_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  PRESENCE_STALE_AFTER_MS: z.coerce.number().int().positive().default(60000),
  PROFILE_SCHEDULER_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  // Collapses telemetry older than TELEMETRY_RETENTION_DAYS into hourly
  // averages so the readings/flow_readings/weight_readings/gravity_readings
  // tables stay bounded indefinitely (see DECISIONS.md). Once a day is
  // plenty — this isn't time-sensitive the way presence/profile polling is.
  TELEMETRY_ROLLUP_INTERVAL_MS: z.coerce.number().int().positive().default(86400000),
  TELEMETRY_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }
  return result.data;
}
