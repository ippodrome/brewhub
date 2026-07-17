import { describe, expect, it } from "vitest";
import { createDbClient } from "../client.js";
import { runMigrations } from "../migrate.js";
import { insertDevice } from "./devices.repo.js";
import {
  applyFlowReadingUpdate,
  deleteTap,
  getTap,
  getTapByFlowIndex,
  insertTap,
  listTapsForDevice,
  resetKeg,
  updateTapDetails,
} from "./taps.repo.js";
import { extendPourEvent, listPourEventsForTap, startPourEvent } from "./pour-events.repo.js";

function setUp() {
  const db = createDbClient(":memory:");
  runMigrations(db);
  insertDevice(db, { id: "kegerator-01", name: "K1", type: "kegerator" });
  return db;
}

describe("taps.repo", () => {
  it("inserts a tap with remainingVolumeMl defaulted to fullVolumeMl", () => {
    const db = setUp();
    const tap = insertTap(db, "kegerator-01", {
      flowIndex: 0,
      name: "House IPA",
      pulsesPerLiter: 450,
      fullVolumeMl: 19000,
    });
    expect(tap.remainingVolumeMl).toBe(19000);
    expect(tap.flowIndex).toBe(0);
  });

  it("finds a tap by (deviceId, flowIndex)", () => {
    const db = setUp();
    insertTap(db, "kegerator-01", {
      flowIndex: 3,
      name: "Stout",
      pulsesPerLiter: 450,
      fullVolumeMl: 19000,
    });
    expect(getTapByFlowIndex(db, "kegerator-01", 3)?.name).toBe("Stout");
    expect(getTapByFlowIndex(db, "kegerator-01", 4)).toBeNull();
  });

  it("updates tap details, keeping unspecified fields", () => {
    const db = setUp();
    const tap = insertTap(db, "kegerator-01", {
      flowIndex: 0,
      name: "House IPA",
      pulsesPerLiter: 450,
      fullVolumeMl: 19000,
    });
    updateTapDetails(db, tap.id, { abv: 6.2 });
    const updated = getTap(db, tap.id)!;
    expect(updated.abv).toBe(6.2);
    expect(updated.name).toBe("House IPA"); // unchanged
  });

  it("resets remaining volume to full on resetKeg", () => {
    const db = setUp();
    const tap = insertTap(db, "kegerator-01", {
      flowIndex: 0,
      name: "House IPA",
      pulsesPerLiter: 450,
      fullVolumeMl: 19000,
    });
    applyFlowReadingUpdate(db, tap.id, {
      remainingVolumeMl: 5000,
      lastPulseCount: 6300,
      pourInProgressId: null,
      lastActivityAt: null,
    });
    expect(getTap(db, tap.id)!.remainingVolumeMl).toBe(5000);

    resetKeg(db, tap.id);
    expect(getTap(db, tap.id)!.remainingVolumeMl).toBe(19000);
  });

  it("deletes a tap", () => {
    const db = setUp();
    const tap = insertTap(db, "kegerator-01", {
      flowIndex: 0,
      name: "House IPA",
      pulsesPerLiter: 450,
      fullVolumeMl: 19000,
    });
    expect(deleteTap(db, tap.id)).toBe(true);
    expect(getTap(db, tap.id)).toBeNull();
    expect(listTapsForDevice(db, "kegerator-01")).toHaveLength(0);
  });
});

describe("pour-events.repo", () => {
  it("starts and extends a pour event, accumulating volume", () => {
    const db = setUp();
    const tap = insertTap(db, "kegerator-01", {
      flowIndex: 0,
      name: "House IPA",
      pulsesPerLiter: 450,
      fullVolumeMl: 19000,
    });

    const pourId = startPourEvent(db, tap.id, 100, 1000);
    extendPourEvent(db, pourId, 50, 2000);
    extendPourEvent(db, pourId, 25, 3000);

    const events = listPourEventsForTap(db, tap.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.volumeMl).toBe(175);
    expect(events[0]!.startedAt).toBe(1000);
    expect(events[0]!.endedAt).toBe(3000);
  });

  it("lists most recent pours first", () => {
    const db = setUp();
    const tap = insertTap(db, "kegerator-01", {
      flowIndex: 0,
      name: "House IPA",
      pulsesPerLiter: 450,
      fullVolumeMl: 19000,
    });
    startPourEvent(db, tap.id, 100, 1000);
    startPourEvent(db, tap.id, 200, 5000);

    const events = listPourEventsForTap(db, tap.id);
    expect(events.map((e) => e.volumeMl)).toEqual([200, 100]);
  });
});
