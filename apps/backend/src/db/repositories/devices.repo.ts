import type Database from "better-sqlite3";
import type { CreateDeviceRequest, Device } from "@brewhub/shared-types";

interface DeviceRow {
  id: string;
  name: string;
  type: string;
  chamber_name: string | null;
  board: string | null;
  firmware_version: string | null;
  ip_address: string | null;
  is_online: number;
  last_seen_at: number | null;
  created_at: number;
  updated_at: number;
}

function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    name: row.name,
    type: row.type as Device["type"],
    chamberName: row.chamber_name,
    board: row.board,
    firmwareVersion: row.firmware_version,
    ipAddress: row.ip_address,
    isOnline: row.is_online === 1,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listDevices(db: Database.Database): Device[] {
  const rows = db.prepare<[], DeviceRow>("SELECT * FROM devices ORDER BY created_at ASC").all();
  return rows.map(toDevice);
}

export function getDevice(db: Database.Database, id: string): Device | null {
  const row = db.prepare<[string], DeviceRow>("SELECT * FROM devices WHERE id = ?").get(id);
  return row ? toDevice(row) : null;
}

export function insertDevice(db: Database.Database, req: CreateDeviceRequest): Device {
  db.prepare(
    `INSERT INTO devices (id, name, type, chamber_name, board)
     VALUES (@id, @name, @type, @chamberName, @board)`,
  ).run({
    id: req.id,
    name: req.name,
    type: req.type,
    chamberName: req.chamberName ?? null,
    board: req.board ?? null,
  });
  const device = getDevice(db, req.id);
  if (!device) throw new Error(`Failed to read back inserted device ${req.id}`);
  return device;
}

export function deleteDevice(db: Database.Database, id: string): boolean {
  const result = db.prepare("DELETE FROM devices WHERE id = ?").run(id);
  return result.changes > 0;
}

export function setDeviceOnline(
  db: Database.Database,
  id: string,
  isOnline: boolean,
  lastSeenAt: number,
): void {
  db.prepare(
    `UPDATE devices SET is_online = ?, last_seen_at = ?, updated_at = unixepoch() WHERE id = ?`,
  ).run(isOnline ? 1 : 0, lastSeenAt, id);
}

export function setDeviceFirmwareVersion(
  db: Database.Database,
  id: string,
  firmwareVersion: string,
): void {
  db.prepare(
    `UPDATE devices SET firmware_version = ?, updated_at = unixepoch() WHERE id = ?`,
  ).run(firmwareVersion, id);
}

export function listStaleOnlineDeviceIds(db: Database.Database, staleBeforeMs: number): string[] {
  const rows = db
    .prepare<[number], { id: string }>(
      "SELECT id FROM devices WHERE is_online = 1 AND (last_seen_at IS NULL OR last_seen_at < ?)",
    )
    .all(staleBeforeMs);
  return rows.map((r) => r.id);
}
