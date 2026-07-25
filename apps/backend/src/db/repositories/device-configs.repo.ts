import type Database from "better-sqlite3";
import { DEFAULT_DEVICE_CONFIG, type DeviceConfig } from "@brewhub/shared-types";

interface DeviceConfigRow {
  device_id: string;
  setpoint_c: number;
  hysteresis_c: number;
  mode: string;
  min_on_time_ms: number;
  min_off_time_ms: number;
  pid_kp: number;
  pid_ki: number;
  pid_kd: number;
  pid_window_ms: number;
  control_sensor_address: string | null;
  control_sensor_offset_c: number;
  cooling_relay_active_low: number | null;
  heating_relay_active_low: number | null;
  active_profile_id: number | null;
  profile_started_at: number | null;
  override_expires_at: number | null;
  tare_request_id: number | null;
  load_cell_calibration_factor: number | null;
  updated_at: number;
}

function toDeviceConfig(row: DeviceConfigRow): DeviceConfig {
  return {
    setpointC: row.setpoint_c,
    hysteresisC: row.hysteresis_c,
    mode: row.mode as DeviceConfig["mode"],
    minOnTimeMs: row.min_on_time_ms,
    minOffTimeMs: row.min_off_time_ms,
    pidGains: { kp: row.pid_kp, ki: row.pid_ki, kd: row.pid_kd },
    pidWindowMs: row.pid_window_ms,
    controlSensorAddress: row.control_sensor_address,
    controlSensorOffsetC: row.control_sensor_offset_c,
    // SQLite has no boolean type — NULL stays null ("use the board default"),
    // 0/1 become false/true.
    coolingRelayActiveLow:
      row.cooling_relay_active_low === null ? null : row.cooling_relay_active_low === 1,
    heatingRelayActiveLow:
      row.heating_relay_active_low === null ? null : row.heating_relay_active_low === 1,
    overrideExpiresAt: row.override_expires_at,
    tareRequestId: row.tare_request_id,
    loadCellCalibrationFactor: row.load_cell_calibration_factor,
  };
}

function getRow(db: Database.Database, deviceId: string): DeviceConfigRow | null {
  return (
    db
      .prepare<[string], DeviceConfigRow>("SELECT * FROM device_configs WHERE device_id = ?")
      .get(deviceId) ?? null
  );
}

export function getDeviceConfig(db: Database.Database, deviceId: string): DeviceConfig | null {
  const row = getRow(db, deviceId);
  return row ? toDeviceConfig(row) : null;
}

