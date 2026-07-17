import type { FastifyInstance } from "fastify";
import { CreateTapRequestSchema, UpdateTapRequestSchema } from "@brewhub/shared-types";
import { getDevice } from "../db/repositories/devices.repo.js";
import {
  deleteTap,
  getTap,
  getTapByFlowIndex,
  insertTap,
  listTapsForDevice,
  resetKeg,
  updateTapDetails,
} from "../db/repositories/taps.repo.js";
import { listPourEventsForTap } from "../db/repositories/pour-events.repo.js";

export async function tapsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/devices/:id/taps", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDevice(fastify.db, id)) {
      return reply.code(404).send({ error: "Device not found" });
    }
    return listTapsForDevice(fastify.db, id);
  });

  fastify.post("/api/devices/:id/taps", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDevice(fastify.db, id)) {
      return reply.code(404).send({ error: "Device not found" });
    }

    const parsed = CreateTapRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    if (getTapByFlowIndex(fastify.db, id, parsed.data.flowIndex)) {
      return reply
        .code(409)
        .send({ error: `Flow index ${parsed.data.flowIndex} already has a tap on this device` });
    }

    const tap = insertTap(fastify.db, id, parsed.data);
    return reply.code(201).send(tap);
  });

  fastify.patch(
    "/api/devices/:id/taps/:tapId",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id, tapId } = request.params as { id: string; tapId: string };
      const numericId = Number(tapId);

      const tap = getTap(fastify.db, numericId);
      if (!tap || tap.deviceId !== id) {
        return reply.code(404).send({ error: "Tap not found" });
      }

      const parsed = UpdateTapRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
      }

      const { resetKeg: shouldResetKeg, ...details } = parsed.data;

      if (Object.keys(details).length > 0) {
        if (details.flowIndex !== undefined && details.flowIndex !== tap.flowIndex) {
          const existing = getTapByFlowIndex(fastify.db, id, details.flowIndex);
          if (existing && existing.id !== numericId) {
            return reply
              .code(409)
              .send({ error: `Flow index ${details.flowIndex} already has a tap on this device` });
          }
        }
        updateTapDetails(fastify.db, numericId, details);
      }

      if (shouldResetKeg) {
        resetKeg(fastify.db, numericId);
      }

      return getTap(fastify.db, numericId);
    },
  );

  fastify.delete(
    "/api/devices/:id/taps/:tapId",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id, tapId } = request.params as { id: string; tapId: string };
      const numericId = Number(tapId);

      const tap = getTap(fastify.db, numericId);
      if (!tap || tap.deviceId !== id) {
        return reply.code(404).send({ error: "Tap not found" });
      }

      deleteTap(fastify.db, numericId);
      return reply.code(204).send();
    },
  );

  fastify.get(
    "/api/devices/:id/taps/:tapId/pours",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id, tapId } = request.params as { id: string; tapId: string };
      const numericId = Number(tapId);

      const tap = getTap(fastify.db, numericId);
      if (!tap || tap.deviceId !== id) {
        return reply.code(404).send({ error: "Tap not found" });
      }

      return listPourEventsForTap(fastify.db, numericId);
    },
  );
}
