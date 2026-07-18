import type Database from "better-sqlite3";

interface FlowReadingRow {
  id: number;
  device_id: string;
  flow_index: number;
  ts: number;
  pulse_count: number;
  recorded_at: number;
}

export function insertFlowReading(
  db: Database.Database,
  deviceId: string,
  flowIndex: number,
  ts: number,
  pulseCount: number,
): void {
  db.prepare(
    `INSERT INTO flow_readings (device_id, flow_index, ts, pulse_count) VALUES (?, ?, ?, ?)`,
  ).run(deviceId, flowIndex, ts, pulseCount);
}

// Ordered by recorded_at, not ts — see readings.repo.ts's doc comment on
// getLatestReadingForSensor for why the device's own ts isn't reliable for
// absolute ordering.
export function getRecentFlowReadings(
  db: Database.Database,
  deviceId: string,
  flowIndex: number,
  limit = 500,
): FlowReadingRow[] {
  return db
    .prepare<[string, number, number], FlowReadingRow>(
      "SELECT * FROM flow_readings WHERE device_id = ? AND flow_index = ? ORDER BY recorded_at DESC, id DESC LIMIT ?",
    )
    .all(deviceId, flowIndex, limit);
}
