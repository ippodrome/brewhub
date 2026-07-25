import type { FastifyInstance } from "fastify";
import { UpdateDeviceSensorRequestSchema } from "@brewhub/shared-types";
import { getDevice } from "../db/repositories/devices.repo.js";
import {
  getSensor,
  listSensorsForDevice,
  setControlSensor,
  setSensorLabel,
  setSensorOffset,
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

      if (parsed.data.offsetC !== undefined) {
        setSensorOffset(fastify.db, id, address, parsed.data.offsetC);
      }

      if (parsed.data.isControlSensor === true) {
        setControlSensor(fastify.db, id, address);
      }

      const sensors = listSensorsForDevice(fastify.db, id);

      // The device needs telling whenever either half of "which sensor
      // controls, and how far off is it" changes — a new control sensor, or a
      // new offset on the one that already controls. Both go out over the
      // existing declarative config channel, never as a direct command
      // (ADR-004), and the offset is mirrored rather than applied here so the
      // ESP32 corrects its own control input (ADR-020).
      const controlSensor = sensors.find((sensor) => sensor.isControlSensor);
      const editedTheControlSensor = controlSensor?.address === address;
      if (
        controlSensor &&
        (parsed.data.isControlSensor === true ||
          (parsed.data.offsetC !== undefined && editedTheControlSensor))
      ) {
        const config = updateDeviceConfig(fastify.db, id, {
          controlSensorAddress: controlSensor.address,
          controlSensorOffsetC: controlSensor.offsetC,
        });
        publishDeviceConfig(fastify.mqttClient, id, config);
      }

      return sensors;
    },
  );
}
