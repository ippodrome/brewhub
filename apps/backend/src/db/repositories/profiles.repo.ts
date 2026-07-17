import type Database from "better-sqlite3";
import type { CreateProfileRequest, Profile, ProfileStep } from "@brewhub/shared-types";

interface ProfileRow {
  id: number;
  device_id: string;
  name: string;
  steps_json: string;
  created_at: number;
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    deviceId: row.device_id,
    name: row.name,
    steps: JSON.parse(row.steps_json) as ProfileStep[],
    createdAt: row.created_at,
  };
}

export function listProfilesForDevice(db: Database.Database, deviceId: string): Profile[] {
  const rows = db
    .prepare<[string], ProfileRow>(
      "SELECT * FROM profiles WHERE device_id = ? ORDER BY created_at ASC",
    )
    .all(deviceId);
  return rows.map(toProfile);
}

export function getProfile(db: Database.Database, id: number): Profile | null {
  const row = db.prepare<[number], ProfileRow>("SELECT * FROM profiles WHERE id = ?").get(id);
  return row ? toProfile(row) : null;
}

export function insertProfile(
  db: Database.Database,
  deviceId: string,
  req: CreateProfileRequest,
): Profile {
  const result = db
    .prepare("INSERT INTO profiles (device_id, name, steps_json) VALUES (?, ?, ?)")
    .run(deviceId, req.name, JSON.stringify(req.steps));
  const profile = getProfile(db, Number(result.lastInsertRowid));
  if (!profile) throw new Error("Failed to read back inserted profile");
  return profile;
}

export function deleteProfile(db: Database.Database, id: number): boolean {
  const result = db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
  return result.changes > 0;
}
