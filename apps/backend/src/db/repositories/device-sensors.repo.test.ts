import { describe, expect, it } from "vitest";
import { createDbClient } from "../client.js";
import { runMigrations } from "../migrate.js";
import { insertDevice } from "./devices.repo.js";
import {
  getSensor,
  listSensorsForDevice,
  recordSensorSeen,
  setControlSensor,
  setSensorLabel,
} from "./device-sensors.repo.js";

function setUp() {
  const db = createDbClient(":memory:");
  runMigrations(db);
  insertDevice(db, { id: "fermenter-01", name: "F1", type: "fermenter" });
  return db;
}

describe("recordSensorSeen", () => {
  it("auto-designates the first-ever sensor for a device as the control sensor", () => {
    const db = setUp();
    const wasNew = recordSensorSeen(db, "fermenter-01", "AAA", 1000);
    expect(wasNew).toBe(true);

    const sensor = getSensor(db, "fermenter-01", "AAA")!;
    expect(sensor.isControlSensor).toBe(true);
    expect(sensor.label).toBeNull();
    expect(sensor.lastSeenAt).toBe(1000);
  });

  it("does not make a second sensor the control sensor by default", () => {
    const db = setUp();
    recordSensorSeen(db, "fermenter-01", "AAA", 1000);
    recordSensorSeen(db, "fermenter-01", "BBB", 1000);

    const sensors = listSensorsForDevice(db, "fermenter-01");
    expect(sensors).toHaveLength(2);
    expect(sensors.find((s) => s.address === "AAA")!.isControlSensor).toBe(true);
    expect(sensors.find((s) => s.address === "BBB")!.isControlSensor).toBe(false);
  });

  it("bumps last_seen_at on a subsequent sighting without creating a duplicate row", () => {
    const db = setUp();
    recordSensorSeen(db, "fermenter-01", "AAA", 1000);
    const wasNewAgain = recordSensorSeen(db, "fermenter-01", "AAA", 2000);

    expect(wasNewAgain).toBe(false);
    expect(listSensorsForDevice(db, "fermenter-01")).toHaveLength(1);
    expect(getSensor(db, "fermenter-01", "AAA")!.lastSeenAt).toBe(2000);
  });
});

describe("setControlSensor", () => {
  it("ensures exactly one control sensor per device", () => {
    const db = setUp();
    recordSensorSeen(db, "fermenter-01", "AAA", 1000); // becomes control by default
    recordSensorSeen(db, "fermenter-01", "BBB", 1000);

    setControlSensor(db, "fermenter-01", "BBB");

    const sensors = listSensorsForDevice(db, "fermenter-01");
    expect(sensors.find((s) => s.address === "AAA")!.isControlSensor).toBe(false);
    expect(sensors.find((s) => s.address === "BBB")!.isControlSensor).toBe(true);
  });
});

describe("setSensorLabel", () => {
  it("labels a sensor", () => {
    const db = setUp();
    recordSensorSeen(db, "fermenter-01", "AAA", 1000);
    setSensorLabel(db, "fermenter-01", "AAA", "Beer");
    expect(getSensor(db, "fermenter-01", "AAA")!.label).toBe("Beer");
  });
});
