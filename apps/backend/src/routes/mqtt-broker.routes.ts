import type { FastifyInstance } from "fastify";
import { TestMqttBrokerRequestSchema, UpdateMqttBrokerRequestSchema, type MqttBrokerSettings } from "@brewhub/shared-types";
import {
  connectionParamsFor,
  getMqttBrokerSettings,
  redactUrl,
  resolveMqttConnection,
  saveMqttBrokerSettings,
} from "../db/repositories/mqtt-broker-settings.repo.js";

export interface MqttBrokerRoutesOptions {
  /** How long Test / Save wait for the broker to answer. */
  timeoutMs?: number;
}

/**
 * Broker selection for the Settings → MQTT card. All routes are behind
 * verifyAuth — BrewHub has a single admin account, so authenticated = admin.
 * The password is write-only: requests may set it, responses only ever say
 * hasPassword.
 */
export async function mqttBrokerRoutes(fastify: FastifyInstance, opts: MqttBrokerRoutesOptions): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5000;

  const view = (): MqttBrokerSettings => {
    const stored = getMqttBrokerSettings(fastify.db);
    const status = fastify.hasDecorator("mqttManager")
      ? fastify.mqttManager.status()
      : { state: "disconnected" as const, url: redactUrl(resolveMqttConnection(fastify.db, fastify.appConfig).url), lastError: null, connectedAt: null };
    return { ...stored, builtinUrl: redactUrl(fastify.appConfig.MQTT_URL), status };
  };

  fastify.get("/api/mqtt/broker", { preHandler: fastify.verifyAuth }, async () => view());

  fastify.post("/api/mqtt/broker/test", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const parsed = TestMqttBrokerRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    if (!fastify.hasDecorator("mqttManager")) return reply.code(503).send({ error: "MQTT is not running" });
    const params = connectionParamsFor(fastify.db, fastify.appConfig, parsed.data);
    return fastify.mqttManager.test(params, timeoutMs);
  });

  fastify.put("/api/mqtt/broker", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const parsed = UpdateMqttBrokerRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    saveMqttBrokerSettings(fastify.db, parsed.data);
    if (fastify.hasDecorator("mqttManager")) {
      const params = resolveMqttConnection(fastify.db, fastify.appConfig);
      request.log.info({ url: redactUrl(params.url) }, "MQTT broker setting saved, reconnecting");
      await fastify.mqttManager.switchTo(params, timeoutMs);
    }
    return view();
  });
}
