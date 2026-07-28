import type { FastifyInstance } from "fastify";
import {
  CreateProfileRequestSchema,
  ProfileExportSchema,
  type ImportProfilesResult,
} from "@brewhub/shared-types";
import { buildProfileExport, exportFilename, resolveUniqueName } from "../profiles/export.js";
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

  // --- Import / export ------------------------------------------------------
  // Profiles are recipes, not device state, so they're portable: the exported
  // form carries no id, deviceId or createdAt (see profiles/export.ts).

  /** Every profile on the device, as a downloadable file. */
  fastify.get(
    "/api/devices/:id/profiles/export",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!getDevice(fastify.db, id)) {
        return reply.code(404).send({ error: "Device not found" });
      }

      const profiles = listProfilesForDevice(fastify.db, id);
      if (profiles.length === 0) {
        return reply.code(404).send({ error: "This device has no profiles to export" });
      }

      const now = Date.now();
      reply.header("Content-Type", "application/json");
      reply.header("Content-Disposition", `attachment; filename="${exportFilename(id, now)}"`);
      return reply.send(buildProfileExport(profiles, now));
    },
  );

  /** One profile, same envelope shape — so a single file and a bulk file import identically. */
  fastify.get(
    "/api/devices/:id/profiles/:profileId/export",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id, profileId } = request.params as { id: string; profileId: string };

      const profile = getProfile(fastify.db, Number(profileId));
      if (!profile || profile.deviceId !== id) {
        return reply.code(404).send({ error: "Profile not found" });
      }

      const now = Date.now();
      reply.header("Content-Type", "application/json");
      reply.header(
        "Content-Disposition",
        `attachment; filename="${exportFilename(`${id}-${profile.name}`, now)}"`,
      );
      return reply.send(buildProfileExport([profile], now));
    },
  );

  fastify.post(
    "/api/devices/:id/profiles/import",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!getDevice(fastify.db, id)) {
        return reply.code(404).send({ error: "Device not found" });
      }

      const parsed = ProfileExportSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "That doesn't look like a BrewHub profile export",
          details: parsed.error.flatten(),
        });
      }

      // Import is additive and never overwrites — a clashing name gets a
      // suffix, and the rename is reported back so it isn't a surprise.
      const taken = new Set(listProfilesForDevice(fastify.db, id).map((p) => p.name));

      // In a transaction so a file that fails partway through leaves nothing
      // behind — a half-imported set is harder to reason about than a failed
      // import, and the user can't tell which profiles made it.
      const importAll = fastify.db.transaction((entries: typeof parsed.data.profiles) =>
        entries.map((entry) => {
          const name = resolveUniqueName(entry.name, taken);
          const created = insertProfile(fastify.db, id, { ...entry, name });
          return { id: created.id, name: created.name, renamedFrom: name === entry.name ? null : entry.name };
        }),
      );
      const imported = importAll(parsed.data.profiles);

      const result: ImportProfilesResult = { imported };
      return reply.code(201).send(result);
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
