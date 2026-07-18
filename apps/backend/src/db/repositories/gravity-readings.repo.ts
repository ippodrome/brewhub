import type Database from "better-sqlite3";

interface GravityReadingRow {
  id: number;
  hydrometer_id: number;
  ts: number;
  specific_gravity: number | null;
  temperature_c: number | null;
  battery_percent: number | null;
  recorded_at: number;
}

export function insertGravityReading(
  db: Database.Database,
  hydrometerId: number,
  ts: number,
  specificGravity: number | null,
  temperatureC: number | null,
  batteryPercent: number | null,
): void {
  db.prepare(
    `INSERT INTO gravity_readings (hydrometer_id, ts, specific_gravity, temperature_c, battery_percent)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(hydrometerId, ts, specificGravity, temperatureC, batteryPercent);
}

export function getRecentGravityReadings(
  db: Database.Database,
  hydrometerId: number,
  limit = 500,
): GravityReadingRow[] {
  return db
    .prepare<[number, number], GravityReadingRow>(
      "SELECT * FROM gravity_readings WHERE hydrometer_id = ? ORDER BY ts DESC LIMIT ?",
    )
    .all(hydrometerId, limit);
}

export function getLatestGravityReading(db: Database.Database, hydrometerId: number): GravityReadingRow | null {
  const row = db
    .prepare<[number], GravityReadingRow>(
      "SELECT * FROM gravity_readings WHERE hydrometer_id = ? ORDER BY ts DESC LIMIT 1",
    )
    .get(hydrometerId);
  return row ?? null;
}
