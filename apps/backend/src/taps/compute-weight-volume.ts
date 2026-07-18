export interface WeightVolumeInputs {
  currentWeightG: number;
  tareWeightG: number;
  fullWeightG: number;
  fullVolumeMl: number;
}

/**
 * Weight-based volume is a pure function of the current reading — unlike
 * flow (cumulative pulses, needs delta-from-last-known state), there's no
 * pour history to maintain here. Every new weight reading fully determines
 * remaining volume by linear interpolation between the tare (empty) and
 * full calibration points; pour-event logging isn't derived from this at
 * all yet (see TapSchema doc comment in shared-types).
 *
 * fullWeightG <= tareWeightG means the tap was never calibrated correctly
 * (or calibration got corrupted) — dividing by that span would blow up, so
 * it's treated as "unknown, report empty" rather than throwing, since a
 * bad calibration shouldn't crash telemetry processing for every reading.
 */
export function computeWeightBasedVolume(inputs: WeightVolumeInputs): number {
  const { currentWeightG, tareWeightG, fullWeightG, fullVolumeMl } = inputs;
  const span = fullWeightG - tareWeightG;
  if (span <= 0) return 0;

  const fraction = (currentWeightG - tareWeightG) / span;
  return Math.max(0, Math.min(fullVolumeMl, fraction * fullVolumeMl));
}
