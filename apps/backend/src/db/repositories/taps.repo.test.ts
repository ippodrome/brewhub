import { describe, expect, it } from "vitest";
import { createDbClient } from "../client.js";
import { runMigrations } from "../migrate.js";
import { insertDevice } from "./devices.repo.js";
import {
  applyFlowReadingUpdate,
  applyWeightReadingUpdate,
  deleteTap,
  findTapChannelConflict,
  getTap,
  getTapByFlowIndex,
  getTapRow,
  insertTap,
  listTapsByWeightChannel,
  listTapsForDevice,
  markLowVolumeNotified,
  resetKeg,
  updateTapDetails,
} from "./taps.repo.js";
import { extendPourEvent, listPourEventsForTap, startPourEvent } from "./pour-events.repo.js";

function setUp() {
  const db = createDbClient(":memory:");
  runMigrations(db);
  insertDevice(db, { id: "kegerator-01", name: "K1", type: "kegerator" });
  insertDevice(db, { id: "keg-scale-01", name: "Scale 1", type: "keg_scale" });
  return db;
}

describe("taps.repo (flow-measured)", () => {
  it("inserts a tap with remainingVolumeMl defaulted to fullVolumeMl", () => {
    const db = setUp();
    const tap = insertTap(db, "kegerator-01", {
      measurementType: "flow",
      flowIndex: 0,
      name: "House IPA",
      pulsesPerLiter: 450,
      fullVolumeMl: 19000,
    });
    expect(tap.remainingVolumeMl).toBe(19000);
    expect(tap.flowIndex).toBe(0);
    expect(tap.measurementType).toBe("flow");
    expect(tap.weightDeviceId).toBeNull();
  });

  it("finds a tap by (deviceId, flowIndex)", () => {
    const db = setUp();
    insertTap(db, "kegerator-01", {
      measurementType: "flow",
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
      measurementType: "flow",
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
      measurementType: "flow",
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
      measurementType: "flow",
      flowIndex: 0,
      name: "House IPA",
      pulsesPerLiter: 450,
      fullVolumeMl: 19000,
    });
    expect(deleteTap(db, tap.id)).toBe(true);
    expect(getTap(db, tap.id)).toBeNull();
    expect(listTapsForDevice(db, "kegerator-01")).toHaveLength(0);
  });

  it("flags a conflict for a flow index already in use, ignoring the excluded tap", () => {
    const db = setUp();
    const tap = insertTap(db, "kegerator-01", {
      measurementType: "flow",
      flowIndex: 0,
      name: "House IPA",
      pulsesPerLiter: 450,
      fullVolumeMl: 19000,
    });
    expect(
      findTapChannelConflict(db, "kegerator-01", { measurementType: "flow", flowIndex: 0 })?.id,
    ).toBe(tap.id);
    expect(
      findTapChannelConflict(db, "kegerator-01", { measurementType: "flow", flowIndex: 0 }, tap.id),
    ).toBeNull();
  });
});

