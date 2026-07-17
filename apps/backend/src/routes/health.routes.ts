import type { FastifyInstance } from "fastify";

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/health", async () => {
    return { status: "ok", ts: Date.now() };
  });
}
