import { describe, expect, it } from "vitest";
import { resolveProfileSetpoint } from "./resolve-setpoint.js";

describe("resolveProfileSetpoint", () => {
  const rampProfile = [
    { atMinutes: 0, targetC: 18 },
    { atMinutes: 1440, targetC: 18 },
    { atMinutes: 2880, targetC: 20 },
  ];

  it("holds the first step's value before the profile starts", () => {
    expect(resolveProfileSetpoint(rampProfile, -10)).toBe(18);
    expect(resolveProfileSetpoint(rampProfile, 0)).toBe(18);
  });

  it("holds a flat value across a segment with no temperature change", () => {
    expect(resolveProfileSetpoint(rampProfile, 720)).toBe(18);
  });

  it("returns the exact value at a step boundary", () => {
    expect(resolveProfileSetpoint(rampProfile, 1440)).toBe(18);
    expect(resolveProfileSetpoint(rampProfile, 2880)).toBe(20);
  });

  it("linearly interpolates midway through a ramp", () => {
    expect(resolveProfileSetpoint(rampProfile, 2160)).toBe(19); // halfway between 18 and 20
  });

  it("holds the last step's value after the profile ends", () => {
    expect(resolveProfileSetpoint(rampProfile, 5000)).toBe(20);
  });

  it("sorts unordered input steps before resolving", () => {
    const unordered = [
      { atMinutes: 100, targetC: 20 },
      { atMinutes: 0, targetC: 10 },
    ];
    expect(resolveProfileSetpoint(unordered, 50)).toBe(15);
  });

  it("always returns the single value for a one-step profile", () => {
    const single = [{ atMinutes: 100, targetC: 15 }];
    expect(resolveProfileSetpoint(single, 0)).toBe(15);
    expect(resolveProfileSetpoint(single, 100)).toBe(15);
    expect(resolveProfileSetpoint(single, 99999)).toBe(15);
  });

  it("resolves a near-instant jump using two closely-spaced steps", () => {
    const jump = [
      { atMinutes: 0, targetC: 18 },
      { atMinutes: 100, targetC: 18 },
      { atMinutes: 101, targetC: 22 },
      { atMinutes: 200, targetC: 22 },
    ];
    expect(resolveProfileSetpoint(jump, 100)).toBe(18);
    expect(resolveProfileSetpoint(jump, 101)).toBe(22);
  });

  it("throws for an empty steps array", () => {
    expect(() => resolveProfileSetpoint([], 0)).toThrow();
  });
});
