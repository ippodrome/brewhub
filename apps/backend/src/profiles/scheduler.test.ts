import { describe, expect, it, vi } from "vitest";
import type { MqttClient } from "mqtt";
import type { FastifyBaseLogger } from "fastify";
import { createDbClient } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { insertDevice } from "../db/repositories/devices.repo.js";
import {
  ensureDefaultDeviceConfig,
  getActiveProfileState,
  getDeviceConfig,
  setActiveProfile,
} from "../db/repositories/device-configs.repo.js";
import { deleteProfile, insertProfile } from "../db/repositories/profiles.repo.js";
import { insertHydrometer } from "../db/repositories/hydrometers.repo.js";
import { insertGravityReading } from "../db/repositories/gravity-readings.repo.js";
import { runProfileSchedulerTick } from "./scheduler.js";

function makeFakeMqttClient(): MqttClient {
  return { publish: vi.fn() } as unknown as MqttClient;
}

function makeFakeLogger(): FastifyBaseLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
}

function setUpDevice() {
  const db = createDbClient(":memory:");
  runMigrations(db);
  insertDevice(db, { id: "fermenter-01", name: "F1", type: "fermenter" });
  ensureDefaultDeviceConfig(db, "fermenter-01");
  return db;
}

describe("runProfileSchedulerTick", () => {
  it("resolves and publishes the profile setpoint for an active device", () => {
    const db = setUpDevice();
    const profile = insertProfile(db, "fermenter-01", {
      name: "Test",
      triggerType: "time",
      steps: [
        { atMinutes: 0, targetC: 18 },
        { atMinutes: 100, targetC: 20 },
      ],
    });
    const startedAt = 1_000_000;
    setActiveProfile(db, "fermenter-01", profile.id, startedAt);

    const mqttClient = makeFakeMqttClient();
    const logger = makeFakeLogger();

    // 50 of 100 minutes elapsed => halfway between 18 and 20 => 19.
    runProfileSchedulerTick({ db, mqttClient, logger, now: () => startedAt + 50 * 60000 });

    const config = getDeviceConfig(db, "fermenter-01")!;
    expect(config.setpointC).toBe(19);
    expect(mqttClient.publish).toHaveBeenCalledTimes(1);

    const call = (mqttClient.publish as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe("unibrew/fermenter-01/config");
    expect(JSON.parse(call[1]).setpointC).toBe(19);
    expect(call[2]).toMatchObject({ retain: true });
  });

  it("skips republishing when the resolved change is below the epsilon threshold", () => {
    const db = setUpDevice();
    const profile = insertProfile(db, "fermenter-01", {
      name: "Test",
      triggerType: "time",
      steps: [
        { atMinutes: 0, targetC: 18 },
        { atMinutes: 100, targetC: 20 },
      ],
    });
    const startedAt = 1_000_000;
    setActiveProfile(db, "fermenter-01", profile.id, startedAt);

    const mqttClient = makeFakeMqttClient();
    const logger = makeFakeLogger();

    runProfileSchedulerTick({ db, mqttClient, logger, now: () => startedAt + 50 * 60000 }); // setpoint=19
    // 0.5 more minutes elapsed => +0.01C, well under the 0.05C epsilon.
    runProfileSchedulerTick({ db, mqttClient, logger, now: () => startedAt + 50.5 * 60000 });

    expect(mqttClient.publish).toHaveBeenCalledTimes(1); // second tick was a no-op
  });

  it("clears active_profile_id and does not publish when the profile no longer exists", () => {
    const db = setUpDevice();
    const profile = insertProfile(db, "fermenter-01", {
      name: "Test",
      triggerType: "time",
      steps: [{ atMinutes: 0, targetC: 18 }],
    });
    setActiveProfile(db, "fermenter-01", profile.id, 1_000_000);
    deleteProfile(db, profile.id); // simulate a stale pointer, bypassing the route's defensive clear

    const mqttClient = makeFakeMqttClient();
    const logger = makeFakeLogger();

    runProfileSchedulerTick({ db, mqttClient, logger, now: () => 2_000_000 });

    expect(getActiveProfileState(db, "fermenter-01")).toBeNull();
    expect(mqttClient.publish).not.toHaveBeenCalled();
  });

  it("does nothing when no device has an active profile", () => {
    const db = setUpDevice();
    const mqttClient = makeFakeMqttClient();
    const logger = makeFakeLogger();

    runProfileSchedulerTick({ db, mqttClient, logger, now: () => Date.now() });

    expect(mqttClient.publish).not.toHaveBeenCalled();
  });

  it("resolves and publishes from the latest gravity reading for a gravity-triggered profile", () => {
    const db = setUpDevice();
    const hydrometer = insertHydrometer(db, {
      identifier: "tilt-red",
      type: "tilt",
      fermenterDeviceId: "fermenter-01",
    });
    insertGravityReading(db, hydrometer.id, 1_000_000, 1.02, 20, 100);

    const profile = insertProfile(db, "fermenter-01", {
      name: "Gravity test",
      triggerType: "gravity",
      steps: [
        { atGravitySg: 1.05, targetC: 18 },
        { atGravitySg: 1.0, targetC: 22 },
      ],
    });
    setActiveProfile(db, "fermenter-01", profile.id, 1_000_000);

    const mqttClient = makeFakeMqttClient();
    const logger = makeFakeLogger();

    // 1.02 is 60% of the way from 1.05 down to 1.0 => 18 + 0.6*(22-18) = 20.4
    runProfileSchedulerTick({ db, mqttClient, logger, now: () => 2_000_000 });

    const config = getDeviceConfig(db, "fermenter-01")!;
    expect(config.setpointC).toBeCloseTo(20.4);
    expect(mqttClient.publish).toHaveBeenCalledTimes(1);
  });

  it("skips a gravity-triggered profile when no hydrometer is assigned", () => {
    const db = setUpDevice();
    const profile = insertProfile(db, "fermenter-01", {
      name: "Gravity test",
      triggerType: "gravity",
      steps: [{ atGravitySg: 1.02, targetC: 18 }],
    });
    setActiveProfile(db, "fermenter-01", profile.id, 1_000_000);

    const mqttClient = makeFakeMqttClient();
    const logger = makeFakeLogger();

    runProfileSchedulerTick({ db, mqttClient, logger, now: () => 2_000_000 });

    expect(mqttClient.publish).not.toHaveBeenCalled();
  });

  it("skips a gravity-triggered profile when no gravity reading exists yet", () => {
    const db = setUpDevice();
    insertHydrometer(db, { identifier: "tilt-red", type: "tilt", fermenterDeviceId: "fermenter-01" });

    const profile = insertProfile(db, "fermenter-01", {
      name: "Gravity test",
      triggerType: "gravity",
      steps: [{ atGravitySg: 1.02, targetC: 18 }],
    });
    setActiveProfile(db, "fermenter-01", profile.id, 1_000_000);

    const mqttClient = makeFakeMqttClient();
    const logger = makeFakeLogger();

    runProfileSchedulerTick({ db, mqttClient, logger, now: () => 2_000_000 });

    expect(mqttClient.publish).not.toHaveBeenCalled();
  });
});

describe("runProfileSchedulerTick after an edit", () => {
  it("follows the edited steps from the original start time", async () => {
    const { updateProfile } = await import("../db/repositories/profiles.repo.js");
    const db = setUpDevice();
    const profile = insertProfile(db, "fermenter-01", {
      name: "Test",
      triggerType: "time",
      steps: [
        { atMinutes: 0, targetC: 18 },
        { atMinutes: 100, targetC: 20 },
      ],
    });
    const startedAt = 1_000_000;
    setActiveProfile(db, "fermenter-01", profile.id, startedAt);
    const mqttClient = makeFakeMqttClient();
    const logger = makeFakeLogger();

    runProfileSchedulerTick({ db, mqttClient, logger, now: () => startedAt + 50 * 60000 });
    expect(getDeviceConfig(db, "fermenter-01")!.setpointC).toBe(19);

    // Edit while running: same 50-minute mark now lands halfway to 14.
    updateProfile(db, profile.id, {
      name: "Test",
      triggerType: "time",
      steps: [
        { atMinutes: 0, targetC: 18 },
        { atMinutes: 100, targetC: 14 },
      ],
    });
    runProfileSchedulerTick({ db, mqttClient, logger, now: () => startedAt + 50 * 60000 });

    expect(getDeviceConfig(db, "fermenter-01")!.setpointC).toBe(16);
    expect(getActiveProfileState(db, "fermenter-01")).toEqual({ activeProfileId: profile.id, profileStartedAt: startedAt });
    expect(mqttClient.publish).toHaveBeenCalledTimes(2);
  });
});
