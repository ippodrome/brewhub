import type { Hydrometer } from "@brewhub/shared-types";

/** correctedSG = rawSG * slope + offset — a simple linear correction, applied once at ingest. */
export function applyCalibration(hydrometer: Hydrometer, rawSg: number | null): number | null {
  if (rawSg === null) return null;
  return rawSg * hydrometer.calibrationSlope + hydrometer.calibrationOffset;
}
