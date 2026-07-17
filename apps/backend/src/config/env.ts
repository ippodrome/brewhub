import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DB_PATH: z.string().min(1).default("./data/brewhub.db"),
  MQTT_URL: z.string().min(1).default("mqtt://localhost:1883"),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  PRESENCE_SWEEP_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  PRESENCE_STALE_AFTER_MS: z.coerce.number().int().positive().default(60000),
  PROFILE_SCHEDULER_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }
  return result.data;
}
