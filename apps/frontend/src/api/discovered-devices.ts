import { DiscoveredDeviceSchema, type DiscoveredDevice } from "@brewhub/shared-types";
import { z } from "zod";
import { apiFetch } from "./client";

export async function listDiscoveredDevices(): Promise<DiscoveredDevice[]> {
  const response = await apiFetch<unknown>("/api/discovered-devices");
  return z.array(DiscoveredDeviceSchema).parse(response);
}
