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

describe("relay polarity", () => {
  function setUpFermenter() {
    const db = createDbClient(":memory:");
    runMigrations(db);
    insertDevice(db, { id: "fermenter-01", type: "fermenter", name: "Chamber" });
    return db;
  }

  it("defaults to null, meaning the firmware keeps its compiled-in board default", () => {
    const db = setUpFermenter();
    updateDeviceConfig(db, "fermenter-01", { setpointC: 18 });

    const config = getDeviceConfig(db, "fermenter-01");
    expect(config?.coolingRelayActiveLow).toBeNull();
    expect(config?.heatingRelayActiveLow).toBeNull();
  });

  // SQLite has no boolean type, so false must survive the round trip through
  // INTEGER 0 without collapsing into null — the bug this test exists to catch.
  it("round-trips false without turning it into null", () => {
    const db = setUpFermenter();
    updateDeviceConfig(db, "fermenter-01", { coolingRelayActiveLow: false });

    expect(getDeviceConfig(db, "fermenter-01")?.coolingRelayActiveLow).toBe(false);
  });

  it("round-trips true", () => {
    const db = setUpFermenter();
    updateDeviceConfig(db, "fermenter-01", { coolingRelayActiveLow: true });

    expect(getDeviceConfig(db, "fermenter-01")?.coolingRelayActiveLow).toBe(true);
  });

  it("tracks the two outputs independently", () => {
    const db = setUpFermenter();
    updateDeviceConfig(db, "fermenter-01", {
      coolingRelayActiveLow: true,
      heatingRelayActiveLow: false,
    });

    const config = getDeviceConfig(db, "fermenter-01");
    expect(config?.coolingRelayActiveLow).toBe(true);
    expect(config?.heatingRelayActiveLow).toBe(false);
  });

  it("can be reset back to the board default", () => {
    const db = setUpFermenter();
    updateDeviceConfig(db, "fermenter-01", { coolingRelayActiveLow: false });
    updateDeviceConfig(db, "fermenter-01", { coolingRelayActiveLow: null });

    expect(getDeviceConfig(db, "fermenter-01")?.coolingRelayActiveLow).toBeNull();
  });

  it("survives an unrelated partial update", () => {
    const db = setUpFermenter();
    updateDeviceConfig(db, "fermenter-01", { coolingRelayActiveLow: false });
    const config = updateDeviceConfig(db, "fermenter-01", { setpointC: 12 });

    expect(config.coolingRelayActiveLow).toBe(false);
    expect(config.setpointC).toBe(12);
  });
});
