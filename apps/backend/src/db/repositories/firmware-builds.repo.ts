import type Database from "better-sqlite3";
import type { CreateFirmwareBuildRequest, FirmwareBuild } from "@brewhub/shared-types";

interface FirmwareBuildRow {
  id: number;
  device_id: string;
  board: string;
  version: string;
  filename: string;
  size_bytes: number;
  md5: string;
  uploaded_at: number;
}

function toFirmwareBuild(row: FirmwareBuildRow): FirmwareBuild {
  return {
    id: row.id,
    deviceId: row.device_id,
    board: row.board as FirmwareBuild["board"],
    version: row.version,
    filename: row.filename,
    sizeBytes: row.size_bytes,
    md5: row.md5,
    uploadedAt: row.uploaded_at,
  };
}

export function insertFirmwareBuild(
  db: Database.Database,
  req: CreateFirmwareBuildRequest,
  filename: string,
  sizeBytes: number,
  md5: string,
): FirmwareBuild {
  const result = db
    .prepare(
      `INSERT INTO firmware_builds (device_id, board, version, filename, size_bytes, md5)
       VALUES (@deviceId, @board, @version, @filename, @sizeBytes, @md5)`,
    )
    .run({
      deviceId: req.deviceId,
      board: req.board,
      version: req.version,
      filename,
      sizeBytes,
      md5,
    });
  const build = getFirmwareBuild(db, Number(result.lastInsertRowid));
  if (!build) throw new Error("Failed to read back inserted firmware build");
  return build;
}

export function listFirmwareBuilds(db: Database.Database, deviceId?: string): FirmwareBuild[] {
  const rows = deviceId
    ? db
        .prepare<[string], FirmwareBuildRow>(
          "SELECT * FROM firmware_builds WHERE device_id = ? ORDER BY uploaded_at DESC, id DESC",
        )
        .all(deviceId)
    : db
        .prepare<[], FirmwareBuildRow>("SELECT * FROM firmware_builds ORDER BY uploaded_at DESC, id DESC")
        .all();
  return rows.map(toFirmwareBuild);
}

export function getFirmwareBuild(db: Database.Database, id: number): FirmwareBuild | null {
  const row = db.prepare<[number], FirmwareBuildRow>("SELECT * FROM firmware_builds WHERE id = ?").get(id);
  return row ? toFirmwareBuild(row) : null;
}

export function deleteFirmwareBuild(db: Database.Database, id: number): boolean {
  const result = db.prepare("DELETE FROM firmware_builds WHERE id = ?").run(id);
  return result.changes > 0;
}
