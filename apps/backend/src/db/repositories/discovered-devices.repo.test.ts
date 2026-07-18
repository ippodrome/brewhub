import { describe, expect, it } from "vitest";
import { createDbClient } from "../client.js";
import { runMigrations } from "../migrate.js";
import { insertDevice } from "./devices.repo.js";
import { listUnregisteredDiscoveredDevices, upsertDiscoveredDevice } from "./discovered-devices.repo.js";

function setUp() {
  const db = createDbClient(":memory:");
  runMigrations(db);
  return db;
}

describe("discovered-devices.repo", () => {
  it("records a new announcement", () => {
    const db = setUp();
    upsertDiscoveredDevice(db, { deviceId: "fermenter-02", board: "fermenter-brewpi", firmwareVersion: "0.1.0" });
    const list = listUnregisteredDiscoveredDevices(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ deviceId: "fermenter-02", board: "fermenter-brewpi", firmwareVersion: "0.1.0" });
  });

  it("re-announcing updates firmwareVersion/lastSeenAt but keeps firstSeenAt", () => {
    const db = setUp();
    upsertDiscoveredDevice(db, { deviceId: "fermenter-02", board: "fermenter-brewpi", firmwareVersion: "0.1.0" });
    const first = listUnregisteredDiscoveredDevices(db)[0]!;

    upsertDiscoveredDevice(db, { deviceId: "fermenter-02", board: "fermenter-brewpi", firmwareVersion: "0.2.0" });
    const second = listUnregisteredDiscoveredDevices(db)[0]!;

    expect(second.firmwareVersion).toBe("0.2.0");
    expect(second.firstSeenAt).toBe(first.firstSeenAt);
  });

  it("excludes devices that are already registered", () => {
    const db = setUp();
    upsertDiscoveredDevice(db, { deviceId: "fermenter-02", board: "fermenter-brewpi", firmwareVersion: "0.1.0" });
    insertDevice(db, { id: "fermenter-02", name: "Fermenter 2", type: "fermenter" });

    expect(listUnregisteredDiscoveredDevices(db)).toHaveLength(0);
  });
});
