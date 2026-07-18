import { createReadStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { FastifyInstance } from "fastify";
import { CreateFirmwareBuildRequestSchema } from "@brewhub/shared-types";
import {
  deleteFirmwareBuild,
  getFirmwareBuild,
  insertFirmwareBuild,
  listFirmwareBuilds,
} from "../db/repositories/firmware-builds.repo.js";
import { consumeOtaToken } from "../db/repositories/ota-tokens.repo.js";

/** Also used by app.ts to configure the @fastify/multipart file-size limit. */
export const MAX_FIRMWARE_BYTES = 4 * 1024 * 1024;

function firmwareDir(fastify: FastifyInstance): string {
  return join(dirname(fastify.appConfig.DB_PATH), "firmware");
}

export async function firmwareRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/api/firmware", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    // @fastify/multipart's attachFieldsToBody: 'keyValues' mode (registered
    // in app.ts) gives plain strings for text fields and a Buffer for the
    // file field directly on request.body — no .value wrapper.
    const body = request.body as
      | { deviceId?: string; board?: string; version?: string; file?: Buffer }
      | undefined;

    if (!body?.file || !Buffer.isBuffer(body.file)) {
      return reply.code(400).send({ error: "Missing file field" });
    }
    // The global multipart limit (app.ts) is sized for the largest upload in
    // the app (a DB restore) — enforce firmware's own tighter limit here.
    if (body.file.byteLength > MAX_FIRMWARE_BYTES) {
      return reply.code(413).send({ error: "Firmware binary exceeds the maximum allowed size" });
    }

    const parsed = CreateFirmwareBuildRequestSchema.safeParse({
      deviceId: body.deviceId,
      board: body.board,
      version: body.version,
    });
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const dir = firmwareDir(fastify);
    await mkdir(dir, { recursive: true });

    const filename = `${randomUUID()}.bin`;
    await writeFile(join(dir, filename), body.file);
    const md5 = createHash("md5").update(body.file).digest("hex");

    const build = insertFirmwareBuild(fastify.db, parsed.data, filename, body.file.byteLength, md5);
    return reply.code(201).send(build);
  });

  fastify.get("/api/firmware", { preHandler: fastify.verifyAuth }, async (request) => {
    const { deviceId } = request.query as { deviceId?: string };
    return listFirmwareBuilds(fastify.db, deviceId);
  });

  fastify.delete("/api/firmware/:id", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    const build = getFirmwareBuild(fastify.db, numericId);
    if (!build) return reply.code(404).send({ error: "Firmware build not found" });

    await unlink(join(firmwareDir(fastify), build.filename)).catch(() => {
      // File already gone (e.g. manual cleanup) — still remove the DB row.
    });
    deleteFirmwareBuild(fastify.db, numericId);
    return reply.code(204).send();
  });

  // No preHandler: fastify.verifyAuth here on purpose — a device has no
  // user session to send a JWT with. Accepts EITHER a valid JWT (browser/
  // WebSerial use) OR a valid single-use ?token= (device OTA download,
  // minted by POST /api/devices/:id/ota — see ota-tokens.repo.ts).
  fastify.get("/api/firmware/:id/download", async (request, reply) => {
    const { id } = request.params as { id: string };
    const numericId = Number(id);
    const build = getFirmwareBuild(fastify.db, numericId);
    if (!build) return reply.code(404).send({ error: "Firmware build not found" });

    let authorized = false;
    try {
      await request.jwtVerify();
      authorized = true;
    } catch {
      const { token } = request.query as { token?: string };
      if (token && consumeOtaToken(fastify.db, token, numericId, Date.now())) {
        authorized = true;
      }
    }
    if (!authorized) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    const filePath = join(firmwareDir(fastify), build.filename);
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Disposition", `attachment; filename="${build.filename}"`);
    return reply.send(createReadStream(filePath));
  });
}
