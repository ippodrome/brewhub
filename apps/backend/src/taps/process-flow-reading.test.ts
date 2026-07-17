import { describe, expect, it } from "vitest";
import { processFlowReading, type TapPourInput } from "./process-flow-reading.js";

// pulsesPerLiter=500 -> 1 pulse = 1000/500 = 2mL exactly, for clean expected values.
function baseTap(overrides: Partial<TapPourInput> = {}): TapPourInput {
  return {
    lastPulseCount: 100,
    pourInProgressId: null,
    lastActivityAt: null,
    remainingVolumeMl: 5000,
    pulsesPerLiter: 500,
    ...overrides,
  };
}

describe("processFlowReading", () => {
  it("does nothing when pulses are unchanged and no pour is in progress", () => {
    const result = processFlowReading(baseTap(), 100, 1000, 5000);
    expect(result).toEqual({ type: "none" });
  });

  it("does nothing when pulses are unchanged and the pour hasn't been idle long enough", () => {
    const tap = baseTap({ pourInProgressId: 42, lastActivityAt: 900 });
    const result = processFlowReading(tap, 100, 1000, 5000); // idle for only 100ms
    expect(result).toEqual({ type: "none" });
  });

  it("finalizes the pour once idle timeout elapses with no new pulses", () => {
    const tap = baseTap({ pourInProgressId: 42, lastActivityAt: 900 });
    const result = processFlowReading(tap, 100, 6000, 5000); // idle for 5100ms >= 5000ms
    expect(result).toEqual({ type: "finalize_pour", lastPulseCount: 100 });
  });

  it("finalizes exactly at the idle timeout boundary (inclusive)", () => {
    const tap = baseTap({ pourInProgressId: 42, lastActivityAt: 1000 });
    const result = processFlowReading(tap, 100, 6000, 5000); // idle for exactly 5000ms
    expect(result.type).toBe("finalize_pour");
  });

  it("starts a new pour when pulses increase and none was in progress", () => {
    const result = processFlowReading(baseTap(), 150, 1000, 5000); // +50 pulses = 100mL
    expect(result).toEqual({
      type: "start_pour",
      volumeMl: 100,
      lastPulseCount: 150,
      remainingVolumeMl: 4900,
    });
  });

  it("extends an in-progress pour when pulses increase further", () => {
    const tap = baseTap({
      lastPulseCount: 150,
      pourInProgressId: 42,
      lastActivityAt: 1000,
      remainingVolumeMl: 4900,
    });
    const result = processFlowReading(tap, 200, 2000, 5000); // +50 pulses = 100mL more
    expect(result).toEqual({
      type: "extend_pour",
      addedVolumeMl: 100,
      lastPulseCount: 200,
      remainingVolumeMl: 4800,
    });
  });

  it("detects a firmware reboot (counter went backwards) and resyncs, finalizing an in-progress pour", () => {
    const tap = baseTap({ lastPulseCount: 200, pourInProgressId: 42, lastActivityAt: 2000 });
    const result = processFlowReading(tap, 5, 3000, 5000); // counter reset after reboot
    expect(result).toEqual({ type: "resync", lastPulseCount: 5, finalizePour: true });
  });

  it("resyncs on reboot without finalizing when no pour was in progress", () => {
    const tap = baseTap({ lastPulseCount: 200 });
    const result = processFlowReading(tap, 5, 3000, 5000);
    expect(result).toEqual({ type: "resync", lastPulseCount: 5, finalizePour: false });
  });

  it("clamps remaining volume at zero rather than going negative", () => {
    const tap = baseTap({ lastPulseCount: 0, remainingVolumeMl: 50 });
    const result = processFlowReading(tap, 1000, 1000, 5000); // 1000 pulses = 2000mL, more than the 50mL left
    expect(result).toMatchObject({ type: "start_pour", volumeMl: 2000, remainingVolumeMl: 0 });
  });
});
