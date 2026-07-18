import type Database from "better-sqlite3";
import type { CreateHydrometerRequest, Hydrometer, UpdateHydrometerRequest } from "@brewhub/shared-types";

interface HydrometerRow {
  id: number;
  identifier: string;
  type: string;
  fermenter_device_id: string | null;
  calibration_slope: number;
  calibration_offset: number;
  created_at: number;
}

function toHydrometer(row: HydrometerRow): Hydrometer {
  return {
    id: row.id,
    identifier: row.identifier,
    type: row.type as Hydrometer["type"],
    fermenterDeviceId: row.fermenter_device_id,
    calibrationSlope: row.calibration_slope,
    calibrationOffset: row.calibration_offset,
    createdAt: row.created_at,
  };
}

export function listHydrometers(db: Database.Database): Hydrometer[] {
  return db
    .prepare<[], HydrometerRow>("SELECT * FROM hydrometers ORDER BY created_at ASC")
    .all()
    .map(toHydrometer);
}

export function getHydrometer(db: Database.Database, id: number): Hydrometer | null {
  const row = db.prepare<[number], HydrometerRow>("SELECT * FROM hydrometers WHERE id = ?").get(id);
  return row ? toHydrometer(row) : null;
}

export function getHydrometerByIdentifier(db: Database.Database, identifier: string): Hydrometer | null {
  const row = db
    .prepare<[string], HydrometerRow>("SELECT * FROM hydrometers WHERE identifier = ?")
    .get(identifier);
  return row ? toHydrometer(row) : null;
}

export function getHydrometerForFermenter(db: Database.Database, fermenterDeviceId: string): Hydrometer | null {
  const row = db
    .prepare<[string], HydrometerRow>("SELECT * FROM hydrometers WHERE fermenter_device_id = ?")
    .get(fermenterDeviceId);
  return row ? toHydrometer(row) : null;
}

export function insertHydrometer(db: Database.Database, req: CreateHydrometerRequest): Hydrometer {
  const result = db
    .prepare(
      `INSERT INTO hydrometers (identifier, type, fermenter_device_id, calibration_slope, calibration_offset)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      req.identifier,
      req.type,
      req.fermenterDeviceId ?? null,
      req.calibrationSlope ?? 1.0,
      req.calibrationOffset ?? 0.0,
    );
  const hydrometer = getHydrometer(db, Number(result.lastInsertRowid));
  if (!hydrometer) throw new Error("Failed to read back inserted hydrometer");
  return hydrometer;
}

export function updateHydrometer(db: Database.Database, id: number, patch: UpdateHydrometerRequest): Hydrometer {
  const current = getHydrometer(db, id);
  if (!current) throw new Error(`Hydrometer ${id} not found`);

  const fermenterDeviceId = patch.fermenterDeviceId !== undefined ? patch.fermenterDeviceId : current.fermenterDeviceId;
  const calibrationSlope = patch.calibrationSlope ?? current.calibrationSlope;
  const calibrationOffset = patch.calibrationOffset ?? current.calibrationOffset;

  db.prepare(
    `UPDATE hydrometers SET fermenter_device_id = ?, calibration_slope = ?, calibration_offset = ? WHERE id = ?`,
  ).run(fermenterDeviceId, calibrationSlope, calibrationOffset, id);

  const updated = getHydrometer(db, id);
  if (!updated) throw new Error("Failed to read back updated hydrometer");
  return updated;
}

export function deleteHydrometer(db: Database.Database, id: number): boolean {
  const result = db.prepare("DELETE FROM hydrometers WHERE id = ?").run(id);
  return result.changes > 0;
}
