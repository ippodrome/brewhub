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
});
