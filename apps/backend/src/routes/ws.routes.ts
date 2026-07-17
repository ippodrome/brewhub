import type { FastifyInstance } from "fastify";
import { listDevices } from "../db/repositories/devices.repo.js";
import { registerWsClient, sendTo } from "../ws/broadcast.js";

export async function wsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/ws", { websocket: true }, (socket) => {
    registerWsClient(socket);
    sendTo(socket, { type: "device_list", payload: listDevices(fastify.db) });
  });
}
