/**
 * Where a temperature sits on a fixed scale, as a percentage from its left
 * edge — the one calculation behind every marker on the temperature band.
 *
 * Clamped rather than allowed to run off, because the inputs are real sensor
 * readings: a probe that has fallen out of the beer reads room temperature,
 * and a chamber whose compressor has failed keeps climbing. Neither should
 * push a marker outside the track.
 */
export function bandPosition(valueC: number, minC: number, maxC: number): number {
  const span = maxC - minC;
  // A zero-width scale only comes from a bad config, but a display is the
  // last place that should render NaN.
  if (span <= 0) return 0;

  const ratio = (valueC - minC) / span;
  return Math.min(100, Math.max(0, ratio * 100));
}
