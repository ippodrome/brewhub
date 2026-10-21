import type { FastifyInstance } from "fastify";
import {
  ApplyTemplateRequestSchema,
  CreateProfileRequestSchema,
  SaveAsTemplateRequestSchema,
  UpdateProfileRequestSchema,
  type ApplyTemplateResult,
  ProfileExportSchema,
  type ImportProfilesResult,
} from "@brewhub/shared-types";
import { buildProfileExport, exportFilename, resolveUniqueName } from "../profiles/export.js";
import { getDevice } from "../db/repositories/devices.repo.js";
import {
  deleteProfile,
  getProfile,
  insertProfile,
  deleteTemplate,
  getTemplate,
  insertTemplate,
  listProfilesForDevice,
  listTemplates,
  updateProfile,
  updateTemplate,
} from "../db/repositories/profiles.repo.js";
import {
  clearActiveProfile,
  getActiveProfileState,
  setActiveProfile,
} from "../db/repositories/device-configs.repo.js";
import { getHydrometerForFermenter } from "../db/repositories/hydrometers.repo.js";
import { computeProgress, pushActiveProfileSetpoint } from "../profiles/active.js";

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

  // --- Editing ---------------------------------------------------------------

  /**
   * Replace a profile's name and steps. If the device is following it, the
   * original start time is kept and the newly resolved setpoint is published
   * at once — editing a running brew should never silently restart it.
   */
  fastify.put(
    "/api/devices/:id/profiles/:profileId",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id, profileId } = request.params as { id: string; profileId: string };
      const numericId = Number(profileId);
      const existing = getProfile(fastify.db, numericId);
      if (!existing || existing.deviceId !== id) {
        return reply.code(404).send({ error: "Profile not found" });
      }
      const parsed = UpdateProfileRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
      }
      const active = getActiveProfileState(fastify.db, id);
      const isActive = active?.activeProfileId === numericId;
      if (isActive && parsed.data.triggerType === "gravity" && !getHydrometerForFermenter(fastify.db, id)) {
        return reply
          .code(400)
          .send({ error: "This device has no hydrometer assigned — a running profile can't switch to gravity steps" });
      }
      const updated = updateProfile(fastify.db, numericId, parsed.data);
      if (isActive) pushActiveProfileSetpoint(fastify.db, fastify.mqttClient, id, Date.now());
      return reply.send(updated);
    },
  );

  // --- Progress / restart ------------------------------------------------------

  fastify.get(
    "/api/devices/:id/profiles/active",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!getDevice(fastify.db, id)) {
        return reply.code(404).send({ error: "Device not found" });
      }
      return computeProgress(fastify.db, id, Date.now());
    },
  );

  /** Start the active profile over from step 1 (resets profile_started_at to now). */
  fastify.post(
    "/api/devices/:id/profiles/active/restart",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!getDevice(fastify.db, id)) {
        return reply.code(404).send({ error: "Device not found" });
      }
      const active = getActiveProfileState(fastify.db, id);
      if (!active) {
        return reply.code(409).send({ error: "This device isn't following a profile" });
      }
      const now = Date.now();
      setActiveProfile(fastify.db, id, active.activeProfileId, now);
      pushActiveProfileSetpoint(fastify.db, fastify.mqttClient, id, now);
      return computeProgress(fastify.db, id, now);
    },
  );

  // --- Templates ---------------------------------------------------------------
  // Shared across devices and independent of them: removing a device never
  // removes a template, and applying one makes a copy on the device.

  fastify.get("/api/profile-templates", { preHandler: fastify.verifyAuth }, async () => listTemplates(fastify.db));

  fastify.post("/api/profile-templates", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const parsed = CreateProfileRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    return reply.code(201).send(insertTemplate(fastify.db, parsed.data));
  });

  fastify.put(
    "/api/profile-templates/:templateId",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { templateId } = request.params as { templateId: string };
      const parsed = UpdateProfileRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
      }
      const updated = updateTemplate(fastify.db, Number(templateId), parsed.data);
      if (!updated) return reply.code(404).send({ error: "Template not found" });
      return reply.send(updated);
    },
  );

  fastify.delete(
    "/api/profile-templates/:templateId",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { templateId } = request.params as { templateId: string };
      if (!deleteTemplate(fastify.db, Number(templateId))) {
        return reply.code(404).send({ error: "Template not found" });
      }
      return reply.code(204).send();
    },
  );

  /** Copy a device profile into the shared template library. */
  fastify.post(
    "/api/devices/:id/profiles/:profileId/save-as-template",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { id, profileId } = request.params as { id: string; profileId: string };
      const profile = getProfile(fastify.db, Number(profileId));
      if (!profile || profile.deviceId !== id) {
        return reply.code(404).send({ error: "Profile not found" });
      }
      const parsed = SaveAsTemplateRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
      }
      const taken = new Set(listTemplates(fastify.db).map((t) => t.name));
      const name = resolveUniqueName(parsed.data.name ?? profile.name, taken);
      const template =
        profile.triggerType === "time"
          ? insertTemplate(fastify.db, { name, triggerType: "time", steps: profile.steps })
          : insertTemplate(fastify.db, { name, triggerType: "gravity", steps: profile.steps });
      return reply.code(201).send(template);
    },
  );

  /** Copy a template onto a device, optionally starting it right away. */
  fastify.post(
    "/api/profile-templates/:templateId/apply",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const { templateId } = request.params as { templateId: string };
      const template = getTemplate(fastify.db, Number(templateId));
      if (!template) return reply.code(404).send({ error: "Template not found" });

      const parsed = ApplyTemplateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
      }
      const { deviceId, activate = false } = parsed.data;
      const device = getDevice(fastify.db, deviceId);
      if (!device) return reply.code(404).send({ error: "Device not found" });
      if (device.type !== "fermenter") {
        return reply.code(400).send({ error: "Profiles can only be applied to fermenters" });
      }
      if (activate && template.triggerType === "gravity" && !getHydrometerForFermenter(fastify.db, deviceId)) {
        return reply
          .code(400)
          .send({ error: "This device has no hydrometer assigned — assign one before activating a gravity-based profile" });
      }

      const taken = new Set(listProfilesForDevice(fastify.db, deviceId).map((p) => p.name));
      const name = resolveUniqueName(parsed.data.name ?? template.name, taken);
      const profile =
        template.triggerType === "time"
          ? insertProfile(fastify.db, deviceId, { name, triggerType: "time", steps: template.steps })
          : insertProfile(fastify.db, deviceId, { name, triggerType: "gravity", steps: template.steps });

      if (activate) {
        const now = Date.now();
        setActiveProfile(fastify.db, deviceId, profile.id, now);
        pushActiveProfileSetpoint(fastify.db, fastify.mqttClient, deviceId, now);
      }
      const result: ApplyTemplateResult = { profile, activated: activate };
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
