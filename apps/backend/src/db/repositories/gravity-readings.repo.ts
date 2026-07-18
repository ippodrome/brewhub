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

// Ordered by recorded_at, not ts — this matters more here than anywhere
// else: getLatestGravityReading feeds the gravity-profile scheduler's
// setpoint resolution directly (scheduler.ts), so returning a stale,
// pre-reboot reading because the device's own ts reset on reboot would
// mean silently controlling temperature off old data. See
// readings.repo.ts's doc comment on getLatestReadingForSensor.
export function getRecentGravityReadings(
  db: Database.Database,
  hydrometerId: number,
  limit = 500,
): GravityReadingRow[] {
  return db
    .prepare<[number, number], GravityReadingRow>(
      "SELECT * FROM gravity_readings WHERE hydrometer_id = ? ORDER BY recorded_at DESC, id DESC LIMIT ?",
    )
    .all(hydrometerId, limit);
}

export function getLatestGravityReading(db: Database.Database, hydrometerId: number): GravityReadingRow | null {
  const row = db
    .prepare<[number], GravityReadingRow>(
      "SELECT * FROM gravity_readings WHERE hydrometer_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1",
    )
    .get(hydrometerId);
  return row ?? null;
}
