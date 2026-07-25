import { describe, expect, it } from "vitest";
import { checkKick, type KickCandidate } from "./kick-event.js";

function tap(overrides: Partial<KickCandidate> = {}): KickCandidate {
  return {
    id: 1,
    name: "Pale Ale",
    device_id: "kegerator-01",
    kicked_at: null,
    pourVolumeSoFarMl: 1000,
    ...overrides,
  };
}

describe("checkKick", () => {
  it("fires when gas rushes through far faster than beer can pour", () => {
    // 250 mL in 1 s = 250 mL/s — nothing a balanced draft line can do.
    const event = checkKick(tap(), 250, 1000);

    expect(event).not.toBeNull();
    expect(event!.tapName).toBe("Pale Ale");
    expect(event!.rateMlPerS).toBeCloseTo(250);
  });

  it("stays quiet during a normal pour", () => {
    // A pint in ~25 s is about 20 mL/s; here 40 mL over a 2 s tick.
    expect(checkKick(tap(), 40, 2000)).toBeNull();
  });

  it("stays quiet during a fast but legitimate pour", () => {
    // 50 mL/s — a hard pour down the side of the glass, still under threshold.
    expect(checkKick(tap(), 100, 2000)).toBeNull();
  });

  it("ignores a fast tick before the pour has delivered enough to judge", () => {
    // High rate, but only 50 mL in so far — could be meter noise on startup.
    expect(checkKick(tap({ pourVolumeSoFarMl: 50 }), 250, 1000)).toBeNull();
  });

  it("fires only once per keg", () => {
    expect(checkKick(tap({ kicked_at: 1700000000000 }), 250, 1000)).toBeNull();
  });

  it("does not divide by a zero or negative interval", () => {
    expect(checkKick(tap(), 250, 0)).toBeNull();
    expect(checkKick(tap(), 250, -500)).toBeNull();
  });

  it("scales the rate by the interval, not the raw tick volume", () => {
    // Same 250 mL, but spread over 10 s = 25 mL/s — a big gulp, not a kick.
    expect(checkKick(tap(), 250, 10_000)).toBeNull();
    // The same volume over 1 s is.
    expect(checkKick(tap(), 250, 1000)).not.toBeNull();
  });
});
