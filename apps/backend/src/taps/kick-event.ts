import { KICK_MIN_POUR_VOLUME_ML, KICK_RATE_ML_PER_S } from "@brewhub/shared-types";

export interface KickEvent {
  tapId: number;
  tapName: string;
  deviceId: string;
  rateMlPerS: number;
}

export interface KickCandidate {
  id: number;
  name: string;
  device_id: string;
  kicked_at: number | null;
  /** Total volume this pour has delivered so far, including the tick being processed. */
  pourVolumeSoFarMl: number;
}

/**
 * Decides whether a flow tick looks like the keg having kicked. Pure — the
 * caller persists and notifies.
 *
 * `elapsedMs` is the gap since the last tick that had flow, so `volumeMl /
 * elapsedMs` is the instantaneous pour rate. Both come from the device's own
 * monotonic clock, which is fine for a delta even though it's useless as an
 * absolute timestamp (ADR-015).
 *
 * Fires at most once per keg: `kicked_at` is only cleared by tapping a new
 * one, so a keg that keeps blowing gas doesn't notify on every tick.
 */
export function checkKick(
  tap: KickCandidate,
  volumeMl: number,
  elapsedMs: number,
): KickEvent | null {
  if (tap.kicked_at !== null) return null;

  // No usable interval (first tick of a pour, or two readings sharing a
  // timestamp) means no rate — wait for the next tick rather than dividing
  // by zero or inventing an infinite rate.
  if (elapsedMs <= 0) return null;

  // A rate is only meaningful once the pour has actually delivered something;
  // otherwise a single noisy tick could look arbitrarily fast.
  if (tap.pourVolumeSoFarMl < KICK_MIN_POUR_VOLUME_ML) return null;

  const rateMlPerS = volumeMl / (elapsedMs / 1000);
  if (rateMlPerS < KICK_RATE_ML_PER_S) return null;

  return { tapId: tap.id, tapName: tap.name, deviceId: tap.device_id, rateMlPerS };
}
