import { describe, expect, it } from "vitest";
import {
  CreateDeviceRequestSchema,
  CreateFirmwareBuildRequestSchema,
  CreatePushSubscriptionRequestSchema,
  CreateTapRequestSchema,
  DeviceConfigSchema,
  DeviceSchema,
  DeviceSensorSchema,
  DiscoveredDeviceSchema,
  DiscoveryMessageSchema,
  FirmwareBuildSchema,
  FlowReadingSchema,
  NotificationSettingsSchema,
  OtaMessageSchema,
  PourEventSchema,
  ProfileSchema,
  SensorReadingSchema,
  StatusPayloadSchema,
  TapSchema,
  TelemetryPayloadSchema,
  TriggerOtaRequestSchema,
  UpdateDeviceConfigRequestSchema,
  UpdateDeviceSensorRequestSchema,
  UpdateNotificationSettingsRequestSchema,
  UpdateTapRequestSchema,
  WeightReadingSchema,
  WsMessageSchema,
  parseTopic,
  statusTopic,
  telemetryTopic,
  configTopic,
  otaTopic,
  discoveryTopic,
  boardToDeviceType,
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

  it("accepts the keg_scale device type", () => {
    const result = DeviceSchema.safeParse({
      id: "keg-scale-01",
      name: "Keg Scale",
      type: "keg_scale",
      chamberName: null,
      board: null,
      firmwareVersion: null,
      ipAddress: null,
      isOnline: true,
      lastSeenAt: null,
      createdAt: 0,
      updatedAt: 0,
    });
    expect(result.success).toBe(true);
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
      controlSensorAddress: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts pid mode with gains and a control sensor address", () => {
    const result = DeviceConfigSchema.safeParse({
      setpointC: 18.5,
      hysteresisC: 0.5,
      mode: "pid",
      minOnTimeMs: 60000,
      minOffTimeMs: 60000,
      pidGains: { kp: 10, ki: 0.5, kd: 2 },
      pidWindowMs: 300000,
      controlSensorAddress: "28FF641F0417033A",
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

  it("accepts a tareRequestId (keg_scale devices)", () => {
    const result = DeviceConfigSchema.safeParse({
      setpointC: 18.5,
      hysteresisC: 0.5,
      mode: "off",
      minOnTimeMs: 60000,
      minOffTimeMs: 60000,
      pidGains: { kp: 0, ki: 0, kd: 0 },
      pidWindowMs: 300000,
      controlSensorAddress: null,
      tareRequestId: 1700000000000,
    });
    expect(result.success).toBe(true);
  });

  it("defaults controlSensorOffsetC to 0 when absent (a pre-calibration config is uncalibrated, not invalid)", () => {
    const result = DeviceConfigSchema.safeParse({
      setpointC: 18.5,
      hysteresisC: 0.5,
      mode: "thermostat",
      minOnTimeMs: 60000,
      minOffTimeMs: 60000,
      pidGains: { kp: 0, ki: 0, kd: 0 },
      pidWindowMs: 300000,
      controlSensorAddress: null,
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.controlSensorOffsetC).toBe(0);
  });

  it("keeps an explicit controlSensorOffsetC", () => {
    const result = DeviceConfigSchema.safeParse({
      setpointC: 18.5,
      hysteresisC: 0.5,
      mode: "thermostat",
      minOnTimeMs: 60000,
      minOffTimeMs: 60000,
      pidGains: { kp: 0, ki: 0, kd: 0 },
      pidWindowMs: 300000,
      controlSensorAddress: null,
      controlSensorOffsetC: -0.4,
    });
    expect(result.success && result.data.controlSensorOffsetC).toBe(-0.4);
  });

  it("omits tareRequestId without failing (optional, inert for non-scale devices)", () => {
    const result = DeviceConfigSchema.safeParse({
      setpointC: 18.5,
      hysteresisC: 0.5,
      mode: "thermostat",
      minOnTimeMs: 60000,
      minOffTimeMs: 60000,
      pidGains: { kp: 0, ki: 0, kd: 0 },
      pidWindowMs: 300000,
      controlSensorAddress: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("SensorReadingSchema", () => {
  it("accepts a null temperature (sensor fault)", () => {
    expect(SensorReadingSchema.safeParse({ address: "28FF641F0417033A", temperatureC: null }).success).toBe(
      true,
    );
  });

  it("rejects a missing address", () => {
    expect(SensorReadingSchema.safeParse({ temperatureC: 18.2 }).success).toBe(false);
  });
});

describe("TelemetryPayloadSchema", () => {
  it("accepts multiple sensor readings", () => {
    const result = TelemetryPayloadSchema.safeParse({
      deviceId: "fermenter-01",
      ts: 1700000000000,
      sensors: [
        { address: "28FF641F0417033A", temperatureC: 18.2 },
        { address: "28AA112233445566", temperatureC: null },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts zero sensors (device with none discovered yet)", () => {
    const result = TelemetryPayloadSchema.safeParse({
      deviceId: "fermenter-01",
      ts: 1700000000000,
      sensors: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing deviceId", () => {
    const result = TelemetryPayloadSchema.safeParse({
      ts: 1700000000000,
      sensors: [{ address: "28FF641F0417033A", temperatureC: 18.2 }],
    });
    expect(result.success).toBe(false);
  });

  it("defaults flows to an empty array when omitted (backward compat)", () => {
    const result = TelemetryPayloadSchema.parse({
      deviceId: "fermenter-01",
      ts: 1700000000000,
      sensors: [],
    });
    expect(result.flows).toEqual([]);
  });

  it("accepts flow readings", () => {
    const result = TelemetryPayloadSchema.safeParse({
      deviceId: "kegerator-01",
      ts: 1700000000000,
      sensors: [],
      flows: [
        { index: 0, pulseCount: 1523 },
        { index: 1, pulseCount: 0 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("defaults weights to an empty array when omitted (backward compat)", () => {
    const result = TelemetryPayloadSchema.parse({
      deviceId: "fermenter-01",
      ts: 1700000000000,
      sensors: [],
    });
    expect(result.weights).toEqual([]);
  });

  it("accepts weight readings", () => {
    const result = TelemetryPayloadSchema.safeParse({
      deviceId: "keg-scale-01",
      ts: 1700000000000,
      sensors: [],
      weights: [{ index: 0, grams: 18300 }],
    });
    expect(result.success).toBe(true);
  });
});

describe("FlowReadingSchema", () => {
  it("rejects an out-of-range index", () => {
    expect(FlowReadingSchema.safeParse({ index: 9, pulseCount: 0 }).success).toBe(false);
    expect(FlowReadingSchema.safeParse({ index: -1, pulseCount: 0 }).success).toBe(false);
  });

  it("rejects a negative pulse count", () => {
    expect(FlowReadingSchema.safeParse({ index: 0, pulseCount: -1 }).success).toBe(false);
  });
});

describe("WeightReadingSchema", () => {
  it("rejects a negative index", () => {
    expect(WeightReadingSchema.safeParse({ index: -1, grams: 0 }).success).toBe(false);
  });

  it("accepts a negative grams value (scale drift below tare)", () => {
    expect(WeightReadingSchema.safeParse({ index: 0, grams: -12.5 }).success).toBe(true);
  });

  it("accepts null grams (HX711 not ready / sensor fault)", () => {
    expect(WeightReadingSchema.safeParse({ index: 0, grams: null }).success).toBe(true);
  });
});

describe("TapSchema", () => {
  it("accepts a fully-populated flow-measured tap", () => {
    const result = TapSchema.safeParse({
      id: 1,
      deviceId: "kegerator-01",
      measurementType: "flow",
      flowIndex: 0,
      pulsesPerLiter: 450,
      weightDeviceId: null,
      weightIndex: null,
      tareWeightG: null,
      fullWeightG: null,
      name: "House IPA",
      style: "IPA",
      abv: 6.2,
      ibu: 55,
      notes: "Dry-hopped with Citra",
      imageUrl: null,
      fullVolumeMl: 19000,
      remainingVolumeMl: 12000,
      createdAt: 1700000000000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a fully-populated weight-measured tap", () => {
    const result = TapSchema.safeParse({
      id: 2,
      deviceId: "kegerator-01",
      measurementType: "weight",
      flowIndex: null,
      pulsesPerLiter: null,
      weightDeviceId: "keg-scale-01",
      weightIndex: 0,
      tareWeightG: 4500,
      fullWeightG: 23500,
      name: "Stout",
      style: null,
      abv: null,
      ibu: null,
      notes: null,
      imageUrl: null,
      fullVolumeMl: 19000,
      remainingVolumeMl: 19000,
      createdAt: 1700000000000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-positive pulsesPerLiter", () => {
    const result = TapSchema.safeParse({
      id: 1,
      deviceId: "kegerator-01",
      measurementType: "flow",
      flowIndex: 0,
      pulsesPerLiter: 0,
      weightDeviceId: null,
      weightIndex: null,
      tareWeightG: null,
      fullWeightG: null,
      name: "House IPA",
      style: null,
      abv: null,
      ibu: null,
      notes: null,
      imageUrl: null,
      fullVolumeMl: 19000,
      remainingVolumeMl: 19000,
      createdAt: 1700000000000,
    });
    expect(result.success).toBe(false);
  });
});

describe("CreateTapRequestSchema / UpdateTapRequestSchema", () => {
  it("requires measurementType, and rejects an empty body", () => {
    expect(CreateTapRequestSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a valid flow-measured create request", () => {
    expect(
      CreateTapRequestSchema.safeParse({
        measurementType: "flow",
        flowIndex: 0,
        name: "House IPA",
        pulsesPerLiter: 450,
        fullVolumeMl: 19000,
      }).success,
    ).toBe(true);
  });

  it("accepts a valid weight-measured create request", () => {
    expect(
      CreateTapRequestSchema.safeParse({
        measurementType: "weight",
        weightDeviceId: "keg-scale-01",
        weightIndex: 0,
        tareWeightG: 4500,
        fullWeightG: 23500,
        name: "Stout",
        fullVolumeMl: 19000,
      }).success,
    ).toBe(true);
  });

  it("rejects a flow create request carrying weight fields instead of flow fields", () => {
    expect(
      CreateTapRequestSchema.safeParse({
        measurementType: "flow",
        weightDeviceId: "keg-scale-01",
        weightIndex: 0,
        tareWeightG: 4500,
        fullWeightG: 23500,
        name: "Stout",
        fullVolumeMl: 19000,
      }).success,
    ).toBe(false);
  });

  it("accepts resetKeg on an otherwise-empty update", () => {
    expect(UpdateTapRequestSchema.safeParse({ resetKeg: true }).success).toBe(true);
  });
});

describe("PourEventSchema", () => {
  it("rejects a non-positive volume", () => {
    const result = PourEventSchema.safeParse({
      id: 1,
      tapId: 1,
      volumeMl: 0,
      startedAt: 1700000000000,
      endedAt: 1700000001000,
    });
    expect(result.success).toBe(false);
  });
});

describe("DeviceSensorSchema", () => {
  it("accepts a labeled control sensor", () => {
    const result = DeviceSensorSchema.safeParse({
      deviceId: "fermenter-01",
      address: "28FF641F0417033A",
      label: "Beer",
      isControlSensor: true,
      lastSeenAt: 1700000000000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts an unlabeled newly-discovered sensor", () => {
    const result = DeviceSensorSchema.safeParse({
      deviceId: "fermenter-01",
      address: "28FF641F0417033A",
      label: null,
      isControlSensor: false,
      lastSeenAt: null,
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.offsetC).toBe(0); // uncalibrated by default
  });

  it("keeps an explicit calibration offset", () => {
    const result = DeviceSensorSchema.safeParse({
      deviceId: "fermenter-01",
      address: "28FF641F0417033A",
      label: "Beer",
      isControlSensor: true,
      lastSeenAt: 1700000000000,
      offsetC: -0.4,
    });
    expect(result.success && result.data.offsetC).toBe(-0.4);
  });
});

describe("UpdateDeviceSensorRequestSchema", () => {
  it("accepts a label-only update", () => {
    expect(UpdateDeviceSensorRequestSchema.safeParse({ label: "Fridge" }).success).toBe(true);
  });

  it("accepts an offset-only update", () => {
    expect(UpdateDeviceSensorRequestSchema.safeParse({ offsetC: -0.4 }).success).toBe(true);
  });

  it("rejects an offset beyond the plausible band (a broken sensor, not a miscalibrated one)", () => {
    expect(UpdateDeviceSensorRequestSchema.safeParse({ offsetC: 25 }).success).toBe(false);
    expect(UpdateDeviceSensorRequestSchema.safeParse({ offsetC: -25 }).success).toBe(false);
  });

  it("accepts an empty update", () => {
    expect(UpdateDeviceSensorRequestSchema.safeParse({}).success).toBe(true);
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
  it("accepts a time-triggered profile with multiple steps", () => {
    const result = ProfileSchema.safeParse({
      id: 1,
      deviceId: "fermenter-01",
      name: "Diacetyl rest",
      triggerType: "time",
      steps: [
        { atMinutes: 0, targetC: 18 },
        { atMinutes: 4320, targetC: 18 },
        { atMinutes: 4320, targetC: 20 },
      ],
      createdAt: 1700000000000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a gravity-triggered profile with multiple steps", () => {
    const result = ProfileSchema.safeParse({
      id: 2,
      deviceId: "fermenter-01",
      name: "Ramp up near FG",
      triggerType: "gravity",
      steps: [
        { atGravitySg: 1.05, targetC: 18 },
        { atGravitySg: 1.015, targetC: 20 },
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
      triggerType: "time",
      steps: [],
      createdAt: 1700000000000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a profile missing triggerType", () => {
    const result = ProfileSchema.safeParse({
      id: 1,
      deviceId: "fermenter-01",
      name: "No trigger type",
      steps: [{ atMinutes: 0, targetC: 18 }],
      createdAt: 1700000000000,
    });
    expect(result.success).toBe(false);
  });
});

describe("WsMessageSchema", () => {
  it("discriminates telemetry messages", () => {
    const result = WsMessageSchema.safeParse({
      type: "telemetry",
      payload: {
        deviceId: "fermenter-01",
        ts: 1700000000000,
        sensors: [{ address: "28FF641F0417033A", temperatureC: 19.1 }],
      },
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
    expect(otaTopic("fermenter-01")).toBe("unibrew/fermenter-01/ota");
    expect(discoveryTopic("fermenter-01")).toBe("unibrew/fermenter-01/discovery");
  });

  it("parses a valid topic", () => {
    expect(parseTopic("unibrew/fermenter-01/telemetry")).toEqual({
      deviceId: "fermenter-01",
      kind: "telemetry",
    });
  });

  it("parses a discovery topic (per-device, not claude.md's original single shared topic sketch)", () => {
    expect(parseTopic("unibrew/fermenter-01/discovery")).toEqual({
      deviceId: "fermenter-01",
      kind: "discovery",
    });
  });

  it("returns null for the old single-shared-topic sketch and malformed topics", () => {
    expect(parseTopic("unibrew/discovery")).toBeNull();
    expect(parseTopic("other/fermenter-01/telemetry")).toBeNull();
    expect(parseTopic("unibrew/fermenter-01/bogus")).toBeNull();
  });
});

describe("boardToDeviceType", () => {
  it("maps every firmware board to its device type", () => {
    expect(boardToDeviceType("fermenter-brewpi")).toBe("fermenter");
    expect(boardToDeviceType("kegerator-kegcop")).toBe("kegerator");
    expect(boardToDeviceType("keg-scale")).toBe("keg_scale");
  });
});

describe("DiscoveryMessageSchema / DiscoveredDeviceSchema", () => {
  it("accepts a valid discovery message", () => {
    const result = DiscoveryMessageSchema.safeParse({
      deviceId: "fermenter-01",
      board: "fermenter-brewpi",
      firmwareVersion: "0.1.0",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown board", () => {
    const result = DiscoveryMessageSchema.safeParse({
      deviceId: "fermenter-01",
      board: "toaster-9000",
      firmwareVersion: "0.1.0",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid discovered-device row", () => {
    const result = DiscoveredDeviceSchema.safeParse({
      deviceId: "fermenter-01",
      board: "fermenter-brewpi",
      firmwareVersion: "0.1.0",
      firstSeenAt: 1700000000000,
      lastSeenAt: 1700000005000,
    });
    expect(result.success).toBe(true);
  });
});

describe("FirmwareBuildSchema", () => {
  it("accepts a valid build", () => {
    const result = FirmwareBuildSchema.safeParse({
      id: 1,
      deviceId: "fermenter-01",
      board: "fermenter-brewpi",
      version: "0.2.0",
      filename: "abc123.bin",
      sizeBytes: 987654,
      md5: "d41d8cd98f00b204e9800998ecf8427e",
      uploadedAt: 1700000000000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown board", () => {
    const result = FirmwareBuildSchema.safeParse({
      id: 1,
      deviceId: "fermenter-01",
      board: "toaster-9000",
      version: "0.2.0",
      filename: "abc123.bin",
      sizeBytes: 987654,
      md5: "d41d8cd98f00b204e9800998ecf8427e",
      uploadedAt: 1700000000000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed md5 (wrong length)", () => {
    const result = FirmwareBuildSchema.safeParse({
      id: 1,
      deviceId: "fermenter-01",
      board: "fermenter-brewpi",
      version: "0.2.0",
      filename: "abc123.bin",
      sizeBytes: 987654,
      md5: "tooshort",
      uploadedAt: 1700000000000,
    });
    expect(result.success).toBe(false);
  });
});

describe("CreateFirmwareBuildRequestSchema", () => {
  it("requires deviceId, board and version", () => {
    expect(CreateFirmwareBuildRequestSchema.safeParse({}).success).toBe(false);
    expect(
      CreateFirmwareBuildRequestSchema.safeParse({
        deviceId: "fermenter-01",
        board: "fermenter-brewpi",
        version: "0.2.0",
      }).success,
    ).toBe(true);
  });
});

describe("TriggerOtaRequestSchema", () => {
  it("requires an integer firmwareId", () => {
    expect(TriggerOtaRequestSchema.safeParse({}).success).toBe(false);
    expect(TriggerOtaRequestSchema.safeParse({ firmwareId: 1.5 }).success).toBe(false);
    expect(TriggerOtaRequestSchema.safeParse({ firmwareId: 1 }).success).toBe(true);
  });
});

describe("OtaMessageSchema", () => {
  it("accepts a valid OTA message", () => {
    const result = OtaMessageSchema.safeParse({
      version: "0.2.0",
      url: "https://192.168.1.50:8443/api/firmware/1/download?token=abc",
      md5: "d41d8cd98f00b204e9800998ecf8427e",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing md5", () => {
    const result = OtaMessageSchema.safeParse({
      version: "0.2.0",
      url: "https://192.168.1.50:8443/api/firmware/1/download?token=abc",
    });
    expect(result.success).toBe(false);
  });
});

describe("CreatePushSubscriptionRequestSchema", () => {
  it("accepts a valid browser PushSubscription shape", () => {
    const result = CreatePushSubscriptionRequestSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys: { p256dh: "key-data", auth: "auth-data" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing keys", () => {
    const result = CreatePushSubscriptionRequestSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    });
    expect(result.success).toBe(false);
  });
});

describe("NotificationSettingsSchema / UpdateNotificationSettingsRequestSchema", () => {
  it("accepts all-null settings (nothing configured yet)", () => {
    const result = NotificationSettingsSchema.safeParse({
      vapidPublicKey: null,
      telegramBotToken: null,
      telegramChatId: null,
      discordWebhookUrl: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a partial update", () => {
    expect(UpdateNotificationSettingsRequestSchema.safeParse({ discordWebhookUrl: "https://discord.com/api/webhooks/x" }).success).toBe(true);
    expect(UpdateNotificationSettingsRequestSchema.safeParse({}).success).toBe(true);
  });

  it("accepts explicitly clearing a field with null", () => {
    expect(UpdateNotificationSettingsRequestSchema.safeParse({ telegramBotToken: null }).success).toBe(true);
  });
});
