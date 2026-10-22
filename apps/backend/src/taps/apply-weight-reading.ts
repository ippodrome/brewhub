import type Database from "better-sqlite3";
import type { WeightReading } from "@brewhub/shared-types";
import {
  applyWeightReadingUpdate,
  getTapRow,
  listTapsByWeightChannel,
  type TapRow,
} from "../db/repositories/taps.repo.js";
import { getRecentWeightReadings } from "../db/repositories/weight-readings.repo.js";
import { computeWeightBasedVolume } from "./compute-weight-volume.js";
import { checkLowVolumeCrossing, type LowVolumeEvent } from "./low-volume-event.js";

/** null = legacy tap (interpolate); otherwise FG wins over the stored density. */
export function tapDensity(tap: TapRow): number | null {
  return tap.final_gravity_sg ?? tap.beer_density_kg_per_l;
}

/**
 * Recomputes and persists remaining volume for every tap wired to this
 * (deviceId, weightReading.index) channel. No-ops if no tap is configured
 * for it. Unlike applyFlowReading there's no cumulative state to reconcile
 * — each reading is a fresh, independent snapshot (see
 * compute-weight-volume.ts doc comment). Multiple taps can share one
 * channel in principle, so this returns an array (usually 0 or 1 events).
 */
export function applyWeightReading(
  db: Database.Database,
  deviceId: string,
  weightReading: WeightReading,
): LowVolumeEvent[] {
  // grams === null is a sensor fault (HX711 not ready) — hold the last known
  // remaining volume rather than computing garbage from a missing reading.
  if (weightReading.grams === null) return [];

  const taps = listTapsByWeightChannel(db, deviceId, weightReading.index);
  const events: LowVolumeEvent[] = [];

  for (const tap of taps) {
    if (tap.tare_weight_g === null || tap.full_weight_g === null) continue;

    const remainingVolumeMl = computeWeightBasedVolume({
      currentWeightG: weightReading.grams,
      tareWeightG: tap.tare_weight_g,
      fullWeightG: tap.full_weight_g,
      fullVolumeMl: tap.full_volume_ml,
      densityKgPerL: tapDensity(tap),
    });
    applyWeightReadingUpdate(db, tap.id, remainingVolumeMl);

    const event = checkLowVolumeCrossing(db, tap, remainingVolumeMl);
    if (event) events.push(event);
  }

  return events;
}

/** Latest non-null gross reading (g) for a weight tap's channel, or null. */
export function latestGrossWeightG(db: Database.Database, tap: TapRow): number | null {
  if (tap.weight_device_id === null || tap.weight_index === null) return null;
  const [row] = getRecentWeightReadings(db, tap.weight_device_id, tap.weight_index, 1);
  return row?.grams ?? null;
}

/**
 * Re-derives remaining volume from the latest stored reading after the
 * user changed tare/density/FG, so the UI doesn't show a stale number until
 * the next telemetry tick. No-op without a reading.
 */
export function recomputeWeightTap(db: Database.Database, tapId: number): void {
  const tap = getTapRow(db, tapId);
  if (!tap || tap.measurement_type !== "weight" || tap.tare_weight_g === null || tap.full_weight_g === null) return;
  const grams = latestGrossWeightG(db, tap);
  if (grams === null) return;
  applyWeightReadingUpdate(
    db,
    tap.id,
    computeWeightBasedVolume({
      currentWeightG: grams,
      tareWeightG: tap.tare_weight_g,
      fullWeightG: tap.full_weight_g,
      fullVolumeMl: tap.full_volume_ml,
      densityKgPerL: tapDensity(tap),
    }),
  );
}
