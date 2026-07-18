import type Database from "better-sqlite3";
import type { WeightReading } from "@brewhub/shared-types";
import { applyWeightReadingUpdate, listTapsByWeightChannel } from "../db/repositories/taps.repo.js";
import { computeWeightBasedVolume } from "./compute-weight-volume.js";
import { checkLowVolumeCrossing, type LowVolumeEvent } from "./low-volume-event.js";

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
    });
    applyWeightReadingUpdate(db, tap.id, remainingVolumeMl);

    const event = checkLowVolumeCrossing(db, tap, remainingVolumeMl);
    if (event) events.push(event);
  }

  return events;
}
