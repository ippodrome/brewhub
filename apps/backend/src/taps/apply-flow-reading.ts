import type Database from "better-sqlite3";
import type { FlowReading } from "@brewhub/shared-types";
import { applyFlowReadingUpdate, getTapByFlowIndex } from "../db/repositories/taps.repo.js";
import { extendPourEvent, startPourEvent } from "../db/repositories/pour-events.repo.js";
import { processFlowReading } from "./process-flow-reading.js";

const POUR_IDLE_TIMEOUT_MS = 5000;

/** Drives processFlowReading's decision into actual DB writes. No-ops if the flow index has no configured tap. */
export function applyFlowReading(
  db: Database.Database,
  deviceId: string,
  flowReading: FlowReading,
  nowMs: number,
): void {
  const tap = getTapByFlowIndex(db, deviceId, flowReading.index);
  if (!tap) return;

  const action = processFlowReading(
    {
      lastPulseCount: tap.last_pulse_count,
      pourInProgressId: tap.pour_in_progress_id,
      lastActivityAt: tap.last_activity_at,
      remainingVolumeMl: tap.remaining_volume_ml,
      pulsesPerLiter: tap.pulses_per_liter,
    },
    flowReading.pulseCount,
    nowMs,
    POUR_IDLE_TIMEOUT_MS,
  );

  switch (action.type) {
    case "none":
      return;

    case "resync":
      applyFlowReadingUpdate(db, tap.id, {
        remainingVolumeMl: tap.remaining_volume_ml,
        lastPulseCount: action.lastPulseCount,
        pourInProgressId: action.finalizePour ? null : tap.pour_in_progress_id,
        lastActivityAt: action.finalizePour ? null : tap.last_activity_at,
      });
      return;

    case "start_pour": {
      const pourId = startPourEvent(db, tap.id, action.volumeMl, nowMs);
      applyFlowReadingUpdate(db, tap.id, {
        remainingVolumeMl: action.remainingVolumeMl,
        lastPulseCount: action.lastPulseCount,
        pourInProgressId: pourId,
        lastActivityAt: nowMs,
      });
      return;
    }

    case "extend_pour":
      // tap.pour_in_progress_id is guaranteed non-null here: processFlowReading
      // only returns "extend_pour" when it was passed a non-null pourInProgressId.
      extendPourEvent(db, tap.pour_in_progress_id as number, action.addedVolumeMl, nowMs);
      applyFlowReadingUpdate(db, tap.id, {
        remainingVolumeMl: action.remainingVolumeMl,
        lastPulseCount: action.lastPulseCount,
        pourInProgressId: tap.pour_in_progress_id,
        lastActivityAt: nowMs,
      });
      return;

    case "finalize_pour":
      applyFlowReadingUpdate(db, tap.id, {
        remainingVolumeMl: tap.remaining_volume_ml,
        lastPulseCount: action.lastPulseCount,
        pourInProgressId: null,
        lastActivityAt: null,
      });
      return;
  }
}
