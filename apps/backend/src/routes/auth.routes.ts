import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { LoginRequestSchema } from "@brewhub/shared-types";
import { getUserByUsername } from "../db/repositories/users.repo.js";
import { verifyPassword } from "../auth/password.js";

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // Registered inside this plugin function, not at the app level — Fastify's
  // encapsulation means this only rate-limits routes registered within this
  // same scope (today, just login), not the whole API. Without this, login
  // had no defense against unlimited password-guessing attempts.
  await fastify.register(rateLimit, {
    max: 5,
    timeWindow: "1 minute",
  });

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

    // expiresIn: a token that never expires is valid forever if it ever
    // leaks — see env.ts's doc comment on JWT_EXPIRES_IN.
    const token = fastify.jwt.sign({ username: user.username }, { expiresIn: fastify.appConfig.JWT_EXPIRES_IN });
    return reply.send({ token });
  });
}
