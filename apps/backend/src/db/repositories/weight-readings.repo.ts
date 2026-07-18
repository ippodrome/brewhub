import type Database from "better-sqlite3";

interface WeightReadingRow {
  id: number;
  device_id: string;
  weight_index: number;
  ts: number;
  grams: number | null;
  recorded_at: number;
}

export function insertWeightReading(
  db: Database.Database,
  deviceId: string,
  weightIndex: number,
  ts: number,
  grams: number | null,
): void {
  db.prepare(
    `INSERT INTO weight_readings (device_id, weight_index, ts, grams) VALUES (?, ?, ?, ?)`,
  ).run(deviceId, weightIndex, ts, grams);
}

// Ordered by recorded_at, not ts — see readings.repo.ts's doc comment on
// getLatestReadingForSensor for why the device's own ts isn't reliable for
// absolute ordering.
export function getRecentWeightReadings(
  db: Database.Database,
  deviceId: string,
  weightIndex: number,
  limit = 500,
): WeightReadingRow[] {
  return db
    .prepare<[string, number, number], WeightReadingRow>(
      "SELECT * FROM weight_readings WHERE device_id = ? AND weight_index = ? ORDER BY recorded_at DESC, id DESC LIMIT ?",
    )
    .all(deviceId, weightIndex, limit);
}
