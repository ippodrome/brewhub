import type { FastifyInstance } from "fastify";
import { CreateDeviceRequestSchema, TriggerOtaRequestSchema, UpdateDeviceConfigRequestSchema } from "@brewhub/shared-types";
import {
  deleteDevice,
  getDevice,
  insertDevice,
  listDevices,
} from "../db/repositories/devices.repo.js";
import {
  clearActiveProfile,
  ensureDefaultDeviceConfig,
  getDeviceConfig,
  setActiveProfile,
  updateDeviceConfig,
} from "../db/repositories/device-configs.repo.js";
import { getFirmwareBuild } from "../db/repositories/firmware-builds.repo.js";
import { createOtaToken } from "../db/repositories/ota-tokens.repo.js";
import { getProfile } from "../db/repositories/profiles.repo.js";
import { listSensorsForDevice } from "../db/repositories/device-sensors.repo.js";
import { listTapsForDevice } from "../db/repositories/taps.repo.js";
import { getHydrometerForFermenter } from "../db/repositories/hydrometers.repo.js";
import { getLatestGravityReading } from "../db/repositories/gravity-readings.repo.js";
import { resolveProfileSetpoint } from "../profiles/resolve-setpoint.js";
import { resolveProfileSetpointByGravity } from "../profiles/resolve-setpoint-by-gravity.js";
import { publishDeviceConfig } from "../mqtt/publish-config.js";
import { publishOtaUpdate } from "../mqtt/publish-ota.js";
import {
  publishDeviceOnlineDiscovery,
  removeDeviceOnlineDiscovery,
  removeTapVolumeDiscovery,
  removeTemperatureSensorDiscovery,
} from "../mqtt/publish-ha-discovery.js";

const OTA_TOKEN_TTL_MS = 10 * 60 * 1000;

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
    publishDeviceOnlineDiscovery(fastify.mqttClient, device);

    return reply.code(201).send(device);
  });

  fastify.delete("/api/devices/:id", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };

    // Queried before deleting — deleteDevice CASCADEs and removes these
    // rows, so this is the last chance to know what HA discovery entries
    // need cleaning up.
    const sensors = listSensorsForDevice(fastify.db, id);
    const taps = listTapsForDevice(fastify.db, id);

    const deleted = deleteDevice(fastify.db, id);
    if (!deleted) return reply.code(404).send({ error: "Device not found" });

    removeDeviceOnlineDiscovery(fastify.mqttClient, id);
    for (const sensor of sensors) {
      removeTemperatureSensorDiscovery(fastify.mqttClient, id, sensor.address);
    }
    for (const tap of taps) {
      removeTapVolumeDiscovery(fastify.mqttClient, id, tap.id);
    }

    return reply.code(204).send();
  });

  // Read-only counterpart to the PATCH below. Purely a read: it publishes
  // nothing and so does not weaken ADR-004's "one route touches config"
  // rule, which is about what may be *sent* to a device.
  //
  // Its absence was a real gap — the frontend could write a config it could
  // never read back, which is why DeviceConfigForm starts at hardcoded
  // defaults instead of the device's actual values.
  fastify.get(
    "/api/devices/:id/config",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      if (!getDevice(fastify.db, id)) {
        return reply.code(404).send({ error: "Device not found" });
      }

      // A device registered through POST /api/devices always has a config
      // row, but reporting "Device not found" for one that somehow lacks it
      // would be an actively wrong answer about a device that plainly
      // exists. Filling in the defaults keeps the route total and says
      // something true.
      ensureDefaultDeviceConfig(fastify.db, id);
      return reply.send(getDeviceConfig(fastify.db, id));
    },
  );

  // Implements DECISIONS.md ADR-004: this is the ONLY route that sends a
  // device's control config onward, and it only ever publishes declarative,
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

      const { activeProfileId, ...configPartial } = parsed.data;
      let finalPartial = configPartial;

      if (activeProfileId === null) {
        clearActiveProfile(fastify.db, id);
      } else if (activeProfileId !== undefined) {
        const profile = getProfile(fastify.db, activeProfileId);
        if (!profile || profile.deviceId !== id) {
          return reply.code(400).send({ error: "Profile not found for this device" });
        }

        if (profile.triggerType === "gravity") {
          const hydrometer = getHydrometerForFermenter(fastify.db, id);
          if (!hydrometer) {
            return reply
              .code(400)
              .send({ error: "This device has no hydrometer assigned — assign one before activating a gravity-based profile" });
          }
          setActiveProfile(fastify.db, id, activeProfileId, Date.now());
          // Resolve immediately if a reading already exists (mirrors the
          // time-based elapsed=0 immediacy below); otherwise leave setpointC
          // untouched — the scheduler picks it up on the first reading,
          // same skip-until-data-exists behavior as its own tick logic.
          const latest = getLatestGravityReading(fastify.db, hydrometer.id);
          if (latest && latest.specific_gravity !== null) {
            finalPartial = { ...configPartial, setpointC: resolveProfileSetpointByGravity(profile.steps, latest.specific_gravity) };
          }
        } else {
          setActiveProfile(fastify.db, id, activeProfileId, Date.now());
          // Resolve immediately at activation (elapsed=0) — don't wait for the
          // scheduler's next tick, and this wins over any setpointC also sent
          // in this same request.
          finalPartial = { ...configPartial, setpointC: resolveProfileSetpoint(profile.steps, 0) };
        }
      }

      const config = updateDeviceConfig(fastify.db, id, finalPartial);
      publishDeviceConfig(fastify.mqttClient, id, config);

      return reply.send(config);
    },
  );

  // Deliberately separate from the config route above — see publish-ota.ts
  // and DECISIONS.md for why OTA is NOT part of the retained-config
  // contract ADR-004 establishes for everything else on this route file.
  fastify.post("/api/devices/:id/ota", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDevice(fastify.db, id)) {
      return reply.code(404).send({ error: "Device not found" });
    }

    const parsed = TriggerOtaRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const build = getFirmwareBuild(fastify.db, parsed.data.firmwareId);
    if (!build) {
      return reply.code(404).send({ error: "Firmware build not found" });
    }
    if (build.deviceId !== id) {
      return reply
        .code(400)
        .send({ error: `This firmware build was uploaded for device "${build.deviceId}", not "${id}"` });
    }

    if (!fastify.appConfig.PUBLIC_URL) {
      return reply
        .code(400)
        .send({ error: "PUBLIC_URL is not configured on the backend — required to trigger OTA, see README" });
    }

    const token = createOtaToken(fastify.db, build.id, Date.now(), OTA_TOKEN_TTL_MS);
    const url = `${fastify.appConfig.PUBLIC_URL}/api/firmware/${build.id}/download?token=${token}`;

    publishOtaUpdate(fastify.mqttClient, id, { version: build.version, url, md5: build.md5 });

    return reply.code(202).send({ ok: true });
  });
}
