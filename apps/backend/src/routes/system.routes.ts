import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

/**
 * In-app update endpoints. The backend has no Docker access at all — it
 * only relays to the separate `updater` service (docker/updater), which is
 * reachable solely on the internal compose network and requires a shared
 * secret. BrewHub has a single admin account, so "authenticated" is "admin".
 */
export interface SystemRoutesOptions {
  fetchImpl: typeof fetch;
}

const UpdateBody = z.object({ version: z.string().regex(/^v?\d+\.\d+\.\d+$/), dryRun: z.boolean().optional() });

export async function systemRoutes(fastify: FastifyInstance, opts: SystemRoutesOptions): Promise<void> {
  const cfg = fastify.appConfig;
  const configured = Boolean(cfg.UPDATER_URL && cfg.UPDATER_SECRET);
  let cache: { at: number; body: unknown } | null = null;

  /** Sends the (mapped) updater response on `reply`; returns the body when it was a 200. */
  async function callUpdater(reply: FastifyReply, path: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<unknown> {
    if (!configured) {
      reply.code(503).send({ error: "updater_not_configured", message: "In-app updates are not set up (see docs/UPDATERING.md)." });
      return undefined;
    }
    let res: Response;
    try {
      res = await opts.fetchImpl(new URL(path, cfg.UPDATER_URL).toString(), {
        ...init,
        headers: { Authorization: `Bearer ${cfg.UPDATER_SECRET}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      fastify.log.warn({ err }, "updater unreachable");
      reply.code(502).send({ error: "updater_unreachable", message: "The updater service did not answer." });
      return undefined;
    }
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: "bad_updater_response" };
    }
    if (res.status === 401) {
      // Never forward the updater's 401 as-is: the browser would read it as
      // "your session expired" and log the user out.
      reply.code(502).send({ error: "updater_auth_failed", message: "UPDATER_SECRET does not match the updater." });
      return undefined;
    }
    const code = res.ok ? 200 : res.status >= 500 ? 502 : res.status;
    reply.code(code).send(body);
    return code === 200 ? body : undefined;
  }

  fastify.get("/api/system/version", { preHandler: fastify.verifyAuth }, async () => ({
    version: cfg.BREWHUB_VERSION,
    updaterConfigured: configured,
  }));

  fastify.get<{ Querystring: { force?: string } }>(
    "/api/system/update/check",
    { preHandler: fastify.verifyAuth },
    async (request, reply) => {
      const force = request.query.force === "1" || request.query.force === "true";
      if (!force && cache && Date.now() - cache.at < cfg.UPDATE_CHECK_CACHE_MS) {
        return reply.send({ ...(cache.body as object), cached: true });
      }
      const body = await callUpdater(reply, "/check");
      if (body !== undefined) cache = { at: Date.now(), body };
      return reply;
    },
  );

  fastify.get("/api/system/update/status", { preHandler: fastify.verifyAuth }, async (_request, reply) => {
    await callUpdater(reply, "/status", {}, 8_000);
    return reply;
  });

  fastify.post("/api/system/update", { preHandler: fastify.verifyAuth }, async (request, reply) => {
    const parsed = UpdateBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "version must look like 1.2.3" });
    cache = null; // the next check should reflect the new state
    await callUpdater(reply, "/update", { method: "POST", body: JSON.stringify(parsed.data) });
    return reply;
  });
}
