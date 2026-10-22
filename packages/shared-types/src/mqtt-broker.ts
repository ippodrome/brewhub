import { z } from "zod";

/**
 * Which MQTT broker the backend talks to. "builtin" = the bundled Mosquitto
 * configured through MQTT_URL/MQTT_USERNAME/MQTT_PASSWORD (the pre-existing,
 * env-only behaviour); "custom" = a broker entered in Settings, e.g. Home
 * Assistant's Mosquitto add-on.
 */
export const MqttBrokerModeSchema = z.enum(["builtin", "custom"]);
export type MqttBrokerMode = z.infer<typeof MqttBrokerModeSchema>;

/** Bare hostname, IPv4 or IPv6 — no scheme, path or port. */
const HostSchema = z
  .string()
  .trim()
  .min(1, "Host is required")
  .max(253)
  .regex(/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*|\[?[0-9A-Fa-f:.]+\]?)$/, "Enter a hostname or IP address without mqtt:// or a port");

export const MqttConnectionStateSchema = z.enum(["connected", "connecting", "disconnected"]);
export type MqttConnectionState = z.infer<typeof MqttConnectionStateSchema>;

export const MqttConnectionStatusSchema = z.object({
  state: MqttConnectionStateSchema,
  /** Broker URL without credentials. */
  url: z.string(),
  lastError: z.string().nullable(),
  /** ms since epoch of the last successful connect, null if never. */
  connectedAt: z.number().nullable(),
});
export type MqttConnectionStatus = z.infer<typeof MqttConnectionStatusSchema>;

/** GET response — the password itself is write-only and never returned. */
export const MqttBrokerSettingsSchema = z.object({
  mode: MqttBrokerModeSchema,
  /** false = nothing saved yet, env values are in effect. */
  saved: z.boolean(),
  host: z.string().nullable(),
  port: z.number().int(),
  tls: z.boolean(),
  username: z.string().nullable(),
  hasPassword: z.boolean(),
  /** The built-in broker's URL from MQTT_URL (credentials stripped), for display. */
  builtinUrl: z.string(),
  status: MqttConnectionStatusSchema,
});
export type MqttBrokerSettings = z.infer<typeof MqttBrokerSettingsSchema>;

const CustomFieldsSchema = z.object({
  host: HostSchema,
  port: z.coerce.number().int().min(1).max(65535).default(1883),
  tls: z.boolean().default(false),
  username: z.string().trim().max(256).optional().nullable(),
  /** Empty / omitted = keep the stored password. */
  password: z.string().max(256).optional().nullable(),
  /** Explicitly remove the stored password (connect without one). */
  clearPassword: z.boolean().optional(),
});

export const UpdateMqttBrokerRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("builtin") }),
  CustomFieldsSchema.extend({ mode: z.literal("custom") }),
]);
export type UpdateMqttBrokerRequest = z.infer<typeof UpdateMqttBrokerRequestSchema>;

/** Same shape as a save — tests what WOULD be saved, without saving it. */
export const TestMqttBrokerRequestSchema = UpdateMqttBrokerRequestSchema;
export type TestMqttBrokerRequest = UpdateMqttBrokerRequest;

export const TestMqttBrokerResponseSchema = z.object({
  ok: z.boolean(),
  url: z.string(),
  latencyMs: z.number().nullable(),
  error: z.string().nullable(),
});
export type TestMqttBrokerResponse = z.infer<typeof TestMqttBrokerResponseSchema>;
