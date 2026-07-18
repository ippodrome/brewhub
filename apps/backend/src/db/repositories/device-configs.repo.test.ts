import { describe, expect, it } from "vitest";
import { createDbClient } from "../client.js";
import { runMigrations } from "../migrate.js";
import { insertDevice } from "./devices.repo.js";
import { getDeviceConfig, updateDeviceConfig } from "./device-configs.repo.js";

describe("loadCellCalibrationFactor", () => {
  it("defaults to null for a device that has never had one set", () => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    insertDevice(db, { id: "keg-scale-01", type: "keg_scale", name: "Keg Scale 1" });

    const config = updateDeviceConfig(db, "keg-scale-01", { setpointC: 20 });
    expect(config.loadCellCalibrationFactor).toBeNull();
  });

  it("round-trips a real value through update and get", () => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    insertDevice(db, { id: "keg-scale-01", type: "keg_scale", name: "Keg Scale 1" });

    updateDeviceConfig(db, "keg-scale-01", { loadCellCalibrationFactor: -22150.5 });
    const config = getDeviceConfig(db, "keg-scale-01");

    expect(config?.loadCellCalibrationFactor).toBe(-22150.5);
  });

  it("is preserved by an unrelated partial update (e.g. a tare request)", () => {
    const db = createDbClient(":memory:");
    runMigrations(db);
    insertDevice(db, { id: "keg-scale-01", type: "keg_scale", name: "Keg Scale 1" });

    updateDeviceConfig(db, "keg-scale-01", { loadCellCalibrationFactor: -22150.5 });
    const config = updateDeviceConfig(db, "keg-scale-01", { tareRequestId: 12345 });

    expect(config.loadCellCalibrationFactor).toBe(-22150.5);
    expect(config.tareRequestId).toBe(12345);
  });
});
