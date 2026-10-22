import type Database from "better-sqlite3";
import {
  DEFAULT_BEER_DENSITY_KG_PER_L,
  type CreateTapRequest,
  type Tap,
  type UpdateTapRequest,
} from "@brewhub/shared-types";

export interface TapRow {
  id: number;
  device_id: string;
  measurement_type: string;
  flow_index: number | null;
  pulses_per_liter: number | null;
  weight_device_id: string | null;
  weight_index: number | null;
  tare_weight_g: number | null;
  full_weight_g: number | null;
  name: string;
  style: string | null;
  abv: number | null;
  ibu: number | null;
  notes: string | null;
  image_url: string | null;
  full_volume_ml: number;
  remaining_volume_ml: number;
  last_pulse_count: number;
  pour_in_progress_id: number | null;
  last_activity_at: number | null;
  created_at: number;
  low_volume_notified: number;
  kicked_at: number | null;
  beer_density_kg_per_l: number | null;
  final_gravity_sg: number | null;
}

function toTap(row: TapRow): Tap {
  return {
    id: row.id,
    deviceId: row.device_id,
    measurementType: row.measurement_type as Tap["measurementType"],
    flowIndex: row.flow_index,
    pulsesPerLiter: row.pulses_per_liter,
    weightDeviceId: row.weight_device_id,
    weightIndex: row.weight_index,
    tareWeightG: row.tare_weight_g,
    fullWeightG: row.full_weight_g,
    name: row.name,
    style: row.style,
    abv: row.abv,
    ibu: row.ibu,
    notes: row.notes,
    imageUrl: row.image_url,
    fullVolumeMl: row.full_volume_ml,
    remainingVolumeMl: row.remaining_volume_ml,
    createdAt: row.created_at,
    kickedAt: row.kicked_at,
    beerDensityKgPerL: row.beer_density_kg_per_l,
    finalGravitySg: row.final_gravity_sg,
  };
}

export function listTapsForDevice(db: Database.Database, deviceId: string): Tap[] {
  const rows = db
    .prepare<[string], TapRow>("SELECT * FROM taps WHERE device_id = ? ORDER BY id ASC")
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
        "SELECT * FROM taps WHERE device_id = ? AND measurement_type = 'flow' AND flow_index = ?",
      )
      .get(deviceId, flowIndex) ?? null
  );
}

/** All weight-measured taps currently reading from a given (weightDeviceId, weightIndex) channel — normally 0 or 1. */
export function listTapsByWeightChannel(
  db: Database.Database,
  weightDeviceId: string,
  weightIndex: number,
): TapRow[] {
  return db
    .prepare<[string, number], TapRow>(
      "SELECT * FROM taps WHERE measurement_type = 'weight' AND weight_device_id = ? AND weight_index = ?",
    )
    .all(weightDeviceId, weightIndex);
}

function findWeightTapConflict(
  db: Database.Database,
  weightDeviceId: string,
  weightIndex: number,
  excludeTapId?: number,
): TapRow | null {
  const existing = listTapsByWeightChannel(db, weightDeviceId, weightIndex);
  return existing.find((t) => t.id !== excludeTapId) ?? null;
}

