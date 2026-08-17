import { describe, expect, test } from "vitest";
import { litresFrom, tapFillPercent } from "./taps";

describe("tapFillPercent", () => {
  test("reports a full keg as full", () => {
    expect(tapFillPercent(19_000, 19_000)).toBe(100);
  });

  test("reports an empty keg as empty", () => {
    expect(tapFillPercent(0, 19_000)).toBe(0);
  });

  test("reports the fraction poured so far", () => {
    expect(tapFillPercent(9_500, 19_000)).toBe(50);
  });

  // Flow meters overcount when a line is purged, and a keg filled past its
  // nominal volume is ordinary. Neither should draw a bar past its track.
  test("clamps a reading above the keg's full volume", () => {
    expect(tapFillPercent(21_000, 19_000)).toBe(100);
  });

  // Pouring after the meter thinks the keg is empty produces a negative
  // remainder, which would otherwise render as a bar growing leftwards.
  test("clamps a negative remainder to empty", () => {
    expect(tapFillPercent(-500, 19_000)).toBe(0);
  });

  test("treats a keg with no stated volume as empty rather than dividing by zero", () => {
    expect(tapFillPercent(5_000, 0)).toBe(0);
  });
});

describe("litresFrom", () => {
  test("converts millilitres to litres at one decimal", () => {
    expect(litresFrom(11_400)).toBe("11.4");
  });

  test("keeps the decimal on a whole number of litres", () => {
    expect(litresFrom(19_000)).toBe("19.0");
  });

  test("rounds to the nearest tenth", () => {
    expect(litresFrom(11_449)).toBe("11.4");
  });

  // A tap that has poured past empty should read as empty, not as a
  // negative quantity of beer.
  test("never reports a negative volume", () => {
    expect(litresFrom(-300)).toBe("0.0");
  });
});
