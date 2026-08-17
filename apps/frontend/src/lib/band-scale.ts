export interface BandScale {
  minC: number;
  maxC: number;
}

/** Half-width of the default window around the setpoint, in °C. */
const DEFAULT_MARGIN_C = 3;

/** Breathing room kept between an out-of-window reading and the scale end. */
const OVERSHOOT_PADDING_C = 1;

/**
 * The temperature range a band should span.
 *
 * A fixed window around the setpoint is what you want almost always — it
 * keeps the scale steady, so the marker moving means the beer moved rather
 * than the axis rescaling under it. The exception is a reading that falls
 * outside that window: pinning it to the edge would hide exactly the
 * situation worth walking over to look at, so the scale grows to contain it.
 */
export function bandScale(setpointC: number, readingsC: number[]): BandScale {
  const usable = readingsC.filter((c) => Number.isFinite(c));

  let minC = setpointC - DEFAULT_MARGIN_C;
  let maxC = setpointC + DEFAULT_MARGIN_C;

  for (const reading of usable) {
    minC = Math.min(minC, Math.floor(reading - OVERSHOOT_PADDING_C));
    maxC = Math.max(maxC, Math.ceil(reading + OVERSHOOT_PADDING_C));
  }

  return { minC, maxC };
}
