import type { FastifyInstance, FastifyReply } from "fastify";
import {
  CreateTapRequestSchema,
  FinishFlowCalibrationRequestSchema,
  UpdateTapRequestSchema,
  type FlowCalibrationResult,
  type FlowCalibrationSession,
} from "@brewhub/shared-types";
import { getDevice } from "../db/repositories/devices.repo.js";
import {
  applyFlowCalibration,
  deleteTap,
  findTapChannelConflict,
  getTap,
  getTapRow,
  insertTap,
  listTapsForDevice,
  resetKeg,
  updateTapDetails,
  type TapRow,
} from "../db/repositories/taps.repo.js";
import {
  deleteCalibrationSession,
  getCalibrationSession,
  startCalibrationSession,
  type FlowCalibrationSessionRow,
} from "../db/repositories/flow-calibration.repo.js";
import { computeFlowCalibration } from "../taps/compute-flow-calibration.js";
import { listPourEventsForTap } from "../db/repositories/pour-events.repo.js";
import { publishTapVolumeDiscovery, removeTapVolumeDiscovery } from "../mqtt/publish-ha-discovery.js";
import { publishTapState } from "../mqtt/publish-tap-state.js";

export async function tapsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/devices/:id/taps", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDevice(fastify.db, id)) {
      return reply.code(404).send({ error: "Device not found" });
    }
    return listTapsForDevice(fastify.db, id);
  });

  fastify.post("/api/devices/:id/taps", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getDevice(fastify.db, id)) {
      return reply.code(404).send({ error: "Device not found" });
    }

    const parsed = CreateTapRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    if (parsed.data.measurementType === "weight") {
      const weightDevice = getDevice(fastify.db, parsed.data.weightDeviceId);
      if (!weightDevice || weightDevice.type !== "keg_scale") {
        return reply.code(400).send({ error: "weightDeviceId must reference an existing keg_scale device" });
      }
    }

    const conflict =
      parsed.data.measurementType === "flow"
        ? findTapChannelConflict(fastify.db, id, {
            measurementType: "flow",
            flowIndex: parsed.data.flowIndex,
          })
        : findTapChannelConflict(fastify.db, id, {
            measurementType: "weight",
            weightDeviceId: parsed.data.weightDeviceId,
            weightIndex: parsed.data.weightIndex,
          });
    if (conflict) {
      return reply.code(409).send({ error: "That measurement channel already has a tap configured" });
    }

    const tap = insertTap(fastify.db, id, parsed.data);

    const device = getDevice(fastify.db, id);
    if (device) {
      publishTapVolumeDiscovery(fastify.mqttClient, device, tap);
      publishTapState(fastify.mqttClient, id, tap);
    }

    return reply.code(201).send(tap);
  });

  fastify.patch(
    "/api/devices/:id/taps/:tapId",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id, tapId } = request.params as { id: string; tapId: string };
      const numericId = Number(tapId);

      const tap = getTap(fastify.db, numericId);
      if (!tap || tap.deviceId !== id) {
        return reply.code(404).send({ error: "Tap not found" });
      }

      const parsed = UpdateTapRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
      }

      const { resetKeg: shouldResetKeg, ...details } = parsed.data;

      if (Object.keys(details).length > 0) {
        if (tap.measurementType === "flow" && details.flowIndex !== undefined && details.flowIndex !== tap.flowIndex) {
          const existing = findTapChannelConflict(
            fastify.db,
            id,
            { measurementType: "flow", flowIndex: details.flowIndex },
            numericId,
          );
          if (existing) {
            return reply.code(409).send({ error: "That measurement channel already has a tap configured" });
          }
        }

        if (tap.measurementType === "weight") {
          const nextWeightDeviceId = details.weightDeviceId ?? tap.weightDeviceId;
          const nextWeightIndex = details.weightIndex ?? tap.weightIndex;
          if (details.weightDeviceId !== undefined) {
            const weightDevice = getDevice(fastify.db, details.weightDeviceId);
            if (!weightDevice || weightDevice.type !== "keg_scale") {
              return reply
                .code(400)
                .send({ error: "weightDeviceId must reference an existing keg_scale device" });
            }
          }
          if (
            nextWeightDeviceId !== null &&
            nextWeightIndex !== null &&
            (details.weightDeviceId !== undefined || details.weightIndex !== undefined)
          ) {
            const existing = findTapChannelConflict(
              fastify.db,
              id,
              { measurementType: "weight", weightDeviceId: nextWeightDeviceId, weightIndex: nextWeightIndex },
              numericId,
            );
            if (existing) {
              return reply.code(409).send({ error: "That measurement channel already has a tap configured" });
            }
          }
        }

        updateTapDetails(fastify.db, numericId, details);
      }

      if (shouldResetKeg) {
        resetKeg(fastify.db, numericId);
      }

      const updated = getTap(fastify.db, numericId);
      if (updated) {
        const device = getDevice(fastify.db, id);
        // Republish discovery too (not just state) so a renamed tap's HA
        // entity name stays in sync — cheap, retained, idempotent.
        if (device) publishTapVolumeDiscovery(fastify.mqttClient, device, updated);
        publishTapState(fastify.mqttClient, id, updated);
      }

      return updated;
    },
  );

  fastify.delete(
    "/api/devices/:id/taps/:tapId",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id, tapId } = request.params as { id: string; tapId: string };
      const numericId = Number(tapId);

      const tap = getTap(fastify.db, numericId);
      if (!tap || tap.deviceId !== id) {
        return reply.code(404).send({ error: "Tap not found" });
      }

      deleteTap(fastify.db, numericId);
      removeTapVolumeDiscovery(fastify.mqttClient, id, numericId);
      return reply.code(204).send();
    },
  );

  // --- Guided flow-meter calibration ---------------------------------------
  // Start a session, pour a known amount into a jug or onto a scale, then tell
  // the backend what you actually got. No device involvement at all: flow
  // telemetry is already a cumulative pulse count, so a session is just a
  // remembered baseline.

  /** Resolves a :tapId that must be an existing, flow-measured tap on :id. */
  function getFlowTapRowOr(
    reply: FastifyReply,
    deviceId: string,
    tapId: string,
  ): TapRow | undefined {
    const row = getTapRow(fastify.db, Number(tapId));
    if (!row || row.device_id !== deviceId) {
      void reply.code(404).send({ error: "Tap not found" });
      return undefined;
    }
    if (row.measurement_type !== "flow" || row.pulses_per_liter === null) {
      void reply
        .code(400)
        .send({ error: "Only flow-measured taps have a flow meter to calibrate" });
      return undefined;
    }
    return row;
  }

  function toSessionResponse(
    session: FlowCalibrationSessionRow,
    tap: TapRow,
  ): FlowCalibrationSession {
    const pulsesSoFar = Math.max(0, tap.last_pulse_count - session.start_pulse_count);
    return {
      tapId: session.tap_id,
      startedAt: session.started_at,
      startPulseCount: session.start_pulse_count,
      pulsesSoFar,
      // Uses the factor being replaced, so it's a hint ("about half a litre so
      // far"), not a measurement — the whole point is that it's not trusted.
      estimatedVolumeMl: (pulsesSoFar / (tap.pulses_per_liter as number)) * 1000,
    };
  }

  fastify.post(
    "/api/devices/:id/taps/:tapId/calibration",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id, tapId } = request.params as { id: string; tapId: string };
      const tap = getFlowTapRowOr(reply, id, tapId);
      if (!tap) return reply;

      const session = startCalibrationSession(
        fastify.db,
        tap.id,
        tap.last_pulse_count,
        tap.remaining_volume_ml,
        Date.now(),
      );
      return reply.code(201).send(toSessionResponse(session, tap));
    },
  );

  fastify.get(
    "/api/devices/:id/taps/:tapId/calibration",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id, tapId } = request.params as { id: string; tapId: string };
      const tap = getFlowTapRowOr(reply, id, tapId);
      if (!tap) return reply;

      const session = getCalibrationSession(fastify.db, tap.id);
      if (!session) {
        return reply.code(404).send({ error: "No calibration in progress for this tap" });
      }
      return toSessionResponse(session, tap);
    },
  );

  fastify.delete(
    "/api/devices/:id/taps/:tapId/calibration",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id, tapId } = request.params as { id: string; tapId: string };
      const tap = getFlowTapRowOr(reply, id, tapId);
      if (!tap) return reply;

      deleteCalibrationSession(fastify.db, tap.id);
      return reply.code(204).send();
    },
  );

  fastify.post(
    "/api/devices/:id/taps/:tapId/calibration/finish",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id, tapId } = request.params as { id: string; tapId: string };
      const tap = getFlowTapRowOr(reply, id, tapId);
      if (!tap) return reply;

      const session = getCalibrationSession(fastify.db, tap.id);
      if (!session) {
        return reply.code(404).send({ error: "No calibration in progress for this tap" });
      }

      const parsed = FinishFlowCalibrationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "Invalid request body", details: parsed.error.flatten() });
      }

      const previousPulsesPerLiter = tap.pulses_per_liter as number;
      const outcome = computeFlowCalibration(
        session.start_pulse_count,
        tap.last_pulse_count,
        previousPulsesPerLiter,
        parsed.data,
      );

      if (!outcome.ok) {
        // The session is deliberately left in place: every rejection is
        // recoverable by pouring more or re-entering the volume, and throwing
        // the baseline away would force the user to start the pour over.
        return reply.code(422).send({
          error: "Calibration rejected",
          rejection: outcome.rejection,
        });
      }

      applyFlowCalibration(
        fastify.db,
        tap.id,
        outcome.pulsesPerLiter,
        session.start_remaining_volume_ml - outcome.actualVolumeMl,
      );
      deleteCalibrationSession(fastify.db, tap.id);

      const updated = getTap(fastify.db, tap.id);
      if (updated) {
        publishTapState(fastify.mqttClient, id, updated);
      }

      const result: FlowCalibrationResult = {
        tapId: tap.id,
        pulses: outcome.pulses,
        actualVolumeMl: outcome.actualVolumeMl,
        previousPulsesPerLiter,
        pulsesPerLiter: outcome.pulsesPerLiter,
        driftPercent: outcome.driftPercent,
      };
      return result;
    },
  );

  fastify.get(
    "/api/devices/:id/taps/:tapId/pours",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id, tapId } = request.params as { id: string; tapId: string };
      const numericId = Number(tapId);

      const tap = getTap(fastify.db, numericId);
      if (!tap || tap.deviceId !== id) {
        return reply.code(404).send({ error: "Tap not found" });
      }

      return listPourEventsForTap(fastify.db, numericId);
    },
  );
}
