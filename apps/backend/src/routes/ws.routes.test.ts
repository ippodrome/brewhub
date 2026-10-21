import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createDbClient } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { loadConfig } from "../config/env.js";

async function setUp() {
  const db = createDbClient(":memory:");
  runMigrations(db);
  const config = loadConfig({ NODE_ENV: "test", JWT_SECRET: "test-secret-at-least-16-chars" });
  const app = await buildApp({ db, config });
  await app.ready();
  return app;
}

// The route sends device_list immediately on connect, so the listener must
// be attached in onInit (before the handshake completes) or it is missed.
async function connectAndReadFirst(
  app: Awaited<ReturnType<typeof setUp>>,
  path: string,
  headers: Record<string, string> = {},
) {
  let resolveMessage!: (value: unknown) => void;
  const first = new Promise<unknown>((resolve) => (resolveMessage = resolve));
  const ws = await app.injectWS(path, { headers }, {
    onInit: (socket) => socket.once("message", (data) => resolveMessage(JSON.parse(String(data)))),
  });
  return { ws, message: await first };
}

describe("GET /ws auth", () => {
  it("rejects a connection without a token", async () => {
    const app = await setUp();
    await expect(app.injectWS("/ws")).rejects.toThrow(/401/);
    await app.close();
  });

  it("rejects a connection with an invalid token", async () => {
    const app = await setUp();
    await expect(app.injectWS("/ws?token=not-a-jwt")).rejects.toThrow(/401/);
    const forged = app.jwt.sign({ username: "admin" }).slice(0, -3) + "abc";
    await expect(app.injectWS(`/ws?token=${forged}`)).rejects.toThrow(/401/);
    await app.close();
  });

  it("accepts a valid JWT via ?token= and sends the device list", async () => {
    const app = await setUp();
    const token = app.jwt.sign({ username: "admin" });
    const { ws, message } = await connectAndReadFirst(app, `/ws?token=${token}`);
    expect(message).toMatchObject({ type: "device_list", payload: [] });
    ws.terminate();
    await app.close();
  });

  it("accepts a valid JWT via the Authorization header", async () => {
    const app = await setUp();
    const token = app.jwt.sign({ username: "admin" });
    const { ws, message } = await connectAndReadFirst(app, "/ws", { authorization: `Bearer ${token}` });
    expect(message).toMatchObject({ type: "device_list" });
    ws.terminate();
    await app.close();
  });
});
