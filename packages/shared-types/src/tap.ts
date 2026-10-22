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
  /**
   * When this keg was last detected as having kicked (blown / run dry), or
   * null. Flow-measured taps only — see KICK_* constants below for what
   * "detected" means. Cleared by tapping a new keg (resetKeg).
   */
  kickedAt: z.number().int().nullable().default(null),

  // measurementType === "flow"
  flowIndex: z.number().int().min(0).max(8).nullable(),
  pulsesPerLiter: z.number().positive().nullable(),

  // measurementType === "weight"
  weightDeviceId: z.string().nullable(),
  weightIndex: z.number().int().nonnegative().nullable(),
  tareWeightG: z.number().nonnegative().nullable(),
  fullWeightG: z.number().positive().nullable(),
  /**
   * Beer density used to turn net weight into volume (kg/L == g/mL).
   * null on taps created before 1.3.0 — those keep the legacy linear
   * interpolation between tareWeightG and fullWeightG.
   */
  beerDensityKgPerL: z.number().positive().nullable().default(null),
  /** Measured final gravity of the beer; when set it is used as the density (SG ≈ kg/L). */
  finalGravitySg: z.number().positive().nullable().default(null),
});
export type Tap = z.infer<typeof TapSchema>;

/** Plausible beer density / SG range — anything outside is a typo, not a beer. */
const BeerDensitySchema = z.number().min(0.9).max(1.2);
const GravitySgSchema = z.number().min(0.98).max(1.2);

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
  /** Optional since 1.3.0: derived from tare + fullVolume × density when omitted. */
  fullWeightG: z.number().positive().optional(),
  beerDensityKgPerL: BeerDensitySchema.optional(),
  finalGravitySg: GravitySgSchema.optional(),
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
  beerDensityKgPerL: BeerDensitySchema.optional(),
  /** null clears a previously entered FG (falls back to beerDensityKgPerL). */
  finalGravitySg: GravitySgSchema.nullable().optional(),
  resetKeg: z.boolean().optional(),
});
export type UpdateTapRequest = z.infer<typeof UpdateTapRequestSchema>;

/**
 * Kick detection. When a keg runs dry the line fills with CO2 instead of
 * beer, and the flow meter free-spins — gas offers far less resistance than
 * liquid, so the measured "flow rate" jumps well past anything a balanced
 * draft system can pour.
 *
 * Rate is the signal rather than volume, deliberately: a volume-based rule
 * ("a pour over 2 L must be a kick") can't tell a blown keg from a growler
 * fill, which homebrewers do on purpose. A sustained 3-4x normal flow rate
 * has no legitimate explanation.
 *
 * A balanced system pours a pint in roughly 20-30 s, i.e. ~15-25 mL/s. The
 * threshold sits well above that so normal pouring — including a fast pour
 * down the side of a glass — never trips it.
 *
 * The volume floor exists so a single noisy tick can't fire it: the pour has
 * to have actually delivered something before its rate means anything.
 *
 * Both are starting points, not measured constants — they depend on line
 * length, pressure and the meter itself. If a system reports false kicks,
 * KICK_RATE_ML_PER_S is the number to raise.
 */
export const KICK_RATE_ML_PER_S = 60;
export const KICK_MIN_POUR_VOLUME_ML = 400;

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

/** Default density of finished beer when nothing better is known (≈ FG 1.010). */
export const DEFAULT_BEER_DENSITY_KG_PER_L = 1.01;

/** FG wins (it's a measurement), then the per-tap density, then the default. */
export function effectiveBeerDensity(tap: {
  finalGravitySg?: number | null;
  beerDensityKgPerL?: number | null;
}): number {
  return tap.finalGravitySg ?? tap.beerDensityKgPerL ?? DEFAULT_BEER_DENSITY_KG_PER_L;
}

export interface KegContents {
  /** Gross minus empty keg, clamped at 0. */
  netWeightG: number;
  volumeMl: number;
  /** null when no full volume is known. */
  percent: number | null;
}

/**
 * Beer in a keg from a gross scale reading: (gross − empty keg) / density.
 * Clamped at 0 (an empty keg reading a few grams under its tare is noise,
 * not negative beer). Not clamped at the top — an overfilled keg is real.
 */
export function computeKegContents(inputs: {
  grossWeightG: number;
  emptyKegWeightG: number;
  densityKgPerL: number;
  fullVolumeMl?: number | null;
}): KegContents {
  const netWeightG = Math.max(0, inputs.grossWeightG - inputs.emptyKegWeightG);
  const volumeMl = inputs.densityKgPerL > 0 ? netWeightG / inputs.densityKgPerL : 0;
  const full = inputs.fullVolumeMl ?? null;
  const percent = full && full > 0 ? Math.max(0, Math.min(100, (volumeMl / full) * 100)) : null;
  return { netWeightG, volumeMl, percent };
}

/** Tare-now request: capture the latest reading of the tap's scale channel as the empty-keg weight. */
export const CaptureTareRequestSchema = z.object({}).strict();

/**
 * Approximate empty weights. Real kegs vary by maker and fittings by a few
 * hundred grams — these are starting points for the user to edit, never
 * trusted as measurements.
 */
export const KEG_TARE_PRESETS: ReadonlyArray<{ id: string; label: string; emptyWeightG: number; volumeMl: number }> = [
  { id: "corny-5gal", label: "Cornelius 5 gal ball-lock (~4.0 kg)", emptyWeightG: 4000, volumeMl: 18900 },
  { id: "corny-19l", label: "Corny 19 L (~4.0 kg)", emptyWeightG: 4000, volumeMl: 19000 },
  { id: "corny-9l", label: "Corny 9.5 L / 2.5 gal (~3.0 kg)", emptyWeightG: 3000, volumeMl: 9500 },
  { id: "keykeg-20l", label: "KeyKeg 20 L (~1.2 kg)", emptyWeightG: 1200, volumeMl: 20000 },
  { id: "keykeg-30l", label: "KeyKeg 30 L (~1.5 kg)", emptyWeightG: 1500, volumeMl: 30000 },
  { id: "steel-20l", label: "Stainless 20 L euro keg (~7.5 kg)", emptyWeightG: 7500, volumeMl: 20000 },
  { id: "steel-30l", label: "Stainless 30 L euro keg (~9.5 kg)", emptyWeightG: 9500, volumeMl: 30000 },
  { id: "steel-50l", label: "Stainless 50 L euro keg (~12.5 kg)", emptyWeightG: 12500, volumeMl: 50000 },
];
