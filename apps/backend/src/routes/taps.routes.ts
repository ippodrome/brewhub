import type { FastifyInstance } from "fastify";
import { CreateTapRequestSchema, UpdateTapRequestSchema } from "@brewhub/shared-types";
import { getDevice } from "../db/repositories/devices.repo.js";
import {
  deleteTap,
  findTapChannelConflict,
  getTap,
  insertTap,
  listTapsForDevice,
  resetKeg,
  updateTapDetails,
} from "../db/repositories/taps.repo.js";
import { listPourEventsForTap } from "../db/repositories/pour-events.repo.js";
import { publishTapVolumeDiscovery, removeTapVolumeDiscovery } from "../mqtt/publish-ha-discovery.js";
import { publishTapState } from "../mqtt/publish-tap-state.js";

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

    if (parsed.data.measurementType === "weight") {
      const weightDevice = getDevice(fastify.db, parsed.data.weightDeviceId);
      if (!weightDevice || weightDevice.type !== "keg_scale") {
        return reply.code(400).send({ error: "weightDeviceId must reference an existing keg_scale device" });
      }
    }

    const conflict =
      parsed.data.measurementType === "flow"
        ? findTapChannelConflict(fastify.db, id, {
            measurementType: "flow",
            flowIndex: parsed.data.flowIndex,
          })
        : findTapChannelConflict(fastify.db, id, {
            measurementType: "weight",
            weightDeviceId: parsed.data.weightDeviceId,
            weightIndex: parsed.data.weightIndex,
          });
    if (conflict) {
      return reply.code(409).send({ error: "That measurement channel already has a tap configured" });
    }

    const tap = insertTap(fastify.db, id, parsed.data);

    const device = getDevice(fastify.db, id);
    if (device) {
      publishTapVolumeDiscovery(fastify.mqttClient, device, tap);
      publishTapState(fastify.mqttClient, id, tap);
    }

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
        if (tap.measurementType === "flow" && details.flowIndex !== undefined && details.flowIndex !== tap.flowIndex) {
          const existing = findTapChannelConflict(
            fastify.db,
            id,
            { measurementType: "flow", flowIndex: details.flowIndex },
            numericId,
          );
          if (existing) {
            return reply.code(409).send({ error: "That measurement channel already has a tap configured" });
          }
        }

        if (tap.measurementType === "weight") {
          const nextWeightDeviceId = details.weightDeviceId ?? tap.weightDeviceId;
          const nextWeightIndex = details.weightIndex ?? tap.weightIndex;
          if (details.weightDeviceId !== undefined) {
            const weightDevice = getDevice(fastify.db, details.weightDeviceId);
            if (!weightDevice || weightDevice.type !== "keg_scale") {
              return reply
                .code(400)
                .send({ error: "weightDeviceId must reference an existing keg_scale device" });
            }
          }
          if (
            nextWeightDeviceId !== null &&
            nextWeightIndex !== null &&
            (details.weightDeviceId !== undefined || details.weightIndex !== undefined)
          ) {
            const existing = findTapChannelConflict(
              fastify.db,
              id,
              { measurementType: "weight", weightDeviceId: nextWeightDeviceId, weightIndex: nextWeightIndex },
              numericId,
            );
            if (existing) {
              return reply.code(409).send({ error: "That measurement channel already has a tap configured" });
            }
          }
        }

        updateTapDetails(fastify.db, numericId, details);
      }

      if (shouldResetKeg) {
        resetKeg(fastify.db, numericId);
      }

      const updated = getTap(fastify.db, numericId);
      if (updated) {
        const device = getDevice(fastify.db, id);
        // Republish discovery too (not just state) so a renamed tap's HA
        // entity name stays in sync — cheap, retained, idempotent.
        if (device) publishTapVolumeDiscovery(fastify.mqttClient, device, updated);
        publishTapState(fastify.mqttClient, id, updated);
      }

      return updated;
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
      removeTapVolumeDiscovery(fastify.mqttClient, id, numericId);
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
