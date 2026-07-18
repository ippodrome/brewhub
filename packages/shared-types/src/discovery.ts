import { z } from "zod";
import { FirmwareBoardSchema, type FirmwareBoard } from "./firmware.js";
import type { DeviceType } from "./device.js";

/** Published (retained) to unibrew/{deviceId}/discovery on every MQTT connect — see DECISIONS.md for why this deviates from claude.md §6's original single shared "unibrew/discovery" topic sketch. */
export const DiscoveryMessageSchema = z.object({
  deviceId: z.string().min(1),
  board: FirmwareBoardSchema,
  firmwareVersion: z.string().min(1),
});
export type DiscoveryMessage = z.infer<typeof DiscoveryMessageSchema>;

/** GET /api/discovered-devices response row — only devices NOT already registered are returned (see the repo's join). */
export const DiscoveredDeviceSchema = z.object({
  deviceId: z.string().min(1),
  board: FirmwareBoardSchema,
  firmwareVersion: z.string().min(1),
  firstSeenAt: z.number().int(),
  lastSeenAt: z.number().int(),
});
export type DiscoveredDevice = z.infer<typeof DiscoveredDeviceSchema>;

/** What device type you'd register a given firmware board's device as. */
export function boardToDeviceType(board: FirmwareBoard): DeviceType {
  switch (board) {
    case "fermenter-brewpi":
      return "fermenter";
    case "kegerator-kegcop":
      return "kegerator";
    case "keg-scale":
      return "keg_scale";
    case "gravity-bridge":
      return "gravity_bridge";
  }
}
