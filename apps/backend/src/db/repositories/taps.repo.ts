import type Database from "better-sqlite3";
import type { CreateTapRequest, Tap } from "@brewhub/shared-types";

export interface TapRow {
  id: number;
  device_id: string;
  flow_index: number;
  name: string;
  style: string | null;
  abv: number | null;
  ibu: number | null;
  notes: string | null;
  image_url: string | null;
  pulses_per_liter: number;
  full_volume_ml: number;
  remaining_volume_ml: number;
  last_pulse_count: number;
  pour_in_progress_id: number | null;
  last_activity_at: number | null;
  created_at: number;
}

function toTap(row: TapRow): Tap {
  return {
    id: row.id,
    deviceId: row.device_id,
    flowIndex: row.flow_index,
    name: row.name,
    style: row.style,
    abv: row.abv,
    ibu: row.ibu,
    notes: row.notes,
    imageUrl: row.image_url,
    pulsesPerLiter: row.pulses_per_liter,
    fullVolumeMl: row.full_volume_ml,
    remainingVolumeMl: row.remaining_volume_ml,
    createdAt: row.created_at,
  };
}

export function listTapsForDevice(db: Database.Database, deviceId: string): Tap[] {
  const rows = db
    .prepare<[string], TapRow>("SELECT * FROM taps WHERE device_id = ? ORDER BY flow_index ASC")
    .all(deviceId);
  return rows.map(toTap);
}

export function getTap(db: Database.Database, id: number): Tap | null {
  const row = db.prepare<[number], TapRow>("SELECT * FROM taps WHERE id = ?").get(id);
  return row ? toTap(row) : null;
}

export function getTapRow(db: Database.Database, id: number): TapRow | null {
  return db.prepare<[number], TapRow>("SELECT * FROM taps WHERE id = ?").get(id) ?? null;
}

export function getTapByFlowIndex(
  db: Database.Database,
  deviceId: string,
  flowIndex: number,
): TapRow | null {
  return (
    db
      .prepare<[string, number], TapRow>(
        "SELECT * FROM taps WHERE device_id = ? AND flow_index = ?",
      )
      .get(deviceId, flowIndex) ?? null
  );
}

export function insertTap(db: Database.Database, deviceId: string, req: CreateTapRequest): Tap {
  const result = db
    .prepare(
      `INSERT INTO taps
         (device_id, flow_index, name, style, abv, ibu, notes, image_url,
          pulses_per_liter, full_volume_ml, remaining_volume_ml)
       VALUES (@deviceId, @flowIndex, @name, @style, @abv, @ibu, @notes, @imageUrl,
               @pulsesPerLiter, @fullVolumeMl, @fullVolumeMl)`,
    )
    .run({
      deviceId,
      flowIndex: req.flowIndex,
      name: req.name,
      style: req.style ?? null,
      abv: req.abv ?? null,
      ibu: req.ibu ?? null,
      notes: req.notes ?? null,
      imageUrl: req.imageUrl ?? null,
      pulsesPerLiter: req.pulsesPerLiter,
      fullVolumeMl: req.fullVolumeMl,
    });
  const tap = getTap(db, Number(result.lastInsertRowid));
  if (!tap) throw new Error("Failed to read back inserted tap");
  return tap;
}

export function updateTapDetails(
  db: Database.Database,
  id: number,
  patch: Partial<CreateTapRequest>,
): void {
  const current = getTapRow(db, id);
  if (!current) return;

  db.prepare(
    `UPDATE taps SET
       flow_index = @flowIndex, name = @name, style = @style, abv = @abv, ibu = @ibu,
       notes = @notes, image_url = @imageUrl, pulses_per_liter = @pulsesPerLiter,
       full_volume_ml = @fullVolumeMl
     WHERE id = @id`,
  ).run({
    id,
    flowIndex: patch.flowIndex ?? current.flow_index,
    name: patch.name ?? current.name,
    style: patch.style ?? current.style,
    abv: patch.abv ?? current.abv,
    ibu: patch.ibu ?? current.ibu,
    notes: patch.notes ?? current.notes,
    imageUrl: patch.imageUrl ?? current.image_url,
    pulsesPerLiter: patch.pulsesPerLiter ?? current.pulses_per_liter,
    fullVolumeMl: patch.fullVolumeMl ?? current.full_volume_ml,
  });
}

export function resetKeg(db: Database.Database, id: number): void {
  db.prepare(
    "UPDATE taps SET remaining_volume_ml = full_volume_ml WHERE id = ?",
  ).run(id);
}

export function deleteTap(db: Database.Database, id: number): boolean {
  const result = db.prepare("DELETE FROM taps WHERE id = ?").run(id);
  return result.changes > 0;
}

/** Persists the result of processing one flow reading against a tap. */
export function applyFlowReadingUpdate(
  db: Database.Database,
  tapId: number,
  update: {
    remainingVolumeMl: number;
    lastPulseCount: number;
    pourInProgressId: number | null;
    lastActivityAt: number | null;
  },
): void {
  db.prepare(
    `UPDATE taps SET
       remaining_volume_ml = @remainingVolumeMl,
       last_pulse_count = @lastPulseCount,
       pour_in_progress_id = @pourInProgressId,
       last_activity_at = @lastActivityAt
     WHERE id = @tapId`,
  ).run({
    tapId,
    remainingVolumeMl: update.remainingVolumeMl,
    lastPulseCount: update.lastPulseCount,
    pourInProgressId: update.pourInProgressId,
    lastActivityAt: update.lastActivityAt,
  });
}
