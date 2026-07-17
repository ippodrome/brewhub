import type { FastifyInstance } from "fastify";
import { LoginRequestSchema } from "@brewhub/shared-types";
import { getUserByUsername } from "../db/repositories/users.repo.js";
import { verifyPassword } from "../auth/password.js";

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/api/auth/login", async (request, reply) => {
    const parsed = LoginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    const { username, password } = parsed.data;
    const user = getUserByUsername(fastify.db, username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: "Invalid username or password" });
    }

    const token = fastify.jwt.sign({ username: user.username });
    return reply.send({ token });
  });
}
