import mqtt, { type MqttClient } from "mqtt";
import {
  ControlDecisionPayloadSchema,
  ControlStatePayloadSchema,
  decisionWildcardTopic,
  DiscoveryMessageSchema,
  GravityTelemetryPayloadSchema,
  parseTopic,
  stateWildcardTopic,
  StatusPayloadSchema,
  TelemetryPayloadSchema,
} from "@brewhub/shared-types";
import type {
  ControlDecisionPayload,
  ControlStatePayload,
  DiscoveryMessage,
  GravityTelemetryPayload,
  StatusPayload,
  TelemetryPayload,
} from "@brewhub/shared-types";
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
  onControlState: (payload: ControlStatePayload) => void;
  onControlDecision: (payload: ControlDecisionPayload) => void;
}

export function createMqttClient(options: MqttClientOptions): MqttClient {
  const client = mqtt.connect(options.url, {
    username: options.username,
    password: options.password,
    reconnectPeriod: 2000,
  });

  client.on("connect", () => {
    options.logger.info("MQTT connected, subscribing to device topics");
    client.subscribe(
      [
        "unibrew/+/status",
        "unibrew/+/telemetry",
        "unibrew/+/discovery",
        "unibrew/+/gravity",
        stateWildcardTopic(),
        decisionWildcardTopic(),
      ],
      (err) => {
        if (err) options.logger.error({ err }, "MQTT subscribe failed");
      },
    );
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
    } else if (parsedTopic.kind === "state") {
      const parsed = ControlStatePayloadSchema.safeParse(json);
      if (!parsed.success) {
        options.logger.warn({ topic, error: parsed.error.flatten() }, "Invalid control state payload, dropping");
        return;
      }
      options.onControlState(parsed.data);
    } else if (parsedTopic.kind === "decision") {
      const parsed = ControlDecisionPayloadSchema.safeParse(json);
      if (!parsed.success) {
        options.logger.warn({ topic, error: parsed.error.flatten() }, "Invalid control decision payload, dropping");
        return;
      }
      options.onControlDecision(parsed.data);
    }
  });

  return client;
}