/** Called when a device row is created — seeds a config row with safe defaults. */
export function ensureDefaultDeviceConfig(db: Database.Database, deviceId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO device_configs
       (device_id, setpoint_c, hysteresis_c, mode, min_on_time_ms, min_off_time_ms,
        pid_kp, pid_ki, pid_kd, pid_window_ms)
     VALUES (@deviceId, @setpointC, @hysteresisC, @mode, @minOnTimeMs, @minOffTimeMs,
             @pidKp, @pidKi, @pidKd, @pidWindowMs)`,
  ).run({
    deviceId,
    setpointC: DEFAULT_DEVICE_CONFIG.setpointC,
    hysteresisC: DEFAULT_DEVICE_CONFIG.hysteresisC,
    mode: DEFAULT_DEVICE_CONFIG.mode,
    minOnTimeMs: DEFAULT_DEVICE_CONFIG.minOnTimeMs,
    minOffTimeMs: DEFAULT_DEVICE_CONFIG.minOffTimeMs,
    pidKp: DEFAULT_DEVICE_CONFIG.pidGains.kp,
    pidKi: DEFAULT_DEVICE_CONFIG.pidGains.ki,
    pidKd: DEFAULT_DEVICE_CONFIG.pidGains.kd,
    pidWindowMs: DEFAULT_DEVICE_CONFIG.pidWindowMs,
  });
}

/** Merges a partial update onto the existing (or default) config and persists the full result. */
export function updateDeviceConfig(
  db: Database.Database,
  deviceId: string,
  partial: Partial<DeviceConfig>,
): DeviceConfig {
  const current = getDeviceConfig(db, deviceId) ?? DEFAULT_DEVICE_CONFIG;
  const next: DeviceConfig = {
    ...current,
    ...partial,
    pidGains: { ...current.pidGains, ...partial.pidGains },
  };

  db.prepare(
    `INSERT INTO device_configs
       (device_id, setpoint_c, hysteresis_c, mode, min_on_time_ms, min_off_time_ms,
        pid_kp, pid_ki, pid_kd, pid_window_ms, control_sensor_address, control_sensor_offset_c,
        cooling_relay_active_low, heating_relay_active_low,
        override_expires_at, tare_request_id, load_cell_calibration_factor, updated_at)
     VALUES (@deviceId, @setpointC, @hysteresisC, @mode, @minOnTimeMs, @minOffTimeMs,
             @pidKp, @pidKi, @pidKd, @pidWindowMs, @controlSensorAddress, @controlSensorOffsetC,
             @coolingRelayActiveLow, @heatingRelayActiveLow,
             @overrideExpiresAt, @tareRequestId, @loadCellCalibrationFactor, unixepoch())
     ON CONFLICT(device_id) DO UPDATE SET
       setpoint_c = excluded.setpoint_c,
       hysteresis_c = excluded.hysteresis_c,
       mode = excluded.mode,
       min_on_time_ms = excluded.min_on_time_ms,
       min_off_time_ms = excluded.min_off_time_ms,
       pid_kp = excluded.pid_kp,
       pid_ki = excluded.pid_ki,
       pid_kd = excluded.pid_kd,
       pid_window_ms = excluded.pid_window_ms,
       control_sensor_address = excluded.control_sensor_address,
       control_sensor_offset_c = excluded.control_sensor_offset_c,
       cooling_relay_active_low = excluded.cooling_relay_active_low,
       heating_relay_active_low = excluded.heating_relay_active_low,
       override_expires_at = excluded.override_expires_at,
       tare_request_id = excluded.tare_request_id,
       load_cell_calibration_factor = excluded.load_cell_calibration_factor,
       updated_at = unixepoch()`,
  ).run({
    deviceId,
    setpointC: next.setpointC,
    hysteresisC: next.hysteresisC,
    mode: next.mode,
    minOnTimeMs: next.minOnTimeMs,
    minOffTimeMs: next.minOffTimeMs,
    pidKp: next.pidGains.kp,
    pidKi: next.pidGains.ki,
    pidKd: next.pidGains.kd,
    pidWindowMs: next.pidWindowMs,
    controlSensorAddress: next.controlSensorAddress ?? null,
    controlSensorOffsetC: next.controlSensorOffsetC,
    coolingRelayActiveLow: next.coolingRelayActiveLow === null ? null : next.coolingRelayActiveLow ? 1 : 0,
    heatingRelayActiveLow: next.heatingRelayActiveLow === null ? null : next.heatingRelayActiveLow ? 1 : 0,
    overrideExpiresAt: next.overrideExpiresAt ?? null,
    tareRequestId: next.tareRequestId ?? null,
    loadCellCalibrationFactor: next.loadCellCalibrationFactor ?? null,
  });

  return next;
}

export interface ActiveProfileState {
  activeProfileId: number;
  profileStartedAt: number;
}

export function getActiveProfileState(
  db: Database.Database,
  deviceId: string,
): ActiveProfileState | null {
  const row = getRow(db, deviceId);
  if (!row || row.active_profile_id === null || row.profile_started_at === null) {
    return null;
  }
  return { activeProfileId: row.active_profile_id, profileStartedAt: row.profile_started_at };
}

export function setActiveProfile(
  db: Database.Database,
  deviceId: string,
  profileId: number,
  startedAtMs: number,
): void {
  db.prepare(
    `UPDATE device_configs SET active_profile_id = ?, profile_started_at = ?, updated_at = unixepoch()
     WHERE device_id = ?`,
  ).run(profileId, startedAtMs, deviceId);
}

export function clearActiveProfile(db: Database.Database, deviceId: string): void {
  db.prepare(
    `UPDATE device_configs SET active_profile_id = NULL, profile_started_at = NULL, updated_at = unixepoch()
     WHERE device_id = ?`,
  ).run(deviceId);
}

/** All devices currently following a profile — used by the resolution scheduler. */
export function listDevicesWithActiveProfile(
  db: Database.Database,
): Array<{ deviceId: string } & ActiveProfileState> {
  const rows = db
    .prepare<[], { device_id: string; active_profile_id: number; profile_started_at: number }>(
      `SELECT device_id, active_profile_id, profile_started_at FROM device_configs
       WHERE active_profile_id IS NOT NULL AND profile_started_at IS NOT NULL`,
    )
    .all();
  return rows.map((r) => ({
    deviceId: r.device_id,
    activeProfileId: r.active_profile_id,
    profileStartedAt: r.profile_started_at,
  }));
}
