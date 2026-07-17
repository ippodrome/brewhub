import type Database from "better-sqlite3";
import type { TelemetryPayload } from "@brewhub/shared-types";

interface ReadingRow {
  id: number;
  device_id: string;
  ts: number;
  temperature_c: number | null;
  recorded_at: number;
}

export function insertReading(db: Database.Database, payload: TelemetryPayload): void {
  db.prepare(
    `INSERT INTO readings (device_id, ts, temperature_c) VALUES (@deviceId, @ts, @temperatureC)`,
  ).run({
    deviceId: payload.deviceId,
    ts: payload.ts,
    temperatureC: payload.temperatureC,
  });
}

export function getLatestReading(db: Database.Database, deviceId: string): ReadingRow | null {
  return (
    db
      .prepare<[string], ReadingRow>(
        "SELECT * FROM readings WHERE device_id = ? ORDER BY ts DESC LIMIT 1",
      )
      .get(deviceId) ?? null
  );
}

export function getRecentReadings(
  db: Database.Database,
  deviceId: string,
  limit = 500,
): ReadingRow[] {
  return db
    .prepare<[string, number], ReadingRow>(
      "SELECT * FROM readings WHERE device_id = ? ORDER BY ts DESC LIMIT ?",
    )
    .all(deviceId, limit);
}
