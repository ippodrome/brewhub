import mqtt, { type MqttClient } from "mqtt";
import {
  DiscoveryMessageSchema,
  GravityTelemetryPayloadSchema,
  parseTopic,
  StatusPayloadSchema,
  TelemetryPayloadSchema,
} from "@brewhub/shared-types";
import type { DiscoveryMessage, GravityTelemetryPayload, StatusPayload, TelemetryPayload } from "@brewhub/shared-types";
import type { FastifyBaseLogger } from "fastify";

export interface MqttClientOptions {
  url: string;
  username?: string;
  password?: string;
  logger: FastifyBaseLogger;
  onStatus: (payload: StatusPayload) => void;
  onTelemetry: (payload: TelemetryPayload) => void;
  onDiscovery: (message: DiscoveryMessage) => void;
  onGravity: (payload: GravityTelemetryPayload) => void;
}

export function createMqttClient(options: MqttClientOptions): MqttClient {
  const client = mqtt.connect(options.url, {
    username: options.username,
    password: options.password,
    reconnectPeriod: 2000,
  });

  client.on("connect", () => {
    options.logger.info("MQTT connected, subscribing to status/telemetry/discovery/gravity topics");
    client.subscribe(["unibrew/+/status", "unibrew/+/telemetry", "unibrew/+/discovery", "unibrew/+/gravity"], (err) => {
      if (err) options.logger.error({ err }, "MQTT subscribe failed");
    });
  });

  client.on("reconnect", () => options.logger.warn("MQTT reconnecting..."));
  client.on("error", (err) => options.logger.error({ err }, "MQTT client error"));

  client.on("message", (topic, messageBuf) => {
    const parsedTopic = parseTopic(topic);
    if (!parsedTopic) return;

    let json: unknown;
    try {
      json = JSON.parse(messageBuf.toString("utf-8"));
    } catch (err) {
      options.logger.warn({ err, topic }, "MQTT message is not valid JSON, dropping");
      return;
    }

    if (parsedTopic.kind === "status") {
      const parsed = StatusPayloadSchema.safeParse(json);
      if (!parsed.success) {
        options.logger.warn({ topic, error: parsed.error.flatten() }, "Invalid status payload, dropping");
        return;
      }
      options.onStatus(parsed.data);
    } else if (parsedTopic.kind === "telemetry") {
      const parsed = TelemetryPayloadSchema.safeParse(json);
      if (!parsed.success) {
        options.logger.warn({ topic, error: parsed.error.flatten() }, "Invalid telemetry payload, dropping");
        return;
      }
      options.onTelemetry(parsed.data);
    } else if (parsedTopic.kind === "discovery") {
      const parsed = DiscoveryMessageSchema.safeParse(json);
      if (!parsed.success) {
        options.logger.warn({ topic, error: parsed.error.flatten() }, "Invalid discovery payload, dropping");
        return;
      }
      options.onDiscovery(parsed.data);
    } else if (parsedTopic.kind === "gravity") {
      const parsed = GravityTelemetryPayloadSchema.safeParse(json);
      if (!parsed.success) {
        options.logger.warn({ topic, error: parsed.error.flatten() }, "Invalid gravity payload, dropping");
        return;
      }
      options.onGravity(parsed.data);
    }
  });

  return client;
}
