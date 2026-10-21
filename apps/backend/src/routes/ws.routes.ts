import type { FastifyInstance, FastifyRequest } from "fastify";
import { listDevices } from "../db/repositories/devices.repo.js";
import { registerWsClient, sendTo } from "../ws/broadcast.js";

/**
 * Browsers can't set an Authorization header on a WebSocket handshake, so
 * the same JWT the REST API uses is accepted from either the standard
 * `Authorization: Bearer <jwt>` header (non-browser clients) or a
 * `?token=<jwt>` query parameter (the frontend, see WsProvider.tsx).
 */
export function extractWsToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token) return token;
  }
  const query = request.query as Record<string, unknown> | undefined;
  const token = query?.token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

export async function wsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/ws",
    {
      websocket: true,
      // Runs before the upgrade, so an unauthenticated client gets a plain
      // HTTP 401 and never receives the device list or live telemetry.
      preValidation: async (request, reply) => {
        const token = extractWsToken(request);
        if (!token) {
          return reply.code(401).send({ error: "Unauthorized" });
        }
        try {
          fastify.jwt.verify(token);
        } catch {
          return reply.code(401).send({ error: "Unauthorized" });
        }
      },
    },
    (socket) => {
      registerWsClient(socket);
      sendTo(socket, { type: "device_list", payload: listDevices(fastify.db) });
    },
  );
}