export function insertTap(db: Database.Database, deviceId: string, req: CreateTapRequest): Tap {
  const result =
    req.measurementType === "flow"
      ? db
          .prepare(
            `INSERT INTO taps
               (device_id, measurement_type, flow_index, pulses_per_liter, name, style, abv, ibu,
                notes, image_url, full_volume_ml, remaining_volume_ml)
             VALUES (@deviceId, 'flow', @flowIndex, @pulsesPerLiter, @name, @style, @abv, @ibu,
                     @notes, @imageUrl, @fullVolumeMl, @fullVolumeMl)`,
          )
          .run({
            deviceId,
            flowIndex: req.flowIndex,
            pulsesPerLiter: req.pulsesPerLiter,
            name: req.name,
            style: req.style ?? null,
            abv: req.abv ?? null,
            ibu: req.ibu ?? null,
            notes: req.notes ?? null,
            imageUrl: req.imageUrl ?? null,
            fullVolumeMl: req.fullVolumeMl,
          })
      : db
          .prepare(
            `INSERT INTO taps
               (device_id, measurement_type, weight_device_id, weight_index, tare_weight_g, full_weight_g,
                beer_density_kg_per_l, final_gravity_sg,
                name, style, abv, ibu, notes, image_url, full_volume_ml, remaining_volume_ml)
             VALUES (@deviceId, 'weight', @weightDeviceId, @weightIndex, @tareWeightG, @fullWeightG,
                     @density, @fg,
                     @name, @style, @abv, @ibu, @notes, @imageUrl, @fullVolumeMl, @fullVolumeMl)`,
          )
          .run({
            deviceId,
            weightDeviceId: req.weightDeviceId,
            weightIndex: req.weightIndex,
            tareWeightG: req.tareWeightG,
            // The column is still NOT NULL for weight taps (0006's CHECK); derive
            // it from density when the client didn't measure a full keg.
            fullWeightG:
              req.fullWeightG ??
              req.tareWeightG + req.fullVolumeMl * (req.finalGravitySg ?? req.beerDensityKgPerL ?? DEFAULT_BEER_DENSITY_KG_PER_L),
            density: req.beerDensityKgPerL ?? DEFAULT_BEER_DENSITY_KG_PER_L,
            fg: req.finalGravitySg ?? null,
            name: req.name,
            style: req.style ?? null,
            abv: req.abv ?? null,
            ibu: req.ibu ?? null,
            notes: req.notes ?? null,
            imageUrl: req.imageUrl ?? null,
            fullVolumeMl: req.fullVolumeMl,
          });

  const tap = getTap(db, Number(result.lastInsertRowid));
  if (!tap) throw new Error("Failed to read back inserted tap");
  return tap;
}

/**
 * measurementType is immutable after creation (see UpdateTapRequestSchema
 * doc comment in shared-types) — this only ever updates fields within
 * whichever field group the tap's existing measurementType already uses.
 */
export function updateTapDetails(
  db: Database.Database,
  id: number,
  patch: Omit<UpdateTapRequest, "resetKeg">,
): void {
  const current = getTapRow(db, id);
  if (!current) return;

  if (current.measurement_type === "flow") {
    db.prepare(
      `UPDATE taps SET
         flow_index = @flowIndex, pulses_per_liter = @pulsesPerLiter, name = @name, style = @style,
         abv = @abv, ibu = @ibu, notes = @notes, image_url = @imageUrl, full_volume_ml = @fullVolumeMl
       WHERE id = @id`,
    ).run({
      id,
      flowIndex: patch.flowIndex ?? current.flow_index,
      pulsesPerLiter: patch.pulsesPerLiter ?? current.pulses_per_liter,
      name: patch.name ?? current.name,
      style: patch.style ?? current.style,
      abv: patch.abv ?? current.abv,
      ibu: patch.ibu ?? current.ibu,
      notes: patch.notes ?? current.notes,
      imageUrl: patch.imageUrl ?? current.image_url,
      fullVolumeMl: patch.fullVolumeMl ?? current.full_volume_ml,
    });
    return;
  }

  db.prepare(
    `UPDATE taps SET
       weight_device_id = @weightDeviceId, weight_index = @weightIndex, tare_weight_g = @tareWeightG,
       full_weight_g = @fullWeightG, beer_density_kg_per_l = @density, final_gravity_sg = @fg,
       name = @name, style = @style, abv = @abv, ibu = @ibu,
       notes = @notes, image_url = @imageUrl, full_volume_ml = @fullVolumeMl
     WHERE id = @id`,
  ).run({
    id,
    weightDeviceId: patch.weightDeviceId ?? current.weight_device_id,
    weightIndex: patch.weightIndex ?? current.weight_index,
    tareWeightG: patch.tareWeightG ?? current.tare_weight_g,
    fullWeightG: patch.fullWeightG ?? current.full_weight_g,
    density: patch.beerDensityKgPerL ?? current.beer_density_kg_per_l,
    fg: patch.finalGravitySg === undefined ? current.final_gravity_sg : patch.finalGravitySg,
    name: patch.name ?? current.name,
    style: patch.style ?? current.style,
    abv: patch.abv ?? current.abv,
    ibu: patch.ibu ?? current.ibu,
    notes: patch.notes ?? current.notes,
    imageUrl: patch.imageUrl ?? current.image_url,
    fullVolumeMl: patch.fullVolumeMl ?? current.full_volume_ml,
  });
}

