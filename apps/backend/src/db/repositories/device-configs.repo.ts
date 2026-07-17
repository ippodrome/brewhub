import type Database from "better-sqlite3";
import { DEFAULT_DEVICE_CONFIG, type DeviceConfig } from "@brewhub/shared-types";

interface DeviceConfigRow {
  device_id: string;
  setpoint_c: number;
  hysteresis_c: number;
  mode: string;
  min_on_time_ms: number;
  min_off_time_ms: number;
  override_expires_at: number | null;
  updated_at: number;
}

function toDeviceConfig(row: DeviceConfigRow): DeviceConfig {
  return {
    setpointC: row.setpoint_c,
    hysteresisC: row.hysteresis_c,
    mode: row.mode as DeviceConfig["mode"],
    minOnTimeMs: row.min_on_time_ms,
    minOffTimeMs: row.min_off_time_ms,
    overrideExpiresAt: row.override_expires_at,
  };
}

export function getDeviceConfig(db: Database.Database, deviceId: string): DeviceConfig | null {
  const row = db
    .prepare<[string], DeviceConfigRow>("SELECT * FROM device_configs WHERE device_id = ?")
    .get(deviceId);
  return row ? toDeviceConfig(row) : null;
}

/** Called when a device row is created — seeds a config row with safe defaults. */
export function ensureDefaultDeviceConfig(db: Database.Database, deviceId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO device_configs
       (device_id, setpoint_c, hysteresis_c, mode, min_on_time_ms, min_off_time_ms)
     VALUES (@deviceId, @setpointC, @hysteresisC, @mode, @minOnTimeMs, @minOffTimeMs)`,
  ).run({
    deviceId,
    setpointC: DEFAULT_DEVICE_CONFIG.setpointC,
    hysteresisC: DEFAULT_DEVICE_CONFIG.hysteresisC,
    mode: DEFAULT_DEVICE_CONFIG.mode,
    minOnTimeMs: DEFAULT_DEVICE_CONFIG.minOnTimeMs,
    minOffTimeMs: DEFAULT_DEVICE_CONFIG.minOffTimeMs,
  });
}

/** Merges a partial update onto the existing (or default) config and persists the full result. */
export function updateDeviceConfig(
  db: Database.Database,
  deviceId: string,
  partial: Partial<DeviceConfig>,
): DeviceConfig {
  const current = getDeviceConfig(db, deviceId) ?? DEFAULT_DEVICE_CONFIG;
  const next: DeviceConfig = { ...current, ...partial };

  db.prepare(
    `INSERT INTO device_configs
       (device_id, setpoint_c, hysteresis_c, mode, min_on_time_ms, min_off_time_ms, override_expires_at, updated_at)
     VALUES (@deviceId, @setpointC, @hysteresisC, @mode, @minOnTimeMs, @minOffTimeMs, @overrideExpiresAt, unixepoch())
     ON CONFLICT(device_id) DO UPDATE SET
       setpoint_c = excluded.setpoint_c,
       hysteresis_c = excluded.hysteresis_c,
       mode = excluded.mode,
       min_on_time_ms = excluded.min_on_time_ms,
       min_off_time_ms = excluded.min_off_time_ms,
       override_expires_at = excluded.override_expires_at,
       updated_at = unixepoch()`,
  ).run({
    deviceId,
    setpointC: next.setpointC,
    hysteresisC: next.hysteresisC,
    mode: next.mode,
    minOnTimeMs: next.minOnTimeMs,
    minOffTimeMs: next.minOffTimeMs,
    overrideExpiresAt: next.overrideExpiresAt ?? null,
  });

  return next;
}
