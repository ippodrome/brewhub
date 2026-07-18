import type { FastifyInstance } from "fastify";
import type { FlowHistoryPoint, TemperatureHistoryPoint, WeightHistoryPoint } from "@brewhub/shared-types";
import { getDevice } from "../db/repositories/devices.repo.js";
import { getRecentReadingsForSensor } from "../db/repositories/readings.repo.js";
import { getRecentFlowReadings } from "../db/repositories/flow-readings.repo.js";
import { getRecentWeightReadings } from "../db/repositories/weight-readings.repo.js";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

function parseLimit(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

export async function historyRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/devices/:id/history/temperature",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { sensorAddress, limit } = request.query as { sensorAddress?: string; limit?: string };

      if (!getDevice(fastify.db, id)) {
        return reply.code(404).send({ error: "Device not found" });
      }
      if (!sensorAddress) {
        return reply.code(400).send({ error: "sensorAddress query parameter is required" });
      }

      const rows = getRecentReadingsForSensor(fastify.db, id, sensorAddress, parseLimit(limit));
      const points: TemperatureHistoryPoint[] = rows
        .map((r) => ({ ts: r.ts, temperatureC: r.temperature_c }))
        .reverse(); // repo returns newest-first; charts want chronological order
      return points;
    },
  );

  fastify.get("/api/devices/:id/history/flow", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { flowIndex, limit } = request.query as { flowIndex?: string; limit?: string };

    if (!getDevice(fastify.db, id)) {
      return reply.code(404).send({ error: "Device not found" });
    }
    if (flowIndex === undefined || Number.isNaN(Number(flowIndex))) {
      return reply.code(400).send({ error: "flowIndex query parameter is required" });
    }

    const rows = getRecentFlowReadings(fastify.db, id, Number(flowIndex), parseLimit(limit));
    const points: FlowHistoryPoint[] = rows.map((r) => ({ ts: r.ts, pulseCount: r.pulse_count })).reverse();
    return points;
  });

  fastify.get("/api/devices/:id/history/weight", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { weightIndex, limit } = request.query as { weightIndex?: string; limit?: string };

    if (!getDevice(fastify.db, id)) {
      return reply.code(404).send({ error: "Device not found" });
    }
    if (weightIndex === undefined || Number.isNaN(Number(weightIndex))) {
      return reply.code(400).send({ error: "weightIndex query parameter is required" });
    }

    const rows = getRecentWeightReadings(fastify.db, id, Number(weightIndex), parseLimit(limit));
    const points: WeightHistoryPoint[] = rows.map((r) => ({ ts: r.ts, grams: r.grams })).reverse();
    return points;
  });
}
