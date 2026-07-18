import { describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { createDbClient } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { insertDevice } from "../db/repositories/devices.repo.js";
import { insertHydrometer } from "../db/repositories/hydrometers.repo.js";
import { runTelemetryRollup } from "./rollup.js";

const HOUR = 3600;
const DAY = 24 * HOUR;

function makeFakeLogger(): FastifyBaseLogger {
  return { info: vi.fn() } as unknown as FastifyBaseLogger;
}

function setUpDb() {
  const db = createDbClient(":memory:");
  runMigrations(db);
  insertDevice(db, { id: "fermenter-01", name: "F1", type: "fermenter" });
  insertDevice(db, { id: "kegerator-01", name: "K1", type: "kegerator" });
  return db;
}

function insertRawReading(db: ReturnType<typeof setUpDb>, sensorAddress: string, recordedAt: number, temp: number) {
  db.prepare(
    `INSERT INTO readings (device_id, sensor_address, ts, temperature_c, recorded_at) VALUES (?, ?, ?, ?, ?)`,
  ).run("fermenter-01", sensorAddress, recordedAt * 1000, temp, recordedAt);
}

describe("runTelemetryRollup", () => {
  it("collapses same-hour readings older than the retention window into one averaged row", () => {
    const db = setUpDb();
    const nowSeconds = 1_700_000_000;
    const oldBucketStart = nowSeconds - 40 * DAY; // well past the 30-day default cutoff
    const bucketStart = Math.floor(oldBucketStart / HOUR) * HOUR;

    insertRawReading(db, "sensor-1", bucketStart + 10, 18.0);
    insertRawReading(db, "sensor-1", bucketStart + 1000, 19.0);
    insertRawReading(db, "sensor-1", bucketStart + 2000, 20.0);

    const results = runTelemetryRollup({ db, logger: makeFakeLogger(), now: () => nowSeconds * 1000 });

    const rows = db.prepare("SELECT * FROM readings WHERE sensor_address = 'sensor-1'").all() as Array<{
      temperature_c: number;
      recorded_at: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.temperature_c).toBeCloseTo(19.0); // avg of 18, 19, 20
    expect(rows[0]!.recorded_at).toBe(bucketStart);

    const readingsResult = results.find((r) => r.table === "readings")!;
    expect(readingsResult.bucketsCollapsed).toBe(1);
    expect(readingsResult.rowsDeleted).toBe(3);
  });

  it("does not touch readings within the retention window", () => {
    const db = setUpDb();
    const nowSeconds = 1_700_000_000;
    const recentBucketStart = nowSeconds - 5 * DAY; // well within the 30-day default

    insertRawReading(db, "sensor-1", recentBucketStart + 10, 18.0);
    insertRawReading(db, "sensor-1", recentBucketStart + 1000, 19.0);

    runTelemetryRollup({ db, logger: makeFakeLogger(), now: () => nowSeconds * 1000 });

    const rows = db.prepare("SELECT * FROM readings WHERE sensor_address = 'sensor-1'").all();
    expect(rows).toHaveLength(2); // untouched
  });

  it("keeps separate hour buckets separate, not merged", () => {
    const db = setUpDb();
    const nowSeconds = 1_700_000_000;
    const oldTime = nowSeconds - 40 * DAY;
    const bucketA = Math.floor(oldTime / HOUR) * HOUR;
    const bucketB = bucketA + HOUR;

    insertRawReading(db, "sensor-1", bucketA + 10, 10.0);
    insertRawReading(db, "sensor-1", bucketA + 20, 12.0);
    insertRawReading(db, "sensor-1", bucketB + 10, 30.0);
    insertRawReading(db, "sensor-1", bucketB + 20, 32.0);

    runTelemetryRollup({ db, logger: makeFakeLogger(), now: () => nowSeconds * 1000 });

    const rows = db
      .prepare("SELECT temperature_c, recorded_at FROM readings WHERE sensor_address = 'sensor-1' ORDER BY recorded_at")
      .all() as Array<{ temperature_c: number; recorded_at: number }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ temperature_c: 11.0, recorded_at: bucketA });
    expect(rows[1]).toMatchObject({ temperature_c: 31.0, recorded_at: bucketB });
  });

  it("is idempotent — running twice does not change an already-collapsed bucket further", () => {
    const db = setUpDb();
    const nowSeconds = 1_700_000_000;
    const bucketStart = Math.floor((nowSeconds - 40 * DAY) / HOUR) * HOUR;

    insertRawReading(db, "sensor-1", bucketStart + 10, 18.0);
    insertRawReading(db, "sensor-1", bucketStart + 20, 22.0);

    runTelemetryRollup({ db, logger: makeFakeLogger(), now: () => nowSeconds * 1000 });
    const secondRun = runTelemetryRollup({ db, logger: makeFakeLogger(), now: () => nowSeconds * 1000 });

    const rows = db.prepare("SELECT * FROM readings WHERE sensor_address = 'sensor-1'").all() as Array<{
      temperature_c: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.temperature_c).toBeCloseTo(20.0);
    expect(secondRun.find((r) => r.table === "readings")!.bucketsCollapsed).toBe(0); // nothing left to collapse
  });

  it("uses MAX (not AVG) for cumulative flow pulse counts", () => {
    const db = setUpDb();
    const nowSeconds = 1_700_000_000;
    const bucketStart = Math.floor((nowSeconds - 40 * DAY) / HOUR) * HOUR;

    db.prepare(`INSERT INTO flow_readings (device_id, flow_index, ts, pulse_count, recorded_at) VALUES (?, ?, ?, ?, ?)`).run(
      "kegerator-01",
      0,
      (bucketStart + 10) * 1000,
      100,
      bucketStart + 10,
    );
    db.prepare(`INSERT INTO flow_readings (device_id, flow_index, ts, pulse_count, recorded_at) VALUES (?, ?, ?, ?, ?)`).run(
      "kegerator-01",
      0,
      (bucketStart + 20) * 1000,
      150,
      bucketStart + 20,
    );

    runTelemetryRollup({ db, logger: makeFakeLogger(), now: () => nowSeconds * 1000 });

    const rows = db.prepare("SELECT pulse_count FROM flow_readings").all() as Array<{ pulse_count: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.pulse_count).toBe(150); // the higher (== chronologically last) value, not an average
  });

  it("ignores NULL (sensor fault) rows when averaging weight, same as SQL AVG semantics", () => {
    const db = setUpDb();
    const nowSeconds = 1_700_000_000;
    const bucketStart = Math.floor((nowSeconds - 40 * DAY) / HOUR) * HOUR;

    db.prepare(`INSERT INTO weight_readings (device_id, weight_index, ts, grams, recorded_at) VALUES (?, ?, ?, ?, ?)`).run(
      "kegerator-01",
      0,
      (bucketStart + 10) * 1000,
      5000,
      bucketStart + 10,
    );
    db.prepare(`INSERT INTO weight_readings (device_id, weight_index, ts, grams, recorded_at) VALUES (?, ?, ?, ?, ?)`).run(
      "kegerator-01",
      0,
      (bucketStart + 20) * 1000,
      null,
      bucketStart + 20,
    );

    runTelemetryRollup({ db, logger: makeFakeLogger(), now: () => nowSeconds * 1000 });

    const rows = db.prepare("SELECT grams FROM weight_readings").all() as Array<{ grams: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.grams).toBe(5000); // the NULL row is excluded, not averaged in as 0
  });

  it("collapses gravity_readings' three value columns together, grouped by hydrometer", () => {
    const db = setUpDb();
    const hydrometer = insertHydrometer(db, { identifier: "tilt-red", type: "tilt", fermenterDeviceId: "fermenter-01" });
    const nowSeconds = 1_700_000_000;
    const bucketStart = Math.floor((nowSeconds - 40 * DAY) / HOUR) * HOUR;

    db.prepare(
      `INSERT INTO gravity_readings (hydrometer_id, ts, specific_gravity, temperature_c, battery_percent, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(hydrometer.id, (bucketStart + 10) * 1000, 1.05, 18, 90, bucketStart + 10);
    db.prepare(
      `INSERT INTO gravity_readings (hydrometer_id, ts, specific_gravity, temperature_c, battery_percent, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(hydrometer.id, (bucketStart + 20) * 1000, 1.03, 20, 88, bucketStart + 20);

    runTelemetryRollup({ db, logger: makeFakeLogger(), now: () => nowSeconds * 1000 });

    const rows = db.prepare("SELECT * FROM gravity_readings").all() as Array<{
      specific_gravity: number;
      temperature_c: number;
      battery_percent: number;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.specific_gravity).toBeCloseTo(1.04);
    expect(rows[0]!.temperature_c).toBeCloseTo(19);
    expect(rows[0]!.battery_percent).toBeCloseTo(89);
  });
});
