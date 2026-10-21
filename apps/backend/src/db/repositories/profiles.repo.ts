import type Database from "better-sqlite3";
import type {
  CreateProfileRequest,
  GravityProfileStep,
  Profile,
  ProfileTemplate,
  TimeProfileStep,
  UpdateProfileRequest,
} from "@brewhub/shared-types";

interface ProfileRow {
  id: number;
  device_id: string | null;
  is_template: number;
  name: string;
  trigger_type: string;
  steps_json: string;
  created_at: number;
}

function toProfile(row: ProfileRow): Profile {
  const base = { id: row.id, deviceId: row.device_id ?? "", name: row.name, createdAt: row.created_at };
  if (row.trigger_type === "gravity") {
    return { ...base, triggerType: "gravity", steps: JSON.parse(row.steps_json) as GravityProfileStep[] };
  }
  return { ...base, triggerType: "time", steps: JSON.parse(row.steps_json) as TimeProfileStep[] };
}

export function listProfilesForDevice(db: Database.Database, deviceId: string): Profile[] {
  const rows = db
    .prepare<[string], ProfileRow>(
      "SELECT * FROM profiles WHERE device_id = ? AND is_template = 0 ORDER BY created_at ASC",
    )
    .all(deviceId);
  return rows.map(toProfile);
}

export function getProfile(db: Database.Database, id: number): Profile | null {
  const row = db.prepare<[number], ProfileRow>("SELECT * FROM profiles WHERE id = ? AND is_template = 0").get(id);
  return row ? toProfile(row) : null;
}

export function insertProfile(
  db: Database.Database,
  deviceId: string,
  req: CreateProfileRequest,
): Profile {
  const result = db
    .prepare("INSERT INTO profiles (device_id, name, trigger_type, steps_json) VALUES (?, ?, ?, ?)")
    .run(deviceId, req.name, req.triggerType, JSON.stringify(req.steps));
  const profile = getProfile(db, Number(result.lastInsertRowid));
  if (!profile) throw new Error("Failed to read back inserted profile");
  return profile;
}

export function deleteProfile(db: Database.Database, id: number): boolean {
  const result = db.prepare("DELETE FROM profiles WHERE id = ? AND is_template = 0").run(id);
  return result.changes > 0;
}

/**
 * Replaces name, trigger type and steps in place. The id is kept, so a device
 * that is actively following this profile keeps following it (and keeps its
 * profile_started_at) — the scheduler simply resolves against the new steps.
 */
export function updateProfile(db: Database.Database, id: number, req: UpdateProfileRequest): Profile | null {
  const result = db
    .prepare(
      `UPDATE profiles SET name = ?, trigger_type = ?, steps_json = ?, updated_at = unixepoch()
       WHERE id = ? AND is_template = 0`,
    )
    .run(req.name, req.triggerType, JSON.stringify(req.steps), id);
  return result.changes > 0 ? getProfile(db, id) : null;
}

// --- Templates ---------------------------------------------------------------

function toTemplate(row: ProfileRow): ProfileTemplate {
  const base = { id: row.id, name: row.name, createdAt: row.created_at };
  if (row.trigger_type === "gravity") {
    return { ...base, triggerType: "gravity", steps: JSON.parse(row.steps_json) as GravityProfileStep[] };
  }
  return { ...base, triggerType: "time", steps: JSON.parse(row.steps_json) as TimeProfileStep[] };
}

export function listTemplates(db: Database.Database): ProfileTemplate[] {
  return db
    .prepare<[], ProfileRow>("SELECT * FROM profiles WHERE is_template = 1 ORDER BY name COLLATE NOCASE ASC, id ASC")
    .all()
    .map(toTemplate);
}

export function getTemplate(db: Database.Database, id: number): ProfileTemplate | null {
  const row = db.prepare<[number], ProfileRow>("SELECT * FROM profiles WHERE id = ? AND is_template = 1").get(id);
  return row ? toTemplate(row) : null;
}

export function insertTemplate(db: Database.Database, req: CreateProfileRequest): ProfileTemplate {
  const result = db
    .prepare("INSERT INTO profiles (device_id, is_template, name, trigger_type, steps_json) VALUES (NULL, 1, ?, ?, ?)")
    .run(req.name, req.triggerType, JSON.stringify(req.steps));
  const template = getTemplate(db, Number(result.lastInsertRowid));
  if (!template) throw new Error("Failed to read back inserted template");
  return template;
}

export function updateTemplate(db: Database.Database, id: number, req: UpdateProfileRequest): ProfileTemplate | null {
  const result = db
    .prepare(
      `UPDATE profiles SET name = ?, trigger_type = ?, steps_json = ?, updated_at = unixepoch()
       WHERE id = ? AND is_template = 1`,
    )
    .run(req.name, req.triggerType, JSON.stringify(req.steps), id);
  return result.changes > 0 ? getTemplate(db, id) : null;
}

export function deleteTemplate(db: Database.Database, id: number): boolean {
  return db.prepare("DELETE FROM profiles WHERE id = ? AND is_template = 1").run(id).changes > 0;
}