describe("taps.repo (weight-measured)", () => {
  it("inserts a weight-measured tap with null flow fields", () => {
    const db = setUp();
    const tap = insertTap(db, "kegerator-01", {
      measurementType: "weight",
      weightDeviceId: "keg-scale-01",
      weightIndex: 0,
      tareWeightG: 4500,
      fullWeightG: 23500,
      name: "Stout",
      fullVolumeMl: 19000,
    });
    expect(tap.measurementType).toBe("weight");
    expect(tap.flowIndex).toBeNull();
    expect(tap.pulsesPerLiter).toBeNull();
    expect(tap.weightDeviceId).toBe("keg-scale-01");
    expect(tap.remainingVolumeMl).toBe(19000);
  });

  it("finds taps by weight channel", () => {
    const db = setUp();
    const tap = insertTap(db, "kegerator-01", {
      measurementType: "weight",
      weightDeviceId: "keg-scale-01",
      weightIndex: 0,
      tareWeightG: 4500,
      fullWeightG: 23500,
      name: "Stout",
      fullVolumeMl: 19000,
    });
    expect(listTapsByWeightChannel(db, "keg-scale-01", 0).map((t) => t.id)).toEqual([tap.id]);
    expect(listTapsByWeightChannel(db, "keg-scale-01", 1)).toEqual([]);
  });

  it("persists a recomputed remaining volume via applyWeightReadingUpdate", () => {
    const db = setUp();
    const tap = insertTap(db, "kegerator-01", {
      measurementType: "weight",
      weightDeviceId: "keg-scale-01",
      weightIndex: 0,
      tareWeightG: 4500,
      fullWeightG: 23500,
      name: "Stout",
      fullVolumeMl: 19000,
    });
    applyWeightReadingUpdate(db, tap.id, 9500);
    expect(getTap(db, tap.id)!.remainingVolumeMl).toBe(9500);
  });

  it("flags a conflict for a weight channel already in use, ignoring the excluded tap", () => {
    const db = setUp();
    const tap = insertTap(db, "kegerator-01", {
      measurementType: "weight",
      weightDeviceId: "keg-scale-01",
      weightIndex: 0,
      tareWeightG: 4500,
      fullWeightG: 23500,
      name: "Stout",
      fullVolumeMl: 19000,
    });
    expect(
      findTapChannelConflict(db, "kegerator-01", {
        measurementType: "weight",
        weightDeviceId: "keg-scale-01",
        weightIndex: 0,
      })?.id,
    ).toBe(tap.id);
    expect(
      findTapChannelConflict(
        db,
        "kegerator-01",
        { measurementType: "weight", weightDeviceId: "keg-scale-01", weightIndex: 0 },
        tap.id,
      ),
    ).toBeNull();
  });

  it("does not conflict with a flow tap using the same numeric index", () => {
    const db = setUp();
    insertTap(db, "kegerator-01", {
      measurementType: "flow",
      flowIndex: 0,
      name: "House IPA",
      pulsesPerLiter: 450,
      fullVolumeMl: 19000,
    });
    const weightTap = insertTap(db, "kegerator-01", {
      measurementType: "weight",
      weightDeviceId: "keg-scale-01",
      weightIndex: 0,
      tareWeightG: 4500,
      fullWeightG: 23500,
      name: "Stout",
      fullVolumeMl: 19000,
    });
    expect(listTapsForDevice(db, "kegerator-01")).toHaveLength(2);
    expect(weightTap.weightIndex).toBe(0);
  });
});

describe("taps.repo (low-volume notification tracking)", () => {
  it("starts un-notified", () => {
    const db = setUp();
    const tap = insertTap(db, "kegerator-01", {
      measurementType: "flow",
      flowIndex: 0,
      name: "House IPA",
      pulsesPerLiter: 450,
      fullVolumeMl: 19000,
    });
    expect(getTapRow(db, tap.id)!.low_volume_notified).toBe(0);
  });

  it("marks notified", () => {
    const db = setUp();
    const tap = insertTap(db, "kegerator-01", {
      measurementType: "flow",
      flowIndex: 0,
      name: "House IPA",
      pulsesPerLiter: 450,
      fullVolumeMl: 19000,
    });
    markLowVolumeNotified(db, tap.id);
    expect(getTapRow(db, tap.id)!.low_volume_notified).toBe(1);
  });

  it("resetKeg clears the notified flag along with the volume, for the next fill cycle", () => {
    const db = setUp();
    const tap = insertTap(db, "kegerator-01", {
      measurementType: "flow",
      flowIndex: 0,
      name: "House IPA",
      pulsesPerLiter: 450,
      fullVolumeMl: 19000,
    });
    markLowVolumeNotified(db, tap.id);
    resetKeg(db, tap.id);
    const row = getTapRow(db, tap.id)!;
    expect(row.low_volume_notified).toBe(0);
    expect(row.remaining_volume_ml).toBe(19000);
  });
});

describe("pour-events.repo", () => {
  it("starts and extends a pour event, accumulating volume", () => {
    const db = setUp();
    const tap = insertTap(db, "kegerator-01", {
      measurementType: "flow",
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
      measurementType: "flow",
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
