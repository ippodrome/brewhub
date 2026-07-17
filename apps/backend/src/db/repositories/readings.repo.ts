import type Database from "better-sqlite3";
import type { TelemetryPayload } from "@brewhub/shared-types";

interface ReadingRow {
  id: number;
  device_id: string;
  sensor_address: string;
  ts: number;
  temperature_c: number | null;
  recorded_at: number;
}

/** One row per sensor in the payload, all in a single transaction. */
export function insertReading(db: Database.Database, payload: TelemetryPayload): void {
  const insert = db.prepare(
    `INSERT INTO readings (device_id, sensor_address, ts, temperature_c)
     VALUES (@deviceId, @sensorAddress, @ts, @temperatureC)`,
  );

  const insertAll = db.transaction((sensors: TelemetryPayload["sensors"]) => {
    for (const sensor of sensors) {
      insert.run({
        deviceId: payload.deviceId,
        sensorAddress: sensor.address,
        ts: payload.ts,
        temperatureC: sensor.temperatureC,
      });
    }
  });

  insertAll(payload.sensors);
}

export function getLatestReadingForSensor(
  db: Database.Database,
  deviceId: string,
  sensorAddress: string,
): ReadingRow | null {
  return (
    db
      .prepare<[string, string], ReadingRow>(
        "SELECT * FROM readings WHERE device_id = ? AND sensor_address = ? ORDER BY ts DESC LIMIT 1",
      )
      .get(deviceId, sensorAddress) ?? null
  );
}

export function getRecentReadingsForSensor(
  db: Database.Database,
  deviceId: string,
  sensorAddress: string,
  limit = 500,
): ReadingRow[] {
  return db
    .prepare<[string, string, number], ReadingRow>(
      "SELECT * FROM readings WHERE device_id = ? AND sensor_address = ? ORDER BY ts DESC LIMIT ?",
    )
    .all(deviceId, sensorAddress, limit);
}
