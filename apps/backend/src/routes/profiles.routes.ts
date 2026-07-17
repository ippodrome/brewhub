import type { FastifyInstance } from "fastify";
import { CreateProfileRequestSchema } from "@brewhub/shared-types";
import { getDevice } from "../db/repositories/devices.repo.js";
import {
  deleteProfile,
  getProfile,
  insertProfile,
  listProfilesForDevice,
} from "../db/repositories/profiles.repo.js";
import { clearActiveProfile, getActiveProfileState } from "../db/repositories/device-configs.repo.js";

export async function profilesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/devices/:id/profiles",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!getDevice(fastify.db, id)) {
        return reply.code(404).send({ error: "Device not found" });
      }
      return listProfilesForDevice(fastify.db, id);
    },
  );

  fastify.post(
    "/api/devices/:id/profiles",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!getDevice(fastify.db, id)) {
        return reply.code(404).send({ error: "Device not found" });
      }

      const parsed = CreateProfileRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
      }

      const profile = insertProfile(fastify.db, id, parsed.data);
      return reply.code(201).send(profile);
    },
  );

  fastify.delete(
    "/api/devices/:id/profiles/:profileId",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id, profileId } = request.params as { id: string; profileId: string };
      const numericId = Number(profileId);

      const profile = getProfile(fastify.db, numericId);
      if (!profile || profile.deviceId !== id) {
        return reply.code(404).send({ error: "Profile not found" });
      }

      // Deleting the profile a device is actively following stops that
      // following — never leave active_profile_id pointing at a dead row.
      const active = getActiveProfileState(fastify.db, id);
      if (active?.activeProfileId === numericId) {
        clearActiveProfile(fastify.db, id);
      }

      deleteProfile(fastify.db, numericId);
      return reply.code(204).send();
    },
  );
}
