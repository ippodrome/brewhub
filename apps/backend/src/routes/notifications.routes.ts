import type { FastifyInstance } from "fastify";
import { CreatePushSubscriptionRequestSchema, UpdateNotificationSettingsRequestSchema } from "@brewhub/shared-types";
import {
  getNotificationSettings,
  updateNotificationSettings,
} from "../db/repositories/notification-settings.repo.js";
import {
  deletePushSubscriptionByEndpoint,
  insertPushSubscription,
} from "../db/repositories/push-subscriptions.repo.js";
import { sendNotification } from "../notifications/send.js";

export async function notificationsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/notifications/settings", { preHandler: fastify.verifyAuth }, async () => {
    return getNotificationSettings(fastify.db);
  });

  fastify.put("/api/notifications/settings", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const parsed = UpdateNotificationSettingsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    return updateNotificationSettings(fastify.db, parsed.data);
  });

  fastify.post("/api/notifications/subscribe", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const parsed = CreatePushSubscriptionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    insertPushSubscription(fastify.db, parsed.data);
    return reply.code(204).send();
  });

  fastify.delete("/api/notifications/subscribe", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const { endpoint } = request.body as { endpoint?: string };
    if (!endpoint) {
      return reply.code(400).send({ error: "endpoint is required" });
    }
    deletePushSubscriptionByEndpoint(fastify.db, endpoint);
    return reply.code(204).send();
  });

  fastify.post("/api/notifications/test", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    await sendNotification(fastify.db, fastify.log, {
      title: "BrewHub test notification",
      body: "If you can see this, notifications are working.",
    });
    return reply.code(202).send({ ok: true });
  });
}
