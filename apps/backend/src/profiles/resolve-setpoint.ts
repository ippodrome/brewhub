import type { ProfileStep } from "@brewhub/shared-types";

/**
 * Linear interpolation between consecutive profile steps, sorted by
 * atMinutes. Before the first step's time, holds the first step's value;
 * after the last step's time, holds the last step's value (no extrapolation).
 */
export function resolveProfileSetpoint(steps: ProfileStep[], elapsedMinutes: number): number {
  const sorted = [...steps].sort((a, b) => a.atMinutes - b.atMinutes);
  const first = sorted[0];
  if (!first) {
    throw new Error("resolveProfileSetpoint requires at least one step");
  }

  if (elapsedMinutes <= first.atMinutes) {
    return first.targetC;
  }

  const last = sorted[sorted.length - 1]!;
  if (elapsedMinutes >= last.atMinutes) {
    return last.targetC;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (elapsedMinutes >= a.atMinutes && elapsedMinutes <= b.atMinutes && b.atMinutes > a.atMinutes) {
      const fraction = (elapsedMinutes - a.atMinutes) / (b.atMinutes - a.atMinutes);
      return a.targetC + (b.targetC - a.targetC) * fraction;
    }
  }

  // Unreachable given the bounds checks above; keeps the function total.
  return last.targetC;
}
