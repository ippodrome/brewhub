import type Database from "better-sqlite3";
import { LOW_VOLUME_THRESHOLD_PERCENT } from "@brewhub/shared-types";
import { markLowVolumeNotified } from "../db/repositories/taps.repo.js";

export interface LowVolumeEvent {
  tapId: number;
  tapName: string;
  deviceId: string;
}

/**
 * Call after persisting a new remainingVolumeMl for a tap. Returns an event
 * to notify on, or null — fires exactly once per fill cycle (guarded by
 * taps.low_volume_notified, reset on resetKeg) so a keg sitting below the
 * threshold doesn't re-notify on every subsequent reading.
 */
export function checkLowVolumeCrossing(
  db: Database.Database,
  tap: { id: number; name: string; device_id: string; full_volume_ml: number; low_volume_notified: number },
  newRemainingVolumeMl: number,
): LowVolumeEvent | null {
  if (tap.low_volume_notified || tap.full_volume_ml <= 0) return null;

  const percent = (newRemainingVolumeMl / tap.full_volume_ml) * 100;
  if (percent >= LOW_VOLUME_THRESHOLD_PERCENT) return null;

  markLowVolumeNotified(db, tap.id);
  return { tapId: tap.id, tapName: tap.name, deviceId: tap.device_id };
}
