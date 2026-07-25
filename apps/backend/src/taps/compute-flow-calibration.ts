import {
  DEFAULT_POUR_DENSITY_G_PER_ML,
  MAX_PLAUSIBLE_PULSES_PER_LITER,
  MIN_CALIBRATION_PULSES,
  MIN_CALIBRATION_VOLUME_ML,
  MIN_PLAUSIBLE_PULSES_PER_LITER,
  type FinishFlowCalibrationRequest,
} from "@brewhub/shared-types";

/** Why a calibration was refused. The route maps these to HTTP responses; the UI shows the message. */
export type CalibrationRejection =
  | { reason: "counter_reset" }
  | { reason: "too_few_pulses"; pulses: number }
  | { reason: "too_little_volume"; volumeMl: number }
  | { reason: "implausible_factor"; pulsesPerLiter: number };

export type CalibrationOutcome =
  | { ok: true; pulses: number; actualVolumeMl: number; pulsesPerLiter: number; driftPercent: number }
  | { ok: false; rejection: CalibrationRejection };

/** Converts either calibration method to a plain volume in millilitres. */
export function resolveActualVolumeMl(request: FinishFlowCalibrationRequest): number {
  if (request.method === "volume") return request.actualVolumeMl;
  const density = request.densityGPerMl || DEFAULT_POUR_DENSITY_G_PER_ML;
  return request.actualWeightG / density;
}

/**
 * The whole of the calibration maths: how many pulses did the meter count
 * while a known volume went through it?
 *
 * Every rejection here exists because the alternative is silently installing a
 * factor that makes every future pour on this tap wrong — and unlike a bad
 * setpoint, nothing downstream would ever notice. Better to refuse and ask the
 * user to pour again.
 */
export function computeFlowCalibration(
  startPulseCount: number,
  currentPulseCount: number,
  previousPulsesPerLiter: number,
  request: FinishFlowCalibrationRequest,
): CalibrationOutcome {
  // The device's counter is cumulative and monotonic, so a lower count means
  // the firmware rebooted mid-calibration and the baseline is meaningless.
  if (currentPulseCount < startPulseCount) {
    return { ok: false, rejection: { reason: "counter_reset" } };
  }

  const pulses = currentPulseCount - startPulseCount;
  if (pulses < MIN_CALIBRATION_PULSES) {
    return { ok: false, rejection: { reason: "too_few_pulses", pulses } };
  }

  const actualVolumeMl = resolveActualVolumeMl(request);
  if (actualVolumeMl < MIN_CALIBRATION_VOLUME_ML) {
    return { ok: false, rejection: { reason: "too_little_volume", volumeMl: actualVolumeMl } };
  }

  const pulsesPerLiter = pulses / (actualVolumeMl / 1000);
  if (
    !Number.isFinite(pulsesPerLiter) ||
    pulsesPerLiter < MIN_PLAUSIBLE_PULSES_PER_LITER ||
    pulsesPerLiter > MAX_PLAUSIBLE_PULSES_PER_LITER
  ) {
    return { ok: false, rejection: { reason: "implausible_factor", pulsesPerLiter } };
  }

  // Signed: positive means the old factor was too low, i.e. the tap had been
  // under-counting how much beer had left the keg.
  const driftPercent = ((pulsesPerLiter - previousPulsesPerLiter) / previousPulsesPerLiter) * 100;

  return { ok: true, pulses, actualVolumeMl, pulsesPerLiter, driftPercent };
}
