import { z } from "zod";

export const DeviceTypeSchema = z.enum(["kegerator", "fermenter", "sensor"]);
export type DeviceType = z.infer<typeof DeviceTypeSchema>;

export const DeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: DeviceTypeSchema,
  chamberName: z.string().nullable(),
  board: z.string().nullable(),
  firmwareVersion: z.string().nullable(),
  ipAddress: z.string().nullable(),
  isOnline: z.boolean(),
  lastSeenAt: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const CreateDeviceRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: DeviceTypeSchema,
  chamberName: z.string().optional(),
  board: z.string().optional(),
});
export type CreateDeviceRequest = z.infer<typeof CreateDeviceRequestSchema>;
