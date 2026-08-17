import { describe, expect, test } from "vitest";
import { bandScale } from "./band-scale";

describe("bandScale", () => {
  test("centres a comfortable window on the setpoint when every reading is close", () => {
    expect(bandScale(19, [19.2, 18.6])).toEqual({ minC: 16, maxC: 22 });
  });

  // The point of the band is to show where the beer is. A scale that cannot
  // contain the reading pins the marker to the edge and hides the very thing
  // you walked over to look at.
  test("widens to contain a reading above the default window", () => {
    const scale = bandScale(19, [28]);
    expect(scale.maxC).toBeGreaterThanOrEqual(28);
  });

  test("widens to contain a reading below the default window", () => {
    const scale = bandScale(19, [4]);
    expect(scale.minC).toBeLessThanOrEqual(4);
  });

  test("keeps the setpoint inside the scale even with no readings at all", () => {
    const scale = bandScale(19, []);
    expect(scale.minC).toBeLessThan(19);
    expect(scale.maxC).toBeGreaterThan(19);
  });

  // Sensors drop out; a fermenter with an unplugged probe still has to draw.
  test("ignores readings that are not numbers", () => {
    expect(bandScale(19, [NaN, 19.4])).toEqual({ minC: 16, maxC: 22 });
  });

  test("always produces a scale with width", () => {
    const scale = bandScale(19, [19]);
    expect(scale.maxC).toBeGreaterThan(scale.minC);
  });
});
