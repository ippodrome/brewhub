import type { FastifyInstance } from "fastify";
import { listUnregisteredDiscoveredDevices } from "../db/repositories/discovered-devices.repo.js";

export async function discoveredDevicesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/discovered-devices", { preHandler: fastify.verifyAuth }, async () => {
    return listUnregisteredDiscoveredDevices(fastify.db);
  });
}
