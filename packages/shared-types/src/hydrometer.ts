import { z } from "zod";

export const HydrometerTypeSchema = z.enum(["tilt", "rapt_pill", "ispindel"]);
export type HydrometerType = z.infer<typeof HydrometerTypeSchema>;

/**
 * A wireless hydrometer, independent of BrewHub's own `devices` table —
 * Tilt/Rapt Pill readings arrive over MQTT (from BrewHub's own gravity-bridge
 * firmware or an external bridge, see gravity.ts) and iSpindel readings
 * arrive via its own HTTP POST, neither of which is a registered BrewHub
 * device in the sense kegerator/fermenter/keg_scale are. identifier is how
 * incoming readings get matched to this record (a Tilt's colour, a Rapt
 * Pill's device id, or the name configured in the iSpindel's own web UI) —
 * immutable after creation, since changing it would silently orphan
 * in-flight readings from whatever's still reporting the old identifier.
 * Calibration is a simple linear correction (correctedSG = rawSG *
 * calibrationSlope + calibrationOffset), applied once at ingest — every
 * downstream reader always sees the already-corrected value.
 */
export const HydrometerSchema = z.object({
  id: z.number().int(),
  identifier: z.string().min(1),
  type: HydrometerTypeSchema,
  fermenterDeviceId: z.string().nullable(),
  calibrationSlope: z.number(),
  calibrationOffset: z.number(),
  createdAt: z.number().int(),
});
export type Hydrometer = z.infer<typeof HydrometerSchema>;

export const CreateHydrometerRequestSchema = z.object({
  identifier: z.string().min(1),
  type: HydrometerTypeSchema,
  fermenterDeviceId: z.string().nullable().optional(),
  calibrationSlope: z.number().optional(),
  calibrationOffset: z.number().optional(),
});
export type CreateHydrometerRequest = z.infer<typeof CreateHydrometerRequestSchema>;

/** identifier/type are immutable after creation — see HydrometerSchema doc comment. */
export const UpdateHydrometerRequestSchema = z.object({
  fermenterDeviceId: z.string().nullable().optional(),
  calibrationSlope: z.number().optional(),
  calibrationOffset: z.number().optional(),
});
export type UpdateHydrometerRequest = z.infer<typeof UpdateHydrometerRequestSchema>;
