import type { FastifyInstance } from "fastify";
import { CreateDeviceRequestSchema, UpdateDeviceConfigRequestSchema } from "@brewhub/shared-types";
import {
  deleteDevice,
  getDevice,
  insertDevice,
  listDevices,
} from "../db/repositories/devices.repo.js";
import { ensureDefaultDeviceConfig, updateDeviceConfig } from "../db/repositories/device-configs.repo.js";
import { publishDeviceConfig } from "../mqtt/publish-config.js";

export async function devicesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/devices", { preHandler: fastify.verifyAuth }, async () => {
    return listDevices(fastify.db);
  });

  fastify.get("/api/devices/:id", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const device = getDevice(fastify.db, id);
    if (!device) return reply.code(404).send({ error: "Device not found" });
    return device;
  });

  fastify.post("/api/devices", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const parsed = CreateDeviceRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    if (getDevice(fastify.db, parsed.data.id)) {
      return reply.code(409).send({ error: `Device "${parsed.data.id}" already exists` });
    }

    const device = insertDevice(fastify.db, parsed.data);
    ensureDefaultDeviceConfig(fastify.db, device.id);

    return reply.code(201).send(device);
  });

  fastify.delete("/api/devices/:id", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = deleteDevice(fastify.db, id);
    if (!deleted) return reply.code(404).send({ error: "Device not found" });
    return reply.code(204).send();
  });

  // Implements DECISIONS.md ADR-004: this is the ONLY route that touches a
  // device's control config, and it only ever publishes declarative,
  // retained MQTT config — never a direct actuator command.
  fastify.patch(
    "/api/devices/:id/config",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      if (!getDevice(fastify.db, id)) {
        return reply.code(404).send({ error: "Device not found" });
      }

      const parsed = UpdateDeviceConfigRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
      }

      const config = updateDeviceConfig(fastify.db, id, parsed.data);
      publishDeviceConfig(fastify.mqttClient, id, config);

      return reply.send(config);
    },
  );
}
