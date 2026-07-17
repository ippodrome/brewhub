import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    verifyAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyJWT {
    payload: { username: string };
  }
}

export const authPlugin = fp(async (fastify: FastifyInstance) => {
  await fastify.register(jwt, { secret: fastify.appConfig.JWT_SECRET });

  fastify.decorate("verifyAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });
});
