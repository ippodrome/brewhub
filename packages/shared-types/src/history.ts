import { z } from "zod";

/** Chronologically ordered (ascending ts) response points for device history charts. */

export const TemperatureHistoryPointSchema = z.object({
  ts: z.number().int(),
  temperatureC: z.number().nullable(),
});
export type TemperatureHistoryPoint = z.infer<typeof TemperatureHistoryPointSchema>;

export const FlowHistoryPointSchema = z.object({
  ts: z.number().int(),
  pulseCount: z.number().int().nonnegative(),
});
export type FlowHistoryPoint = z.infer<typeof FlowHistoryPointSchema>;

export const WeightHistoryPointSchema = z.object({
  ts: z.number().int(),
  grams: z.number().nullable(),
});
export type WeightHistoryPoint = z.infer<typeof WeightHistoryPointSchema>;

export const GravityHistoryPointSchema = z.object({
  ts: z.number().int(),
  gravitySg: z.number().nullable(),
});
export type GravityHistoryPoint = z.infer<typeof GravityHistoryPointSchema>;
