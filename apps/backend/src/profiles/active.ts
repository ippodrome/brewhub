import type Database from "better-sqlite3";
import type { MqttClient } from "mqtt";
import type { ActiveProfileProgress, DeviceConfig, Profile } from "@brewhub/shared-types";
import { getActiveProfileState, getDeviceConfig, updateDeviceConfig } from "../db/repositories/device-configs.repo.js";
import { getProfile } from "../db/repositories/profiles.repo.js";
import { getHydrometerForFermenter } from "../db/repositories/hydrometers.repo.js";
import { getLatestGravityReading } from "../db/repositories/gravity-readings.repo.js";
import { publishDeviceConfig } from "../mqtt/publish-config.js";
import { resolveProfileSetpoint } from "./resolve-setpoint.js";
import { resolveProfileSetpointByGravity } from "./resolve-setpoint-by-gravity.js";

function latestGravity(db: Database.Database, deviceId: string): number | null {
  const hydrometer = getHydrometerForFermenter(db, deviceId);
  if (!hydrometer) return null;
  const latest = getLatestGravityReading(db, hydrometer.id);
  return latest?.specific_gravity ?? null;
}

/**
 * The setpoint a profile asks for right now, or null when it can't be
 * resolved yet (a gravity profile with no reading) — same rules as the
 * scheduler tick, so an edit or restart never disagrees with the next tick.
 */
export function resolveSetpointNow(
  db: Database.Database,
  deviceId: string,
  profile: Profile,
  startedAtMs: number,
  nowMs: number,
): number | null {
  if (profile.triggerType === "gravity") {
    const sg = latestGravity(db, deviceId);
    return sg === null ? null : resolveProfileSetpointByGravity(profile.steps, sg);
  }
  return resolveProfileSetpoint(profile.steps, (nowMs - startedAtMs) / 60000);
}

/**
 * Re-resolves the device's active profile and publishes immediately (instead of
 * waiting up to one scheduler interval). Returns the new config, or null when
 * nothing was published.
 */
export function pushActiveProfileSetpoint(
  db: Database.Database,
  mqttClient: MqttClient,
  deviceId: string,
  nowMs: number,
): DeviceConfig | null {
  const state = getActiveProfileState(db, deviceId);
  if (!state) return null;
  const profile = getProfile(db, state.activeProfileId);
  if (!profile) return null;
  const setpointC = resolveSetpointNow(db, deviceId, profile, state.profileStartedAt, nowMs);
  if (setpointC === null) return getDeviceConfig(db, deviceId);
  const config = updateDeviceConfig(db, deviceId, { setpointC });
  publishDeviceConfig(mqttClient, deviceId, config);
  return config;
}

/** Steps in the order they're run: by time ascending, or by gravity descending (OG → FG). */
export function runOrder(profile: Profile): Profile["steps"] {
  if (profile.triggerType === "gravity") {
    return [...profile.steps].sort((a, b) => b.atGravitySg - a.atGravitySg);
  }
  return [...profile.steps].sort((a, b) => a.atMinutes - b.atMinutes);
}

export function computeProgress(db: Database.Database, deviceId: string, nowMs: number): ActiveProfileProgress {
  const state = getActiveProfileState(db, deviceId);
  if (!state) return { active: false };
  const stored = getProfile(db, state.activeProfileId);
  if (!stored) return { active: false };

  const profile = { ...stored, steps: runOrder(stored) } as Profile;
  const elapsedMinutes = Math.max(0, (nowMs - state.profileStartedAt) / 60000);
  const stepCount = profile.steps.length;
  let stepIndex = 0;
  let nextChangeAtMinutes: number | null = null;
  let nextTargetC: number | null = null;
  let currentGravitySg: number | null = null;

  if (profile.triggerType === "time") {
    profile.steps.forEach((s, i) => {
      if (s.atMinutes <= elapsedMinutes) stepIndex = i;
    });
    const next = profile.steps[stepIndex + 1];
    if (next) {
      nextChangeAtMinutes = next.atMinutes;
      nextTargetC = next.targetC;
    }
  } else {
    currentGravitySg = latestGravity(db, deviceId);
    if (currentGravitySg !== null) {
      const sg = currentGravitySg;
      profile.steps.forEach((s, i) => {
        if (sg <= s.atGravitySg) stepIndex = i;
      });
    }
    nextTargetC = profile.steps[stepIndex + 1]?.targetC ?? null;
  }

  const finished =
    profile.triggerType === "time"
      ? elapsedMinutes >= (profile.steps[stepCount - 1]?.atMinutes ?? 0) && stepCount > 0
      : false;

  return {
    active: true,
    profile,
    startedAt: state.profileStartedAt,
    elapsedMinutes,
    stepIndex,
    stepCount,
    currentSetpointC: resolveSetpointNow(db, deviceId, stored, state.profileStartedAt, nowMs),
    nextChangeAtMinutes,
    nextTargetC,
    currentGravitySg,
    finished,
  };
}
