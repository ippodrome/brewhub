import type { GravityProfileStep } from "@brewhub/shared-types";

/**
 * Linear interpolation between consecutive profile steps, sorted by
 * atGravitySg — same algorithm as resolveProfileSetpoint (resolve-setpoint.ts),
 * just keyed on measured gravity instead of elapsed time. Steps are
 * naturally authored high-to-low (OG down to FG) since gravity falls over
 * the course of fermentation, but sorting/interpolating ascending works
 * regardless of that real-world direction, the same way the time-based
 * resolver doesn't care that time only increases. Before the first step's
 * gravity, holds the first step's value; past the last step's gravity,
 * holds the last step's value (no extrapolation).
 */
export function resolveProfileSetpointByGravity(steps: GravityProfileStep[], currentSg: number): number {
  const sorted = [...steps].sort((a, b) => a.atGravitySg - b.atGravitySg);
  const first = sorted[0];
  if (!first) {
    throw new Error("resolveProfileSetpointByGravity requires at least one step");
  }

  if (currentSg <= first.atGravitySg) {
    return first.targetC;
  }

  const last = sorted[sorted.length - 1]!;
  if (currentSg >= last.atGravitySg) {
    return last.targetC;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (currentSg >= a.atGravitySg && currentSg <= b.atGravitySg && b.atGravitySg > a.atGravitySg) {
      const fraction = (currentSg - a.atGravitySg) / (b.atGravitySg - a.atGravitySg);
      return a.targetC + (b.targetC - a.targetC) * fraction;
    }
  }

  // Unreachable given the bounds checks above; keeps the function total.
  return last.targetC;
}
