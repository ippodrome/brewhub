import { describe, expect, it } from "vitest";
import { curvePoints, editTouchesPassedSteps, formatMinutes } from "./profile-steps";

const ORIGINAL = {
  triggerType: "time" as const,
  steps: [
    { atMinutes: 0, targetC: 18 },
    { atMinutes: 1440, targetC: 19 },
    { atMinutes: 4320, targetC: 21 },
  ],
};

describe("editTouchesPassedSteps", () => {
  const progress = { elapsedMinutes: 2000, stepIndex: 1 };

  it("is false when only future steps change", () => {
    const draft = { ...ORIGINAL, steps: [...ORIGINAL.steps.slice(0, 2), { atMinutes: 5000, targetC: 22 }] };
    expect(editTouchesPassedSteps(ORIGINAL, draft, progress)).toBe(false);
  });

  it("is true when a step that already began changes", () => {
    const draft = { ...ORIGINAL, steps: [{ atMinutes: 0, targetC: 17 }, ...ORIGINAL.steps.slice(1)] };
    expect(editTouchesPassedSteps(ORIGINAL, draft, progress)).toBe(true);
  });

  it("is true when a step is inserted into the past", () => {
    const draft = { ...ORIGINAL, steps: [...ORIGINAL.steps, { atMinutes: 600, targetC: 18.5 }] };
    expect(editTouchesPassedSteps(ORIGINAL, draft, progress)).toBe(true);
  });
});

describe("helpers", () => {
  it("formats durations", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(1500)).toBe("1 d 1 h");
  });

  it("extends the curve to the requested end", () => {
    expect(curvePoints(ORIGINAL.steps, 6000)).toEqual([
      [0, 18],
      [1440, 19],
      [4320, 21],
      [6000, 21],
    ]);
  });
});
