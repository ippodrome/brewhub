import { describe, expect, it } from "vitest";
import { computeFlowCalibration, resolveActualVolumeMl } from "./compute-flow-calibration.js";

const VOLUME_1L = { method: "volume", actualVolumeMl: 1000 } as const;

describe("resolveActualVolumeMl", () => {
  it("passes a measured volume straight through", () => {
    expect(resolveActualVolumeMl(VOLUME_1L)).toBe(1000);
  });

  it("converts a weighed pour using the supplied density", () => {
    expect(
      resolveActualVolumeMl({ method: "weight", actualWeightG: 1010, densityGPerMl: 1.01 }),
    ).toBeCloseTo(1000);
  });

  it("treats water density as the default for a weighed pour", () => {
    expect(resolveActualVolumeMl({ method: "weight", actualWeightG: 950, densityGPerMl: 1.0 })).toBe(950);
  });
});

describe("computeFlowCalibration", () => {
  it("divides pulses by litres to get the new factor", () => {
    const result = computeFlowCalibration(1000, 6400, 5000, VOLUME_1L);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pulses).toBe(5400);
    expect(result.pulsesPerLiter).toBeCloseTo(5400);
    expect(result.actualVolumeMl).toBe(1000);
  });

  it("scales correctly for a pour that isn't exactly one litre", () => {
    const result = computeFlowCalibration(0, 2700, 5000, { method: "volume", actualVolumeMl: 500 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pulsesPerLiter).toBeCloseTo(5400); // 2700 pulses per 0.5 L
  });

  it("reports how far off the previous factor was, signed", () => {
    const tooLow = computeFlowCalibration(0, 5400, 5000, VOLUME_1L);
    expect(tooLow.ok && tooLow.driftPercent).toBeCloseTo(8);

    const tooHigh = computeFlowCalibration(0, 4600, 5000, VOLUME_1L);
    expect(tooHigh.ok && tooHigh.driftPercent).toBeCloseTo(-8);
  });

  it("agrees between the volume and weight methods for the same pour", () => {
    const byVolume = computeFlowCalibration(0, 5400, 5000, VOLUME_1L);
    const byWeight = computeFlowCalibration(0, 5400, 5000, {
      method: "weight",
      actualWeightG: 1010,
      densityGPerMl: 1.01,
    });

    expect(byVolume.ok && byWeight.ok).toBe(true);
    if (!byVolume.ok || !byWeight.ok) return;
    expect(byWeight.pulsesPerLiter).toBeCloseTo(byVolume.pulsesPerLiter);
  });

  it("rejects a mid-calibration firmware reboot rather than computing from a stale baseline", () => {
    // Device rebooted: cumulative counter went back to near zero.
    const result = computeFlowCalibration(9000, 12, 5000, VOLUME_1L);

    expect(result).toEqual({ ok: false, rejection: { reason: "counter_reset" } });
  });

  it("rejects a pour that produced almost no pulses", () => {
    const result = computeFlowCalibration(0, 12, 5000, VOLUME_1L);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe("too_few_pulses");
  });

  it("rejects a pour too small to calibrate accurately", () => {
    const result = computeFlowCalibration(0, 5400, 5000, { method: "volume", actualVolumeMl: 100 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe("too_little_volume");
  });

  it("rejects a factor below the plausible band for real hardware", () => {
    // 5400 pulses claimed to be 500 litres — a badly mistyped volume.
    const result = computeFlowCalibration(0, 5400, 5000, {
      method: "volume",
      actualVolumeMl: 500_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe("implausible_factor");
  });

  it("rejects a factor above the plausible band for real hardware", () => {
    // 5 000 000 pulses for a half-litre pour — a runaway//noisy input.
    const result = computeFlowCalibration(0, 5_000_000, 5000, {
      method: "volume",
      actualVolumeMl: 500,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.reason).toBe("implausible_factor");
  });

  it("accepts a real SF800-style meter at the low and high ends of the band", () => {
    expect(computeFlowCalibration(0, 1200, 5000, { method: "volume", actualVolumeMl: 1000 }).ok).toBe(
      true,
    );
    expect(computeFlowCalibration(0, 7000, 5000, { method: "volume", actualVolumeMl: 1000 }).ok).toBe(
      true,
    );
  });
});
