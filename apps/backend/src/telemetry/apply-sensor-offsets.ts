import type { TelemetryPayload } from "@brewhub/shared-types";

/**
 * Applies each sensor's calibration offset to a telemetry payload, so that
 * everything downstream of ingest — stored readings, charts, history export,
 * WebSocket broadcasts, Home Assistant — sees corrected temperatures and
 * nothing has to remember to correct them again later.
 *
 * Deliberately does NOT touch flows/weights: those have their own calibration
 * (pulses-per-litre, load-cell factor) applied elsewhere.
 *
 * Correcting on the way in means stored history is corrected as of when the
 * offset was set, and changing an offset later does not retroactively rewrite
 * old rows. That's the intended behaviour: a reading is a record of what the
 * system believed at the time, and silently rewriting history would make old
 * charts disagree with old control decisions.
 */
export function applySensorOffsets(
  payload: TelemetryPayload,
  offsetsByAddress: Map<string, number>,
): TelemetryPayload {
  // Common case: nothing is calibrated, so don't allocate a new payload.
  let anyOffsetApplies = false;
  for (const sensor of payload.sensors) {
    const offset = offsetsByAddress.get(sensor.address);
    if (offset !== undefined && offset !== 0 && sensor.temperatureC !== null) {
      anyOffsetApplies = true;
      break;
    }
  }
  if (!anyOffsetApplies) return payload;

  return {
    ...payload,
    sensors: payload.sensors.map((sensor) => {
      // A null reading is an explicit sensor fault, not a temperature —
      // offsetting it would invent a number where the device reported none.
      if (sensor.temperatureC === null) return sensor;
      const offset = offsetsByAddress.get(sensor.address) ?? 0;
      return { ...sensor, temperatureC: sensor.temperatureC + offset };
    }),
  };
}
