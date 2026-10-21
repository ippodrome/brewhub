import type { FastifyInstance } from "fastify";

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/health", async () => {
    // version lets the updater confirm the *new* build is the one answering.
    return { status: "ok", version: fastify.appConfig.BREWHUB_VERSION, ts: Date.now() };
  });
}
