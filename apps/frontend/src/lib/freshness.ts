/**
 * Whether a live reading can still be trusted.
 *
 * This exists for the wall display specifically. A dashboard you glance at
 * for five seconds reveals its own staleness by being closed again; a tablet
 * left running next to a fermenter can sit for hours showing a number that
 * stopped updating, and looks identical to one that is working. Telling those
 * two apart is the whole job.
 */
export type Freshness = "live" | "stale" | "never";

export function freshnessOf(
  lastUpdateMs: number | null,
  nowMs: number,
  staleAfterMs: number,
): Freshness {
  if (lastUpdateMs === null) return "never";

  // Devices stamp telemetry with their own clock, which is not the browser's.
  // A device running a few seconds ahead produces a negative age; that is a
  // clock difference, not a fault, so it stays live.
  const ageMs = nowMs - lastUpdateMs;
  return ageMs >= staleAfterMs ? "stale" : "live";
}
