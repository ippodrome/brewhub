import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createDbClient } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { createUser } from "../db/repositories/users.repo.js";
import { hashPassword } from "../auth/password.js";
import { loadConfig } from "../config/env.js";

// fastify.inject() drives real routing/plugins (rate-limit, JWT signing)
// without binding a real port — the right tool for testing behavior that
// only exists at the HTTP layer, which no repo-level unit test can reach.
async function setUp(configOverrides: Record<string, string> = {}) {
  const db = createDbClient(":memory:");
  runMigrations(db);
  createUser(db, "admin", hashPassword("correct-password"));

  const config = loadConfig({ NODE_ENV: "test", JWT_SECRET: "test-secret-at-least-16-chars", ...configOverrides });
  const app = await buildApp({ db, config });
  return app;
}

describe("POST /api/auth/login", () => {
  it("issues a token that carries an expiry claim", async () => {
    const app = await setUp({ JWT_EXPIRES_IN: "30d" });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "correct-password" },
    });

    expect(res.statusCode).toBe(200);
    const { token } = res.json();
    const decoded = app.jwt.decode(token) as { exp: number; iat: number };
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
    // ~30 days, allowing a little slack for the test's own execution time.
    expect(decoded.exp - decoded.iat).toBeGreaterThan(29 * 24 * 3600);
    expect(decoded.exp - decoded.iat).toBeLessThan(31 * 24 * 3600);
  });

  it("rate-limits repeated login attempts from the same client", async () => {
    const app = await setUp();

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "admin", password: "wrong-password" },
      });
      expect(res.statusCode).toBe(401); // still within the limit, just a bad password
    }

    const sixthAttempt = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "wrong-password" },
    });
    expect(sixthAttempt.statusCode).toBe(429);

    // Even the CORRECT password gets rate-limited once the window is hit —
    // the limit is per-client-per-route, not "5 wrong guesses specifically".
    const correctButLimited = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "correct-password" },
    });
    expect(correctButLimited.statusCode).toBe(429);
  });

  it("does not rate-limit other routes", async () => {
    const app = await setUp();

    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "admin", password: "wrong-password" },
      });
    }

    // /api/auth/login is now rate-limited, but an unrelated route (health
    // check, no auth needed) must be unaffected — confirms the rate-limit
    // plugin's encapsulation scope is actually just this one route, not
    // accidentally global.
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
  });
});
