import type Database from "better-sqlite3";
import type { DiscoveredDevice, DiscoveryMessage } from "@brewhub/shared-types";

interface DiscoveredDeviceRow {
  device_id: string;
  board: string;
  firmware_version: string;
  first_seen_at: number;
  last_seen_at: number;
}

function toDiscoveredDevice(row: DiscoveredDeviceRow): DiscoveredDevice {
  return {
    deviceId: row.device_id,
    board: row.board as DiscoveredDevice["board"],
    firmwareVersion: row.firmware_version,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

/** first_seen_at is set once by the column default and never touched again; last_seen_at bumps on every announcement. */
export function upsertDiscoveredDevice(db: Database.Database, message: DiscoveryMessage): void {
  db.prepare(
    `INSERT INTO discovered_devices (device_id, board, firmware_version)
     VALUES (@deviceId, @board, @firmwareVersion)
     ON CONFLICT(device_id) DO UPDATE SET
       board = excluded.board,
       firmware_version = excluded.firmware_version,
       last_seen_at = unixepoch()`,
  ).run({ deviceId: message.deviceId, board: message.board, firmwareVersion: message.firmwareVersion });
}

/** Only devices that have announced but aren't registered yet — these are the actual "pick me to add" candidates. */
export function listUnregisteredDiscoveredDevices(db: Database.Database): DiscoveredDevice[] {
  const rows = db
    .prepare<[], DiscoveredDeviceRow>(
      `SELECT dd.* FROM discovered_devices dd
       LEFT JOIN devices d ON d.id = dd.device_id
       WHERE d.id IS NULL
       ORDER BY dd.last_seen_at DESC`,
    )
    .all();
  return rows.map(toDiscoveredDevice);
}
