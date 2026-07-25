import { z } from "zod";

export const ControlModeSchema = z.enum(["off", "thermostat", "pid"]);
export type ControlModeValue = z.infer<typeof ControlModeSchema>;

export const PidGainsSchema = z.object({
  kp: z.number(),
  ki: z.number(),
  kd: z.number(),
});
export type PidGainsValue = z.infer<typeof PidGainsSchema>;

/**
 * Full device configuration. This is both the shape published (retained) to
 * unibrew/{deviceId}/config, and the canonical stored config — the backend
 * never sends anything else to a device (see DECISIONS.md ADR-004).
 *
 * "profile" is deliberately NOT a mode here — a profile is a setpoint
 * *source*, not a control algorithm. When a device is following a profile,
 * the backend's resolution scheduler periodically recomputes setpointC and
 * republishes this same config shape; the firmware never needs to know a
 * profile exists.
 */
export const DeviceConfigSchema = z.object({
  setpointC: z.number(),
  hysteresisC: z.number().positive(),
  mode: ControlModeSchema,
  minOnTimeMs: z.number().int().nonnegative(),
  minOffTimeMs: z.number().int().nonnegative(),
  pidGains: PidGainsSchema,
  pidWindowMs: z.number().int().positive(),
  // Which discovered sensor's reading feeds the control loop. Null until a
  // sensor has actually been discovered and one is designated (defaults to
  // the first-ever sensor seen for the device — see device-sensors backend
  // logic) — firmware falls back to its first reading if null/unmatched.
  controlSensorAddress: z.string().nullable(),
  /**
   * Calibration correction for the control sensor, in °C, added to its raw
   * reading before the firmware's control loop sees it. Mirrors the
   * DeviceSensor.offsetC of whichever sensor is currently designated the
   * control sensor — the backend keeps the two in sync (see ADR-020).
   *
   * It lives in the device config rather than being applied backend-side
   * because ADR-004 puts the control loop on the ESP32: a correction the
   * backend applied to its own copy of the reading would never reach the
   * thing actually deciding when the compressor runs, and would survive
   * neither an MQTT outage nor a backend restart.
   *
   * Defaults to 0 when absent, mirroring the column's own DEFAULT: a config
   * that predates calibration is an uncalibrated one, not an invalid one.
   */
  controlSensorOffsetC: z.number().default(0),
  /**
   * Relay wiring polarity: true when the relay module energizes on a LOW
   * output (the common case for opto-isolated boards), false for active-high.
   * Null means "use whatever the board's compiled-in default says" — so an
   * existing device keeps behaving exactly as it did before this field
   * existed, and nothing changes until someone deliberately sets it.
   *
   * Exists because the polarity depends on the specific relay module plugged
   * into the header, not on the PCB — both board pin maps flag their
   * `RELAY_ACTIVE_LOW` as unverified. Getting it wrong inverts the
   * compressor: it runs when the loop wants idle, which freezes the beer and
   * short-cycles the compressor. Being able to correct that from the UI
   * during commissioning, rather than by reflashing, is the entire point.
   *
   * Changing it is treated as a safety event by the firmware, not a plain
   * config edit — see ADR-022.
   */
  coolingRelayActiveLow: z.boolean().nullable().default(null),
  /** As coolingRelayActiveLow, for the heating output. Inert on devices with no heater (kegerators). */
  heatingRelayActiveLow: z.boolean().nullable().default(null),
  overrideExpiresAt: z.number().int().nullable().optional(),
  // keg_scale devices only: bumping this to a new (non-null) value tells the
  // device to tare (zero) its load cell on the next config apply. Inert for
  // every other device type — same "declarative config, device self-corrects"
  // pattern as the rest of this schema (ADR-004), so a tare request survives
  // MQTT drops the same way a setpoint change does.
  tareRequestId: z.number().int().nullable().optional(),
  // keg_scale devices only: HX711 raw-ADC-to-grams calibration factor
  // (equivalent to the HX711 library's scale.set_scale()) — determined by
  // comparing readings against a known reference weight (see keg-scale
  // README). Same declarative pattern as everything else here: the firmware
  // persists whatever value it last applied to NVS, so it survives reboots
  // and MQTT drops, and only falls back to its compiled-in default on a
  // truly first-ever boot. Inert for every other device type.
  loadCellCalibrationFactor: z.number().nullable().optional(),
});
export type DeviceConfig = z.infer<typeof DeviceConfigSchema>;

/**
 * Partial update body for PATCH /api/devices/:id/config. activeProfileId is
 * request-only (start/stop following a profile) — it's never part of the
 * DeviceConfigSchema shape actually published to MQTT.
 */
export const UpdateDeviceConfigRequestSchema = DeviceConfigSchema.partial().extend({
  activeProfileId: z.number().int().nullable().optional(),
});
export type UpdateDeviceConfigRequest = z.infer<typeof UpdateDeviceConfigRequestSchema>;

export const DEFAULT_DEVICE_CONFIG: DeviceConfig = {
  setpointC: 20.0,
  hysteresisC: 0.5,
  mode: "thermostat",
  minOnTimeMs: 60000,
  minOffTimeMs: 60000,
  pidGains: { kp: 0, ki: 0, kd: 0 },
  pidWindowMs: 300000,
  controlSensorAddress: null,
  controlSensorOffsetC: 0,
  coolingRelayActiveLow: null,
  heatingRelayActiveLow: null,
  overrideExpiresAt: null,
  tareRequestId: null,
  loadCellCalibrationFactor: null,
};
