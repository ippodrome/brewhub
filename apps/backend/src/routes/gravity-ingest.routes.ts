import type { FastifyInstance } from "fastify";
import { ISpindelPayloadSchema } from "@brewhub/shared-types";
import { getHydrometerByIdentifier } from "../db/repositories/hydrometers.repo.js";
import { insertGravityReading } from "../db/repositories/gravity-readings.repo.js";
import { applyCalibration } from "../gravity/apply-calibration.js";

/**
 * iSpindel posts here directly over WiFi (configured in the iSpindel's own
 * web UI) — no auth, since a device has no session (same LAN-trust
 * reasoning as MQTT/OTA tokens, see DECISIONS.md ADR-008/009). Deliberately
 * scoped tight: only accepts readings for an identifier that's already been
 * configured as a hydrometer via the UI, so this can't be used to write
 * arbitrary data.
 */
export async function gravityIngestRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/api/gravity/ispindel", async (request, reply) => {
    const parsed = ISpindelPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const hydrometer = getHydrometerByIdentifier(fastify.db, parsed.data.name);
    if (!hydrometer) {
      fastify.log.warn({ identifier: parsed.data.name }, "iSpindel reading for unconfigured hydrometer, dropping");
      return reply.code(404).send({ error: `No hydrometer configured with identifier "${parsed.data.name}"` });
    }

    const gravitySg = applyCalibration(hydrometer, parsed.data.gravity);
    const ts = Date.now();
    insertGravityReading(
      fastify.db,
      hydrometer.id,
      ts,
      gravitySg,
      parsed.data.temperature ?? null,
      parsed.data.battery ?? null,
    );

    return reply.code(204).send();
  });
}
