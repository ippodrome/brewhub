import { describe, expect, test } from "vitest";
import { bandPosition } from "./temperature-band";

describe("bandPosition", () => {
  test("puts the scale minimum at the left edge", () => {
    expect(bandPosition(16, 16, 22)).toBe(0);
  });

  test("puts the scale maximum at the right edge", () => {
    expect(bandPosition(22, 16, 22)).toBe(100);
  });

  test("puts the midpoint halfway across", () => {
    expect(bandPosition(19, 16, 22)).toBe(50);
  });

  test("interpolates linearly between the ends", () => {
    expect(bandPosition(17.5, 16, 22)).toBeCloseTo(25, 10);
  });

  // A fermentation chamber that has run away, or a probe reading room
  // temperature after falling out of the beer, must not push its marker
  // outside the track and off the card.
  test("clamps a reading below the scale to the left edge", () => {
    expect(bandPosition(4, 16, 22)).toBe(0);
  });

  test("clamps a reading above the scale to the right edge", () => {
    expect(bandPosition(45, 16, 22)).toBe(100);
  });

  // A zero-width scale would divide by zero. It can only happen through a
  // bad config, but the display is the last place that should render NaN.
  test("returns the left edge when the scale has no width", () => {
    expect(bandPosition(19, 19, 19)).toBe(0);
  });
});
