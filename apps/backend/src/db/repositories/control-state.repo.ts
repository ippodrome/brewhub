import type Database from "better-sqlite3";
import type { ControlDecisionPayload, ControlStatePayload } from "@brewhub/shared-types";

/**
 * What a device's control loop is doing, and the log of how it got there.
 *
 * `receivedAt` is passed in rather than read from the clock in here: the
 * device sends durations, not timestamps (it has no reliable wall clock), so
 * the arrival time is the only absolute reference there is — and taking it
 * from the caller keeps these functions testable against pinned times.
 */

export interface StoredControlState {
  deviceId: string;
  output: string;
  sinceMs: number;
  setpointC: number;
  mode: string;
  controlTempC: number | null;
  receivedAt: number;
}

export interface StoredDecision {
  id: number;
  deviceId: string;
  kind: string;
  from: string;
  to: string;
  reason: string;
  temperatureC: number;
  thresholdC: number;
  elapsedMs: number;
  remainingMs: number;
  receivedAt: number;
}

interface StateRow {
  device_id: string;
  output: string;
  since_ms: number;
  setpoint_c: number;
  mode: string;
  control_temp_c: number | null;
  received_at: number;
}

interface DecisionRow {
  id: number;
  device_id: string;
  kind: string;
  from_output: string;
  to_output: string;
  reason: string;
  temperature_c: number;
  threshold_c: number;
  elapsed_ms: number;
  remaining_ms: number;
  received_at: number;
}

export function upsertControlState(
  db: Database.Database,
  payload: ControlStatePayload,
  receivedAt: number,
): void {
  db.prepare(
    `INSERT INTO device_control_state
       (device_id, output, since_ms, setpoint_c, mode, control_temp_c, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET
       output = excluded.output,
       since_ms = excluded.since_ms,
       setpoint_c = excluded.setpoint_c,
       mode = excluded.mode,
       control_temp_c = excluded.control_temp_c,
       received_at = excluded.received_at`,
  ).run(
    payload.deviceId,
    payload.output,
    payload.sinceMs,
    payload.setpointC,
    payload.mode,
    payload.controlTempC,
    receivedAt,
  );
}

export function getControlState(db: Database.Database, deviceId: string): StoredControlState | null {
  const row = db
    .prepare<[string], StateRow>("SELECT * FROM device_control_state WHERE device_id = ?")
    .get(deviceId);
  if (!row) return null;

  return {
    deviceId: row.device_id,
    output: row.output,
    sinceMs: row.since_ms,
    setpointC: row.setpoint_c,
    mode: row.mode,
    controlTempC: row.control_temp_c,
    receivedAt: row.received_at,
  };
}

export function insertDecision(
  db: Database.Database,
  payload: ControlDecisionPayload,
  receivedAt: number,
): void {
  db.prepare(
    `INSERT INTO control_decisions
       (device_id, kind, from_output, to_output, reason, temperature_c, threshold_c,
        elapsed_ms, remaining_ms, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    payload.deviceId,
    payload.kind,
    payload.from,
    payload.to,
    payload.reason,
    payload.temperatureC,
    payload.thresholdC,
    payload.elapsedMs,
    payload.remainingMs,
    receivedAt,
  );
}

export function listDecisions(
  db: Database.Database,
  deviceId: string,
  limit: number,
): StoredDecision[] {
  return db
    .prepare<[string, number], DecisionRow>(
      `SELECT * FROM control_decisions
        WHERE device_id = ?
        ORDER BY received_at DESC, id DESC
        LIMIT ?`,
    )
    .all(deviceId, limit)
    .map((row) => ({
      id: row.id,
      deviceId: row.device_id,
      kind: row.kind,
      from: row.from_output,
      to: row.to_output,
      reason: row.reason,
      temperatureC: row.temperature_c,
      thresholdC: row.threshold_c,
      elapsedMs: row.elapsed_ms,
      remainingMs: row.remaining_ms,
      receivedAt: row.received_at,
    }));
}

export function deleteDecisionsOlderThan(db: Database.Database, cutoffMs: number): number {
  return db.prepare("DELETE FROM control_decisions WHERE received_at < ?").run(cutoffMs).changes;
}
