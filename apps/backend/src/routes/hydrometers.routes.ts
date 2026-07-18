import type { FastifyInstance } from "fastify";
import type { GravityHistoryPoint } from "@brewhub/shared-types";
import { CreateHydrometerRequestSchema, UpdateHydrometerRequestSchema } from "@brewhub/shared-types";
import { getDevice } from "../db/repositories/devices.repo.js";
import {
  deleteHydrometer,
  getHydrometer,
  getHydrometerByIdentifier,
  insertHydrometer,
  listHydrometers,
  updateHydrometer,
} from "../db/repositories/hydrometers.repo.js";
import { getRecentGravityReadings } from "../db/repositories/gravity-readings.repo.js";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

function parseLimit(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

export async function hydrometersRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/hydrometers", { preHandler: fastify.verifyAuth }, async () => {
    return listHydrometers(fastify.db);
  });

  fastify.post("/api/hydrometers", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const parsed = CreateHydrometerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    if (getHydrometerByIdentifier(fastify.db, parsed.data.identifier)) {
      return reply.code(409).send({ error: `A hydrometer with identifier "${parsed.data.identifier}" already exists` });
    }

    if (parsed.data.fermenterDeviceId) {
      const device = getDevice(fastify.db, parsed.data.fermenterDeviceId);
      if (!device || device.type !== "fermenter") {
        return reply.code(400).send({ error: "fermenterDeviceId must reference an existing fermenter device" });
      }
    }

    const hydrometer = insertHydrometer(fastify.db, parsed.data);
    return reply.code(201).send(hydrometer);
  });

  fastify.patch("/api/hydrometers/:id", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);

    if (!getHydrometer(fastify.db, numericId)) {
      return reply.code(404).send({ error: "Hydrometer not found" });
    }

    const parsed = UpdateHydrometerRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    if (parsed.data.fermenterDeviceId) {
      const device = getDevice(fastify.db, parsed.data.fermenterDeviceId);
      if (!device || device.type !== "fermenter") {
        return reply.code(400).send({ error: "fermenterDeviceId must reference an existing fermenter device" });
      }
    }

    return updateHydrometer(fastify.db, numericId, parsed.data);
  });

  fastify.delete("/api/hydrometers/:id", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = deleteHydrometer(fastify.db, Number(id));
    if (!deleted) return reply.code(404).send({ error: "Hydrometer not found" });
    return reply.code(204).send();
  });

  fastify.get("/api/hydrometers/:id/history", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { limit } = request.query as { limit?: string };
    const numericId = Number(id);

    if (!getHydrometer(fastify.db, numericId)) {
      return reply.code(404).send({ error: "Hydrometer not found" });
    }

    const rows = getRecentGravityReadings(fastify.db, numericId, parseLimit(limit));
    const points: GravityHistoryPoint[] = rows
      .map((r) => ({ ts: r.recorded_at * 1000, gravitySg: r.specific_gravity }))
      .reverse();
    return points;
  });
}
