import type { FastifyInstance } from "fastify";
import { UpdateDeviceSensorRequestSchema } from "@brewhub/shared-types";
import { getDevice } from "../db/repositories/devices.repo.js";
import {
  getSensor,
  listSensorsForDevice,
  setControlSensor,
  setSensorLabel,
} from "../db/repositories/device-sensors.repo.js";
import { updateDeviceConfig } from "../db/repositories/device-configs.repo.js";
import { publishDeviceConfig } from "../mqtt/publish-config.js";

export async function sensorsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/devices/:id/sensors",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!getDevice(fastify.db, id)) {
        return reply.code(404).send({ error: "Device not found" });
      }
      return listSensorsForDevice(fastify.db, id);
    },
  );

  fastify.patch(
    "/api/devices/:id/sensors/:address",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id, address } = request.params as { id: string; address: string };

      if (!getSensor(fastify.db, id, address)) {
        return reply.code(404).send({ error: "Sensor not found for this device" });
      }

      const parsed = UpdateDeviceSensorRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
      }

      if (parsed.data.label !== undefined) {
        setSensorLabel(fastify.db, id, address, parsed.data.label);
      }

      if (parsed.data.isControlSensor === true) {
        setControlSensor(fastify.db, id, address);
        // Implements ADR-004: tell the device via the existing declarative
        // config channel, never a direct command.
        const config = updateDeviceConfig(fastify.db, id, { controlSensorAddress: address });
        publishDeviceConfig(fastify.mqttClient, id, config);
      }

      return listSensorsForDevice(fastify.db, id);
    },
  );
}
