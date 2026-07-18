import { describe, expect, it } from "vitest";
import { computeWeightBasedVolume } from "./compute-weight-volume.js";

// tare=4500g (empty keg), full=23500g (full keg) -> 19000g span = 19000mL, 1:1 g-to-mL for clean numbers.
function baseInputs(overrides: Partial<Parameters<typeof computeWeightBasedVolume>[0]> = {}) {
  return {
    currentWeightG: 23500,
    tareWeightG: 4500,
    fullWeightG: 23500,
    fullVolumeMl: 19000,
    ...overrides,
  };
}

describe("computeWeightBasedVolume", () => {
  it("returns full volume at the full-weight calibration point", () => {
    expect(computeWeightBasedVolume(baseInputs())).toBe(19000);
  });

  it("returns zero at the tare-weight calibration point", () => {
    expect(computeWeightBasedVolume(baseInputs({ currentWeightG: 4500 }))).toBe(0);
  });

  it("interpolates linearly between tare and full", () => {
    expect(computeWeightBasedVolume(baseInputs({ currentWeightG: 14000 }))).toBe(9500);
  });

  it("clamps to zero when weight drifts below tare (empty keg settling)", () => {
    expect(computeWeightBasedVolume(baseInputs({ currentWeightG: 4400 }))).toBe(0);
  });

  it("clamps to fullVolumeMl when weight exceeds full (scale noise)", () => {
    expect(computeWeightBasedVolume(baseInputs({ currentWeightG: 23600 }))).toBe(19000);
  });

  it("treats a non-positive calibration span (bad calibration) as empty rather than dividing by zero", () => {
    expect(computeWeightBasedVolume(baseInputs({ tareWeightG: 20000, fullWeightG: 20000 }))).toBe(0);
    expect(computeWeightBasedVolume(baseInputs({ tareWeightG: 25000, fullWeightG: 20000 }))).toBe(0);
  });
});
