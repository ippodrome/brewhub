import { describe, expect, it } from "vitest";
import { createDbClient } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { insertDevice } from "../db/repositories/devices.repo.js";
import { getTapRow, insertTap } from "../db/repositories/taps.repo.js";
import { checkLowVolumeCrossing } from "./low-volume-event.js";

function setUp() {
  const db = createDbClient(":memory:");
  runMigrations(db);
  insertDevice(db, { id: "kegerator-01", name: "K1", type: "kegerator" });
  const tap = insertTap(db, "kegerator-01", {
    measurementType: "flow",
    flowIndex: 0,
    name: "House IPA",
    pulsesPerLiter: 500,
    fullVolumeMl: 19000,
  });
  return { db, tapRow: getTapRow(db, tap.id)! };
}

describe("checkLowVolumeCrossing", () => {
  it("returns null while still above the threshold", () => {
    const { db, tapRow } = setUp();
    // 19000 * 0.20 = 3800mL = 20%, above the 15% threshold.
    expect(checkLowVolumeCrossing(db, tapRow, 3800)).toBeNull();
  });

  it("returns an event and marks notified on first crossing below the threshold", () => {
    const { db, tapRow } = setUp();
    // 19000 * 0.10 = 1900mL = 10%, below the 15% threshold.
    const event = checkLowVolumeCrossing(db, tapRow, 1900);
    expect(event).toEqual({ tapId: tapRow.id, tapName: "House IPA", deviceId: "kegerator-01" });
    expect(getTapRow(db, tapRow.id)!.low_volume_notified).toBe(1);
  });

  it("does not re-notify on a subsequent reading still below the threshold", () => {
    const { db, tapRow } = setUp();
    checkLowVolumeCrossing(db, tapRow, 1900);
    const notifiedRow = getTapRow(db, tapRow.id)!;
    expect(checkLowVolumeCrossing(db, notifiedRow, 1000)).toBeNull();
  });

  it("treats a zero fullVolumeMl defensively as never notify-worthy (avoids a divide-by-zero)", () => {
    const { db, tapRow } = setUp();
    expect(checkLowVolumeCrossing(db, { ...tapRow, full_volume_ml: 0 }, 0)).toBeNull();
  });
});
