import type { TimeProfileStep } from "@brewhub/shared-types";

/** Same interpolation as the backend's resolveProfileSetpoint, for drawing the "now" marker. */
export function resolveSetpointAt(steps: TimeProfileStep[], minutes: number): number | null {
  const sorted = [...steps].sort((a, b) => a.atMinutes - b.atMinutes);
  const first = sorted[0];
  if (!first) return null;
  if (minutes <= first.atMinutes) return first.targetC;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (minutes >= a.atMinutes && minutes <= b.atMinutes && b.atMinutes > a.atMinutes) {
      return a.targetC + ((b.targetC - a.targetC) * (minutes - a.atMinutes)) / (b.atMinutes - a.atMinutes);
    }
  }
  return sorted[sorted.length - 1]!.targetC;
}
