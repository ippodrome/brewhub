import type Database from "better-sqlite3";
import type { MqttClient } from "mqtt";
import type { FastifyBaseLogger } from "fastify";
import {
  clearActiveProfile,
  getDeviceConfig,
  listDevicesWithActiveProfile,
  updateDeviceConfig,
} from "../db/repositories/device-configs.repo.js";
import { getProfile } from "../db/repositories/profiles.repo.js";
import { getHydrometerForFermenter } from "../db/repositories/hydrometers.repo.js";
import { getLatestGravityReading } from "../db/repositories/gravity-readings.repo.js";
import { publishDeviceConfig } from "../mqtt/publish-config.js";
import { resolveProfileSetpoint } from "./resolve-setpoint.js";
import { resolveProfileSetpointByGravity } from "./resolve-setpoint-by-gravity.js";

export interface ProfileSchedulerOptions {
  db: Database.Database;
  mqttClient: MqttClient;
  logger: FastifyBaseLogger;
  intervalMs: number;
  now?: () => number; // injectable for tests
}

// Below this, republishing a retained MQTT message would just be churn for
// an interpolation step too small to matter physically.
const SETPOINT_CHANGE_EPSILON_C = 0.05;

export function runProfileSchedulerTick(options: Omit<ProfileSchedulerOptions, "intervalMs">): void {
  const nowMs = (options.now ?? Date.now)();
  const active = listDevicesWithActiveProfile(options.db);

  for (const { deviceId, activeProfileId, profileStartedAt } of active) {
    const profile = getProfile(options.db, activeProfileId);
    if (!profile) {
      // Data inconsistency (e.g. profile removed without going through the
      // DELETE route) — don't keep trying to follow a profile that's gone.
      options.logger.warn(
        { deviceId, activeProfileId },
        "Active profile no longer exists, clearing",
      );
      clearActiveProfile(options.db, deviceId);
      continue;
    }

    let resolvedSetpointC: number;
    if (profile.triggerType === "gravity") {
      const hydrometer = getHydrometerForFermenter(options.db, deviceId);
      if (!hydrometer) {
        options.logger.warn({ deviceId, profileId: activeProfileId }, "Gravity profile active but no hydrometer assigned, skipping");
        continue;
      }
      const latest = getLatestGravityReading(options.db, hydrometer.id);
      if (!latest || latest.specific_gravity === null) {
        options.logger.warn({ deviceId, profileId: activeProfileId }, "Gravity profile active but no gravity reading yet, skipping");
        continue;
      }
      resolvedSetpointC = resolveProfileSetpointByGravity(profile.steps, latest.specific_gravity);
    } else {
      const elapsedMinutes = (nowMs - profileStartedAt) / 60000;
      resolvedSetpointC = resolveProfileSetpoint(profile.steps, elapsedMinutes);
    }

    const current = getDeviceConfig(options.db, deviceId);
    if (current && Math.abs(current.setpointC - resolvedSetpointC) < SETPOINT_CHANGE_EPSILON_C) {
      continue;
    }

    const config = updateDeviceConfig(options.db, deviceId, { setpointC: resolvedSetpointC });
    publishDeviceConfig(options.mqttClient, deviceId, config);
    options.logger.info(
      { deviceId, profileId: activeProfileId, setpointC: resolvedSetpointC },
      "Profile-resolved setpoint pushed",
    );
  }
}

export function startProfileScheduler(options: ProfileSchedulerOptions): NodeJS.Timeout {
  return setInterval(() => runProfileSchedulerTick(options), options.intervalMs);
}
