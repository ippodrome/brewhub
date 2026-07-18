import { describe, expect, it } from "vitest";
import { resolveProfileSetpointByGravity } from "./resolve-setpoint-by-gravity.js";

describe("resolveProfileSetpointByGravity", () => {
  const rampProfile = [
    { atGravitySg: 1.05, targetC: 18 },
    { atGravitySg: 1.03, targetC: 18 },
    { atGravitySg: 1.01, targetC: 20 },
  ];

  it("holds the first step's value at or above the highest gravity threshold", () => {
    expect(resolveProfileSetpointByGravity(rampProfile, 1.06)).toBe(18);
    expect(resolveProfileSetpointByGravity(rampProfile, 1.05)).toBe(18);
  });

  it("holds a flat value across a segment with no temperature change", () => {
    expect(resolveProfileSetpointByGravity(rampProfile, 1.04)).toBe(18);
  });

  it("returns the exact value at a step boundary", () => {
    expect(resolveProfileSetpointByGravity(rampProfile, 1.03)).toBe(18);
    expect(resolveProfileSetpointByGravity(rampProfile, 1.01)).toBe(20);
  });

  it("linearly interpolates midway through a ramp", () => {
    expect(resolveProfileSetpointByGravity(rampProfile, 1.02)).toBe(19); // halfway between 18 and 20
  });

  it("holds the last step's value below the lowest gravity threshold", () => {
    expect(resolveProfileSetpointByGravity(rampProfile, 0.995)).toBe(20);
  });

  it("sorts unordered input steps before resolving", () => {
    const unordered = [
      { atGravitySg: 1.0, targetC: 20 },
      { atGravitySg: 1.05, targetC: 10 },
    ];
    expect(resolveProfileSetpointByGravity(unordered, 1.025)).toBeCloseTo(15);
  });

  it("always returns the single value for a one-step profile", () => {
    const single = [{ atGravitySg: 1.02, targetC: 15 }];
    expect(resolveProfileSetpointByGravity(single, 1.08)).toBe(15);
    expect(resolveProfileSetpointByGravity(single, 1.02)).toBe(15);
    expect(resolveProfileSetpointByGravity(single, 0.99)).toBe(15);
  });

  it("throws for an empty steps array", () => {
    expect(() => resolveProfileSetpointByGravity([], 1.02)).toThrow();
  });
});