/**
 * Conflict check for POST (new tap) and PATCH (tap changing its channel).
 * Only meaningful within one measurement type — a flow tap and a weight
 * tap can never collide since they occupy disjoint column groups.
 */
export function findTapChannelConflict(
  db: Database.Database,
  deviceId: string,
  req: { measurementType: "flow"; flowIndex: number } | { measurementType: "weight"; weightDeviceId: string; weightIndex: number },
  excludeTapId?: number,
): TapRow | null {
  if (req.measurementType === "flow") {
    const existing = getTapByFlowIndex(db, deviceId, req.flowIndex);
    return existing && existing.id !== excludeTapId ? existing : null;
  }
  return findWeightTapConflict(db, req.weightDeviceId, req.weightIndex, excludeTapId);
}

/** Tapping a new keg clears both once-per-keg flags along with the volume. */
export function resetKeg(db: Database.Database, id: number): void {
  db.prepare(
    "UPDATE taps SET remaining_volume_ml = full_volume_ml, low_volume_notified = 0, kicked_at = NULL WHERE id = ?",
  ).run(id);
}

/** Records that the keg was detected as blown. Only cleared by resetKeg, so it notifies once per keg. */
export function markKicked(db: Database.Database, id: number, atMs: number): void {
  db.prepare("UPDATE taps SET kicked_at = ? WHERE id = ?").run(atMs, id);
}

/** Marks the one-time low-volume notification as sent — see the migration's doc comment on this column. */
export function markLowVolumeNotified(db: Database.Database, id: number): void {
  db.prepare("UPDATE taps SET low_volume_notified = 1 WHERE id = ?").run(id);
}

export function deleteTap(db: Database.Database, id: number): boolean {
  const result = db.prepare("DELETE FROM taps WHERE id = ?").run(id);
  return result.changes > 0;
}

/** Persists the result of processing one flow reading against a flow-measured tap. */
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

/**
 * Installs a freshly calibrated pulses-per-litre factor, and restates the
 * remaining volume as "what was in the keg when calibration started, minus
 * what we now know was actually poured".
 *
 * The correction matters because the calibration pour was already subtracted
 * once, live, using the old (wrong) factor — that's what the pour-processing
 * path does with every pulse it sees, and it has no idea a calibration is in
 * progress. Recomputing from the session's baseline replaces that estimate
 * with the measured truth instead of compounding the error.
 */
export function applyFlowCalibration(
  db: Database.Database,
  tapId: number,
  pulsesPerLiter: number,
  remainingVolumeMl: number,
): void {
  db.prepare("UPDATE taps SET pulses_per_liter = ?, remaining_volume_ml = ? WHERE id = ?").run(
    pulsesPerLiter,
    Math.max(0, remainingVolumeMl),
    tapId,
  );
}

/** Persists a recomputed remaining volume for a weight-measured tap — stateless, no pour bookkeeping. */
export function applyWeightReadingUpdate(
  db: Database.Database,
  tapId: number,
  remainingVolumeMl: number,
): void {
  db.prepare("UPDATE taps SET remaining_volume_ml = ? WHERE id = ?").run(remainingVolumeMl, tapId);
}

/** Every weight tap reading from any channel of one keg_scale device. */
export function listTapsForWeightDevice(db: Database.Database, weightDeviceId: string): Tap[] {
  return db
    .prepare<[string], TapRow>(
      "SELECT * FROM taps WHERE measurement_type = 'weight' AND weight_device_id = ? ORDER BY weight_index ASC, id ASC",
    )
    .all(weightDeviceId)
    .map(toTap);
}
