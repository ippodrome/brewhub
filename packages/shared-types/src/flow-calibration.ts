import { z } from "zod";

/**
 * Guided flow-meter calibration. Replaces "type a pulses-per-litre number you
 * got from somewhere into the tap form" with: start a session, pour a known
 * amount, tell the backend what you actually got, and let it do the division.
 *
 * The whole thing is backend-side. Flow telemetry is already a *cumulative*
 * monotonic pulse count (see FlowReadingSchema), so a session only needs to
 * remember the count at the moment it started — no firmware involvement, and
 * no new MQTT traffic.
 */

/**
 * A pour smaller than this can't produce a trustworthy factor: the ±1 pulse
 * quantisation at each end, plus whatever beer clings to the vessel, is a
 * large fraction of a small pour. 500 ml is a pint-ish pour and keeps that
 * error under ~1%.
 */
export const MIN_CALIBRATION_VOLUME_ML = 500;

/** Same argument in the other unit — guards against a flow meter that isn't reporting at all. */
export const MIN_CALIBRATION_PULSES = 100;

/**
 * Plausibility band for the resulting factor. Real hall-effect beverage meters
 * run ~1000–7000 pulses/L (a SF800 is ~5400); this band keeps a wide margin
 * either side so an unusual meter still calibrates, while rejecting results
 * that can only come from a mistyped volume or the wrong meter being poured
 * through.
 *
 * It is a sanity guard, not a precision check — it catches order-of-magnitude
 * nonsense, not a 20% slip. The defence against subtler mistakes is that the
 * result reports driftPercent against the previous factor, so a suspicious
 * change is visible before it matters.
 */
export const MIN_PLAUSIBLE_PULSES_PER_LITER = 500;
export const MAX_PLAUSIBLE_PULSES_PER_LITER = 20_000;

/** Density used to convert a weighed pour to a volume. Water is 1.0; beer is ~1.01 near terminal gravity. */
export const DEFAULT_POUR_DENSITY_G_PER_ML = 1.0;

export const FlowCalibrationSessionSchema = z.object({
  tapId: z.number().int(),
  startedAt: z.number().int(),
  startPulseCount: z.number().int().nonnegative(),
  /** Pulses counted since the session started, i.e. how much has been poured so far. */
  pulsesSoFar: z.number().int().nonnegative(),
  /** What the *current* (about-to-be-replaced) factor thinks has been poured — shown as a live "measured so far" hint. */
  estimatedVolumeMl: z.number().nonnegative(),
});
export type FlowCalibrationSession = z.infer<typeof FlowCalibrationSessionSchema>;

export const FinishFlowCalibrationRequestSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("volume"),
    /** Measured in a jug/cylinder. */
    actualVolumeMl: z.number().positive(),
  }),
  z.object({
    method: z.literal("weight"),
    /** Weighed on a scale — usually more accurate than reading a jug's graduations. */
    actualWeightG: z.number().positive(),
    densityGPerMl: z.number().positive().default(DEFAULT_POUR_DENSITY_G_PER_ML),
  }),
]);
export type FinishFlowCalibrationRequest = z.infer<typeof FinishFlowCalibrationRequestSchema>;

export const FlowCalibrationResultSchema = z.object({
  tapId: z.number().int(),
  pulses: z.number().int().positive(),
  actualVolumeMl: z.number().positive(),
  previousPulsesPerLiter: z.number().positive(),
  pulsesPerLiter: z.number().positive(),
  /** How far off the old factor was, signed, as a percentage — the interesting number for the user. */
  driftPercent: z.number(),
});
export type FlowCalibrationResult = z.infer<typeof FlowCalibrationResultSchema>;
