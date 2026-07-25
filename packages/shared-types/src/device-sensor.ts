import { z } from "zod";

/**
 * A physical sensor discovered on a device, keyed by (deviceId, address).
 * Rows are created automatically the first time a telemetry message
 * mentions an address the backend hasn't seen for that device before — the
 * user labels/designates it afterward, they don't configure it up front.
 */
export const DeviceSensorSchema = z.object({
  deviceId: z.string().min(1),
  address: z.string().min(1),
  label: z.string().nullable(),
  isControlSensor: z.boolean(),
  lastSeenAt: z.number().int().nullable(),
  /**
   * Calibration correction, in °C, added to this sensor's raw reading to get
   * the true temperature: trueC = rawC + offsetC. So a sensor reading 0.4 °C
   * too high gets offsetC = -0.4. DS18B20s are spec'd to ±0.5 °C, which is
   * why this exists at all.
   *
   * Applied in TWO places that must stay consistent (see ADR-020):
   *   - the backend applies it on telemetry ingest, so everything stored,
   *     charted and republished to Home Assistant is already corrected;
   *   - for whichever sensor is the *control* sensor, the same value is
   *     mirrored into DeviceConfig.controlSensorOffsetC and pushed to the
   *     device, so the ESP32's control loop corrects its own input too.
   * Without the second half, the UI would show a corrected temperature while
   * the device silently held the uncorrected one against the setpoint.
   *
   * Defaults to 0 when absent, mirroring the column's own DEFAULT: a sensor
   * that predates calibration is an uncalibrated one, not an invalid one.
   */
  offsetC: z.number().default(0),
});
export type DeviceSensor = z.infer<typeof DeviceSensorSchema>;

/** Bounded well inside the range any plausible DS18B20 tolerance stack needs — a larger "offset" is a broken sensor, not a miscalibrated one. */
export const MAX_SENSOR_OFFSET_C = 10;

export const UpdateDeviceSensorRequestSchema = z.object({
  label: z.string().nullable().optional(),
  isControlSensor: z.boolean().optional(),
  offsetC: z.number().min(-MAX_SENSOR_OFFSET_C).max(MAX_SENSOR_OFFSET_C).optional(),
});
export type UpdateDeviceSensorRequest = z.infer<typeof UpdateDeviceSensorRequestSchema>;
