import { z } from "zod";

/**
 * How a tap's remaining volume is measured. "flow" reads cumulative pulses
 * from one of the kegerator's own flow meter inputs. "weight" instead reads
 * grams from a *separate* keg_scale device's load cell — the tap still
 * belongs to a kegerator (for tap-list/UI purposes) but its volume math is
 * driven by another device's telemetry entirely.
 */
export const TapMeasurementTypeSchema = z.enum(["flow", "weight"]);
export type TapMeasurementType = z.infer<typeof TapMeasurementTypeSchema>;

/**
 * A logical keg position on a kegerator. remainingVolumeMl is computed/
 * maintained by the backend, not set directly by the client except via
 * resetKeg (tapping a new keg). Exactly one of the flow-* or weight-*
 * field groups is populated, matching measurementType — the other group
 * is null. Pour-event logging (see pour-events.repo) only exists for
 * flow-measured taps for now; weight-based pour detection is future work.
 */
export const TapSchema = z.object({
  id: z.number().int(),
  deviceId: z.string().min(1),
  measurementType: TapMeasurementTypeSchema,
  name: z.string().min(1),
  style: z.string().nullable(),
  abv: z.number().nullable(),
  ibu: z.number().nullable(),
  notes: z.string().nullable(),
  imageUrl: z.string().nullable(),
  fullVolumeMl: z.number().positive(),
  remainingVolumeMl: z.number(),
  createdAt: z.number().int(),

  // measurementType === "flow"
  flowIndex: z.number().int().min(0).max(8).nullable(),
  pulsesPerLiter: z.number().positive().nullable(),

  // measurementType === "weight"
  weightDeviceId: z.string().nullable(),
  weightIndex: z.number().int().nonnegative().nullable(),
  tareWeightG: z.number().nonnegative().nullable(),
  fullWeightG: z.number().positive().nullable(),
});
export type Tap = z.infer<typeof TapSchema>;

const CreateTapCommonFieldsSchema = {
  name: z.string().min(1),
  style: z.string().optional(),
  abv: z.number().optional(),
  ibu: z.number().optional(),
  notes: z.string().optional(),
  imageUrl: z.string().optional(),
  fullVolumeMl: z.number().positive(),
};

export const CreateFlowTapRequestSchema = z.object({
  measurementType: z.literal("flow"),
  flowIndex: z.number().int().min(0).max(8),
  pulsesPerLiter: z.number().positive(),
  ...CreateTapCommonFieldsSchema,
});
export type CreateFlowTapRequest = z.infer<typeof CreateFlowTapRequestSchema>;

export const CreateWeightTapRequestSchema = z.object({
  measurementType: z.literal("weight"),
  weightDeviceId: z.string().min(1),
  weightIndex: z.number().int().nonnegative(),
  tareWeightG: z.number().nonnegative(),
  fullWeightG: z.number().positive(),
  ...CreateTapCommonFieldsSchema,
});
export type CreateWeightTapRequest = z.infer<typeof CreateWeightTapRequestSchema>;

/** Discriminated on measurementType so a request can only supply the field group that applies. */
export const CreateTapRequestSchema = z.discriminatedUnion("measurementType", [
  CreateFlowTapRequestSchema,
  CreateWeightTapRequestSchema,
]);
export type CreateTapRequest = z.infer<typeof CreateTapRequestSchema>;

/**
 * PATCH body. measurementType is deliberately immutable after creation (a
 * tap is bound to either a flow input or a weight device at creation time —
 * converting one to the other is "delete and recreate", not an edit), so
 * this is a flat partial rather than a second discriminated union.
 * resetKeg: true resets remainingVolumeMl back to fullVolumeMl (new keg tapped).
 */
export const UpdateTapRequestSchema = z.object({
  name: z.string().min(1).optional(),
  style: z.string().optional(),
  abv: z.number().optional(),
  ibu: z.number().optional(),
  notes: z.string().optional(),
  imageUrl: z.string().optional(),
  fullVolumeMl: z.number().positive().optional(),
  flowIndex: z.number().int().min(0).max(8).optional(),
  pulsesPerLiter: z.number().positive().optional(),
  weightDeviceId: z.string().min(1).optional(),
  weightIndex: z.number().int().nonnegative().optional(),
  tareWeightG: z.number().nonnegative().optional(),
  fullWeightG: z.number().positive().optional(),
  resetKeg: z.boolean().optional(),
});
export type UpdateTapRequest = z.infer<typeof UpdateTapRequestSchema>;

/** Flow-measured taps only, for now — see TapSchema doc comment. */
export const PourEventSchema = z.object({
  id: z.number().int(),
  tapId: z.number().int(),
  volumeMl: z.number().positive(),
  startedAt: z.number().int(),
  endedAt: z.number().int(),
});
export type PourEvent = z.infer<typeof PourEventSchema>;

/**
 * Published (retained) by the backend to unibrew/{deviceId}/taps/{tapId}/state
 * whenever a tap's remaining volume changes — for external consumers (e.g.
 * Home Assistant) to read over plain MQTT, since remainingVolumeMl is
 * otherwise only available via the REST API / WebSocket. Not a config the
 * backend sends to a device (ADR-004 is unaffected — this is backend-as-
 * data-source for other systems, a different direction entirely) and
 * nothing in BrewHub's own frontend subscribes to it; the frontend already
 * gets this from the REST API / WS.
 */
export const TapStateSchema = z.object({
  remainingVolumeMl: z.number().int().nonnegative(),
  remainingPercent: z.number().int().min(0).max(100),
});
export type TapState = z.infer<typeof TapStateSchema>;
