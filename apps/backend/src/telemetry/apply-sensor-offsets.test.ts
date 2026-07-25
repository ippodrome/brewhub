import { describe, expect, it } from "vitest";
import type { TelemetryPayload } from "@brewhub/shared-types";
import { applySensorOffsets } from "./apply-sensor-offsets.js";

function payloadWith(sensors: TelemetryPayload["sensors"]): TelemetryPayload {
  return { deviceId: "kegerator-01", ts: 1000, sensors, flows: [], weights: [] };
}

describe("applySensorOffsets", () => {
  it("adds each sensor's own offset to its reading", () => {
    const result = applySensorOffsets(
      payloadWith([
        { address: "aa", temperatureC: 6.4 },
        { address: "bb", temperatureC: 20.0 },
      ]),
      new Map([
        ["aa", -0.4],
        ["bb", 0.25],
      ]),
    );

    expect(result.sensors[0]!.temperatureC).toBeCloseTo(6.0);
    expect(result.sensors[1]!.temperatureC).toBeCloseTo(20.25);
  });

  it("leaves a null (faulted) reading null rather than inventing a temperature", () => {
    const result = applySensorOffsets(
      payloadWith([{ address: "aa", temperatureC: null }]),
      new Map([["aa", -0.4]]),
    );

    expect(result.sensors[0]!.temperatureC).toBeNull();
  });

  it("leaves sensors with no configured offset untouched", () => {
    const result = applySensorOffsets(
      payloadWith([
        { address: "aa", temperatureC: 6.4 },
        { address: "unknown", temperatureC: 12.0 },
      ]),
      new Map([["aa", -0.4]]),
    );

    expect(result.sensors[1]!.temperatureC).toBe(12.0);
  });

  it("returns the original payload object when no offset actually applies", () => {
    const payload = payloadWith([{ address: "aa", temperatureC: 6.4 }]);

    expect(applySensorOffsets(payload, new Map())).toBe(payload);
    expect(applySensorOffsets(payload, new Map([["aa", 0]]))).toBe(payload);
  });

  it("does not touch flow or weight readings", () => {
    const payload: TelemetryPayload = {
      deviceId: "kegerator-01",
      ts: 1000,
      sensors: [{ address: "aa", temperatureC: 6.4 }],
      flows: [{ index: 0, pulseCount: 5000 }],
      weights: [{ index: 0, grams: 12000 }],
    };

    const result = applySensorOffsets(payload, new Map([["aa", -0.4]]));

    expect(result.flows).toEqual(payload.flows);
    expect(result.weights).toEqual(payload.weights);
  });
});
