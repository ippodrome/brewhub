import type Database from "better-sqlite3";
import type { FlowReading } from "@brewhub/shared-types";
import { applyFlowReadingUpdate, getTapByFlowIndex, markKicked } from "../db/repositories/taps.repo.js";
import { extendPourEvent, startPourEvent } from "../db/repositories/pour-events.repo.js";
import { processFlowReading } from "./process-flow-reading.js";
import { checkLowVolumeCrossing, type LowVolumeEvent } from "./low-volume-event.js";
import { checkKick, type KickEvent } from "./kick-event.js";

const POUR_IDLE_TIMEOUT_MS = 5000;

/**
 * Anything worth notifying about that came out of one flow reading. Both are
 * independent and can fire on the same tick — a keg that blows is also, by
 * then, usually low.
 */
export interface FlowEvents {
  lowVolume: LowVolumeEvent | null;
  kick: KickEvent | null;
}

const NO_EVENTS: FlowEvents = { lowVolume: null, kick: null };

/** Drives processFlowReading's decision into actual DB writes. No-ops if the flow index has no configured tap. */
export function applyFlowReading(
  db: Database.Database,
  deviceId: string,
  flowReading: FlowReading,
  nowMs: number,
): FlowEvents {
  const tap = getTapByFlowIndex(db, deviceId, flowReading.index);
  // pulses_per_liter is guaranteed non-null by the taps CHECK constraint for
  // measurement_type='flow' (which getTapByFlowIndex already filters on) —
  // this guard just gives TS the same guarantee the DB already enforces.
  if (!tap || tap.pulses_per_liter === null) return NO_EVENTS;

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
      return NO_EVENTS;

    case "resync":
      applyFlowReadingUpdate(db, tap.id, {
        remainingVolumeMl: tap.remaining_volume_ml,
        lastPulseCount: action.lastPulseCount,
        pourInProgressId: action.finalizePour ? null : tap.pour_in_progress_id,
        lastActivityAt: action.finalizePour ? null : tap.last_activity_at,
      });
      return NO_EVENTS;

    case "start_pour": {
      const pourId = startPourEvent(db, tap.id, action.volumeMl, nowMs);
      applyFlowReadingUpdate(db, tap.id, {
        remainingVolumeMl: action.remainingVolumeMl,
        lastPulseCount: action.lastPulseCount,
        pourInProgressId: pourId,
        lastActivityAt: nowMs,
      });
      // No kick check: the first tick of a pour has no prior activity to
      // measure an interval against, so there is no rate to judge yet.
      return { lowVolume: checkLowVolumeCrossing(db, tap, action.remainingVolumeMl), kick: null };
    }

    case "extend_pour": {
      // tap.pour_in_progress_id is guaranteed non-null here: processFlowReading
      // only returns "extend_pour" when it was passed a non-null pourInProgressId.
      const pourVolumeSoFarMl = extendPourEvent(
        db,
        tap.pour_in_progress_id as number,
        action.addedVolumeMl,
        nowMs,
      );
      applyFlowReadingUpdate(db, tap.id, {
        remainingVolumeMl: action.remainingVolumeMl,
        lastPulseCount: action.lastPulseCount,
        pourInProgressId: tap.pour_in_progress_id,
        lastActivityAt: nowMs,
      });

      const kick = checkKick(
        { ...tap, pourVolumeSoFarMl },
        action.addedVolumeMl,
        nowMs - (tap.last_activity_at ?? nowMs),
      );
      if (kick) markKicked(db, tap.id, nowMs);

      return { lowVolume: checkLowVolumeCrossing(db, tap, action.remainingVolumeMl), kick };
    }

    case "finalize_pour":
      applyFlowReadingUpdate(db, tap.id, {
        remainingVolumeMl: tap.remaining_volume_ml,
        lastPulseCount: action.lastPulseCount,
        pourInProgressId: null,
        lastActivityAt: null,
      });
      return NO_EVENTS;
  }
}
