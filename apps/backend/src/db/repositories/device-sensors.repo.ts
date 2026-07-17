import type Database from "better-sqlite3";
import type { DeviceSensor } from "@brewhub/shared-types";

interface DeviceSensorRow {
  device_id: string;
  address: string;
  label: string | null;
  is_control_sensor: number;
  last_seen_at: number | null;
}

function toDeviceSensor(row: DeviceSensorRow): DeviceSensor {
  return {
    deviceId: row.device_id,
    address: row.address,
    label: row.label,
    isControlSensor: row.is_control_sensor === 1,
    lastSeenAt: row.last_seen_at,
  };
}

export function listSensorsForDevice(db: Database.Database, deviceId: string): DeviceSensor[] {
  const rows = db
    .prepare<[string], DeviceSensorRow>(
      "SELECT * FROM device_sensors WHERE device_id = ? ORDER BY address ASC",
    )
    .all(deviceId);
  return rows.map(toDeviceSensor);
}

export function getSensor(
  db: Database.Database,
  deviceId: string,
  address: string,
): DeviceSensor | null {
  const row = db
    .prepare<[string, string], DeviceSensorRow>(
      "SELECT * FROM device_sensors WHERE device_id = ? AND address = ?",
    )
    .get(deviceId, address);
  return row ? toDeviceSensor(row) : null;
}

/**
 * Called whenever telemetry mentions a sensor address. If it's genuinely
 * new for this device, it's auto-discovered as the (unlabeled) control
 * sensor if it's the device's first sensor ever, otherwise just added
 * unlabeled and not controlling anything. Existing sensors just get their
 * last_seen_at bumped. Returns true if this was a first-time discovery.
 */
export function recordSensorSeen(
  db: Database.Database,
  deviceId: string,
  address: string,
  seenAtMs: number,
): boolean {
  const existing = getSensor(db, deviceId, address);
  if (existing) {
    db.prepare(
      "UPDATE device_sensors SET last_seen_at = ? WHERE device_id = ? AND address = ?",
    ).run(seenAtMs, deviceId, address);
    return false;
  }

  const isFirstSensorForDevice = listSensorsForDevice(db, deviceId).length === 0;
  db.prepare(
    `INSERT INTO device_sensors (device_id, address, label, is_control_sensor, last_seen_at)
     VALUES (?, ?, NULL, ?, ?)`,
  ).run(deviceId, address, isFirstSensorForDevice ? 1 : 0, seenAtMs);
  return true;
}

export function setSensorLabel(
  db: Database.Database,
  deviceId: string,
  address: string,
  label: string | null,
): void {
  db.prepare("UPDATE device_sensors SET label = ? WHERE device_id = ? AND address = ?").run(
    label,
    deviceId,
    address,
  );
}

/** Exactly one sensor per device can be the control sensor. */
export function setControlSensor(db: Database.Database, deviceId: string, address: string): void {
  const clearOthers = db.transaction(() => {
    db.prepare("UPDATE device_sensors SET is_control_sensor = 0 WHERE device_id = ?").run(deviceId);
    db.prepare(
      "UPDATE device_sensors SET is_control_sensor = 1 WHERE device_id = ? AND address = ?",
    ).run(deviceId, address);
  });
  clearOthers();
}
