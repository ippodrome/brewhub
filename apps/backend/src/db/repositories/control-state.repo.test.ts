import { describe, expect, it } from "vitest";
import { createDbClient } from "../client.js";
import { runMigrations } from "../migrate.js";
import { insertDevice } from "./devices.repo.js";
import {
  deleteDecisionsOlderThan,
  getControlState,
  insertDecision,
  listDecisions,
  upsertControlState,
} from "./control-state.repo.js";

function setUp() {
  const db = createDbClient(":memory:");
  runMigrations(db);
  insertDevice(db, { id: "fermenter-01", name: "Chamber", type: "fermenter" });
  return db;
}

const STATE = {
  deviceId: "fermenter-01",
  output: "cooling" as const,
  sinceMs: 134000,
  setpointC: 19,
  mode: "thermostat" as const,
  controlTempC: 19.42,
  overflowed: false,
};

const DECISION = {
  deviceId: "fermenter-01",
  kind: "transition" as const,
  from: "idle" as const,
  to: "cooling" as const,
  reason: "above_deadband" as const,
  temperatureC: 19.42,
  thresholdC: 19.2,
  elapsedMs: 372000,
  remainingMs: 0,
};

describe("control state", () => {
  it("returns null before anything has been reported", () => {
    expect(getControlState(setUp(), "fermenter-01")).toBeNull();
  });

  it("stores and reads back the current state", () => {
    const db = setUp();
    upsertControlState(db, STATE, 1_700_000_000_000);
    expect(getControlState(db, "fermenter-01")).toMatchObject({
      output: "cooling",
      setpointC: 19,
      controlTempC: 19.42,
      sinceMs: 134000,
    });
  });

  // The device reports every 30 s. Keeping one row per device is the point —
  // history is the decision log's job, not this table's.
  it("replaces the previous state rather than accumulating rows", () => {
    const db = setUp();
    upsertControlState(db, STATE, 1_700_000_000_000);
    upsertControlState(db, { ...STATE, output: "idle" }, 1_700_000_030_000);

    expect(getControlState(db, "fermenter-01")?.output).toBe("idle");
    expect(db.prepare("select count(*) as n from device_control_state").get()).toEqual({ n: 1 });
  });

  // A faulted probe still reports state; "I do not know the temperature" has
  // to survive the round trip as null rather than becoming 0.
  it("keeps a null control temperature null", () => {
    const db = setUp();
    upsertControlState(db, { ...STATE, controlTempC: null }, 1_700_000_000_000);
    expect(getControlState(db, "fermenter-01")?.controlTempC).toBeNull();
  });

  it("keeps devices' states apart", () => {
    const db = setUp();
    insertDevice(db, { id: "kegerator-01", name: "Keg", type: "kegerator" });
    upsertControlState(db, STATE, 1_700_000_000_000);
    expect(getControlState(db, "kegerator-01")).toBeNull();
  });

  it("round-trips overflowed true", () => {
    const db = setUp();
    upsertControlState(db, { ...STATE, overflowed: true }, 1_700_000_000_000);
    expect(getControlState(db, "fermenter-01")?.overflowed).toBe(true);
  });

  it("round-trips overflowed false (default fixture)", () => {
    const db = setUp();
    upsertControlState(db, STATE, 1_700_000_000_000);
    expect(getControlState(db, "fermenter-01")?.overflowed).toBe(false);
  });
});

describe("decisions", () => {
  it("appends rather than replacing", () => {
    const db = setUp();
    insertDecision(db, DECISION, 1_700_000_000_000);
    insertDecision(db, { ...DECISION, to: "idle", reason: "below_deadband" }, 1_700_000_060_000);
    expect(listDecisions(db, "fermenter-01", 10)).toHaveLength(2);
  });

  it("returns newest first", () => {
    const db = setUp();
    insertDecision(db, DECISION, 1_700_000_000_000);
    insertDecision(db, { ...DECISION, reason: "below_deadband" }, 1_700_000_060_000);
    expect(listDecisions(db, "fermenter-01", 10)[0]?.reason).toBe("below_deadband");
  });

  it("round-trips a blocked decision with its remaining time", () => {
    const db = setUp();
    insertDecision(
      db,
      { ...DECISION, kind: "blocked", reason: "min_off_not_met", remainingMs: 221000 },
      1_700_000_000_000,
    );
    expect(listDecisions(db, "fermenter-01", 10)[0]).toMatchObject({
      kind: "blocked",
      reason: "min_off_not_met",
      remainingMs: 221000,
      from: "idle",
      to: "cooling",
    });
  });

  it("honours the limit", () => {
    const db = setUp();
    for (let i = 0; i < 5; i++) insertDecision(db, DECISION, 1_700_000_000_000 + i * 1000);
    expect(listDecisions(db, "fermenter-01", 2)).toHaveLength(2);
  });

  it("does not leak another device's decisions", () => {
    const db = setUp();
    insertDevice(db, { id: "kegerator-01", name: "Keg", type: "kegerator" });
    insertDecision(db, DECISION, 1_700_000_000_000);
    expect(listDecisions(db, "kegerator-01", 10)).toHaveLength(0);
  });

  it("deletes only decisions older than the cutoff", () => {
    const db = setUp();
    insertDecision(db, DECISION, 1_000);
    insertDecision(db, DECISION, 9_000);
    deleteDecisionsOlderThan(db, 5_000);
    expect(listDecisions(db, "fermenter-01", 10)).toHaveLength(1);
  });

  // Removing a device should not leave its decisions orphaned in the table.
  it("goes away with the device", () => {
    const db = setUp();
    insertDecision(db, DECISION, 1_700_000_000_000);
    db.prepare("delete from devices where id = ?").run("fermenter-01");
    expect(listDecisions(db, "fermenter-01", 10)).toHaveLength(0);
  });
});
