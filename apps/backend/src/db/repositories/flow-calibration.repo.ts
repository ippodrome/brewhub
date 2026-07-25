import type Database from "better-sqlite3";

export interface FlowCalibrationSessionRow {
  tap_id: number;
  start_pulse_count: number;
  start_remaining_volume_ml: number;
  started_at: number;
}

/**
 * Starts (or restarts) a calibration for a tap. Upsert rather than insert:
 * abandoning a half-finished calibration and starting over is a normal thing
 * to do, and should not require cancelling first.
 */
export function startCalibrationSession(
  db: Database.Database,
  tapId: number,
  startPulseCount: number,
  startRemainingVolumeMl: number,
  startedAt: number,
): FlowCalibrationSessionRow {
  db.prepare(
    `INSERT INTO flow_calibration_sessions
       (tap_id, start_pulse_count, start_remaining_volume_ml, started_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tap_id) DO UPDATE SET
       start_pulse_count = excluded.start_pulse_count,
       start_remaining_volume_ml = excluded.start_remaining_volume_ml,
       started_at = excluded.started_at`,
  ).run(tapId, startPulseCount, startRemainingVolumeMl, startedAt);

  return {
    tap_id: tapId,
    start_pulse_count: startPulseCount,
    start_remaining_volume_ml: startRemainingVolumeMl,
    started_at: startedAt,
  };
}

export function getCalibrationSession(
  db: Database.Database,
  tapId: number,
): FlowCalibrationSessionRow | null {
  return (
    db
      .prepare<[number], FlowCalibrationSessionRow>(
        "SELECT * FROM flow_calibration_sessions WHERE tap_id = ?",
      )
      .get(tapId) ?? null
  );
}

export function deleteCalibrationSession(db: Database.Database, tapId: number): void {
  db.prepare("DELETE FROM flow_calibration_sessions WHERE tap_id = ?").run(tapId);
}
