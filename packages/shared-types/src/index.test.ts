import { describe, expect, it } from "vitest";
import {
  CreateDeviceRequestSchema,
  DeviceConfigSchema,
  DeviceSchema,
  ProfileSchema,
  StatusPayloadSchema,
  TelemetryPayloadSchema,
  UpdateDeviceConfigRequestSchema,
  WsMessageSchema,
  parseTopic,
  statusTopic,
  telemetryTopic,
  configTopic,
} from "./index.js";

describe("DeviceSchema", () => {
  it("accepts a valid device", () => {
    const result = DeviceSchema.safeParse({
      id: "fermenter-01",
      name: "Fermenter",
      type: "fermenter",
      chamberName: null,
      board: "fermenter-brewpi",
      firmwareVersion: "0.1.0",
      ipAddress: null,
      isOnline: true,
      lastSeenAt: 1700000000000,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid device type", () => {
    const result = DeviceSchema.safeParse({
      id: "x",
      name: "x",
      type: "toaster",
      chamberName: null,
      board: null,
      firmwareVersion: null,
      ipAddress: null,
      isOnline: false,
      lastSeenAt: null,
      createdAt: 0,
      updatedAt: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("CreateDeviceRequestSchema", () => {
  it("requires id, name and type", () => {
    expect(CreateDeviceRequestSchema.safeParse({}).success).toBe(false);
    expect(
      CreateDeviceRequestSchema.safeParse({ id: "a", name: "b", type: "kegerator" }).success,
    ).toBe(true);
  });
});

describe("DeviceConfigSchema", () => {
  it("accepts a valid config", () => {
    const result = DeviceConfigSchema.safeParse({
      setpointC: 18.5,
      hysteresisC: 0.5,
      mode: "thermostat",
      minOnTimeMs: 60000,
      minOffTimeMs: 60000,
      pidGains: { kp: 0, ki: 0, kd: 0 },
      pidWindowMs: 300000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts pid mode with gains", () => {
    const result = DeviceConfigSchema.safeParse({
      setpointC: 18.5,
      hysteresisC: 0.5,
      mode: "pid",
      minOnTimeMs: 60000,
      minOffTimeMs: 60000,
      pidGains: { kp: 10, ki: 0.5, kd: 2 },
      pidWindowMs: 300000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-positive pidWindowMs", () => {
    const result = DeviceConfigSchema.safeParse({
      setpointC: 18.5,
      hysteresisC: 0.5,
      mode: "pid",
      minOnTimeMs: 60000,
      minOffTimeMs: 60000,
      pidGains: { kp: 10, ki: 0.5, kd: 2 },
      pidWindowMs: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-positive hysteresis", () => {
    const result = DeviceConfigSchema.safeParse({
      setpointC: 18.5,
      hysteresisC: 0,
      mode: "thermostat",
      minOnTimeMs: 60000,
      minOffTimeMs: 60000,
      pidGains: { kp: 0, ki: 0, kd: 0 },
      pidWindowMs: 300000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid mode", () => {
    const result = DeviceConfigSchema.safeParse({
      setpointC: 18.5,
      hysteresisC: 0.5,
      mode: "cool_mode",
      minOnTimeMs: 60000,
      minOffTimeMs: 60000,
    });
    expect(result.success).toBe(false);
  });
});

describe("TelemetryPayloadSchema", () => {
  it("accepts a null temperature (sensor fault)", () => {
    const result = TelemetryPayloadSchema.safeParse({
      deviceId: "fermenter-01",
      ts: 1700000000000,
      temperatureC: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing deviceId", () => {
    const result = TelemetryPayloadSchema.safeParse({
      ts: 1700000000000,
      temperatureC: 18.2,
    });
    expect(result.success).toBe(false);
  });
});

describe("StatusPayloadSchema", () => {
  it("rejects a negative uptime", () => {
    const result = StatusPayloadSchema.safeParse({
      deviceId: "fermenter-01",
      online: true,
      firmwareVersion: "0.1.0",
      uptimeS: -1,
      ts: 1700000000000,
    });
    expect(result.success).toBe(false);
  });
});

describe("UpdateDeviceConfigRequestSchema", () => {
  it("accepts a partial update with only mode", () => {
    expect(UpdateDeviceConfigRequestSchema.safeParse({ mode: "pid" }).success).toBe(true);
  });

  it("accepts activateProfileId alongside a partial update", () => {
    const result = UpdateDeviceConfigRequestSchema.safeParse({ activeProfileId: 5 });
    expect(result.success).toBe(true);
  });

  it("accepts explicitly clearing the active profile", () => {
    const result = UpdateDeviceConfigRequestSchema.safeParse({ activeProfileId: null });
    expect(result.success).toBe(true);
  });
});

describe("ProfileSchema", () => {
  it("accepts a profile with multiple steps", () => {
    const result = ProfileSchema.safeParse({
      id: 1,
      deviceId: "fermenter-01",
      name: "Diacetyl rest",
      steps: [
        { atMinutes: 0, targetC: 18 },
        { atMinutes: 4320, targetC: 18 },
        { atMinutes: 4320, targetC: 20 },
      ],
      createdAt: 1700000000000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a profile with zero steps", () => {
    const result = ProfileSchema.safeParse({
      id: 1,
      deviceId: "fermenter-01",
      name: "Empty",
      steps: [],
      createdAt: 1700000000000,
    });
    expect(result.success).toBe(false);
  });
});

describe("WsMessageSchema", () => {
  it("discriminates telemetry messages", () => {
    const result = WsMessageSchema.safeParse({
      type: "telemetry",
      payload: { deviceId: "fermenter-01", ts: 1700000000000, temperatureC: 19.1 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown message type", () => {
    const result = WsMessageSchema.safeParse({ type: "bogus", payload: {} });
    expect(result.success).toBe(false);
  });
});

describe("mqtt-topics", () => {
  it("builds topics for a device", () => {
    expect(statusTopic("fermenter-01")).toBe("unibrew/fermenter-01/status");
    expect(telemetryTopic("fermenter-01")).toBe("unibrew/fermenter-01/telemetry");
    expect(configTopic("fermenter-01")).toBe("unibrew/fermenter-01/config");
  });

  it("parses a valid topic", () => {
    expect(parseTopic("unibrew/fermenter-01/telemetry")).toEqual({
      deviceId: "fermenter-01",
      kind: "telemetry",
    });
  });

  it("returns null for discovery and malformed topics", () => {
    expect(parseTopic("unibrew/discovery")).toBeNull();
    expect(parseTopic("other/fermenter-01/telemetry")).toBeNull();
    expect(parseTopic("unibrew/fermenter-01/bogus")).toBeNull();
  });
});
