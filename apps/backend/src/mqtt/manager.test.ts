import { describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { MqttConnectionManager } from "./manager.js";
import { FakeMqttClient } from "./fake-client.test-helper.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as FastifyBaseLogger;

function setUp() {
  const created: FakeMqttClient[] = [];
  const probes: FakeMqttClient[] = [];
  const onSwitched = vi.fn();
  const manager = new MqttConnectionManager({
    logger,
    onSwitched,
    factory: (p) => {
      const c = new FakeMqttClient(p.url, { username: p.username, password: p.password });
      created.push(c);
      return c.asClient();
    },
    connectFn: (url, opts) => {
      const c = new FakeMqttClient(url, opts as Record<string, unknown>);
      probes.push(c);
      return c.asClient();
    },
  });
  return { manager, created, probes, onSwitched };
}

describe("MqttConnectionManager", () => {
  it("tracks connected / disconnected state and the last error", () => {
    const { manager, created } = setUp();
    manager.start({ url: "mqtt://a:1883" });
    expect(manager.status().state).toBe("connecting");
    created[0]!.emit("connect");
    expect(manager.status()).toMatchObject({ state: "connected", url: "mqtt://a:1883", lastError: null });
    created[0]!.emit("offline");
    created[0]!.emit("error", new Error("Connection refused: Not authorized"));
    expect(manager.status()).toMatchObject({ state: "disconnected", lastError: "Connection refused: Not authorized" });
  });

  it("facade always forwards to the current client, across a switch", async () => {
    const { manager, created, onSwitched } = setUp();
    manager.start({ url: "mqtt://a:1883" });
    const facade = manager.facade;
    facade.publish("t/1", "x");
    expect(created[0]!.published).toHaveLength(1);

    const pending = manager.switchTo({ url: "mqtt://b:1883", username: "u", password: "p" }, 1000);
    expect(created[0]!.ended).toBe(true);
    created[1]!.emit("connect");
    const status = await pending;
    expect(status).toMatchObject({ state: "connected", url: "mqtt://b:1883" });
    expect(created[1]!.opts).toMatchObject({ username: "u", password: "p" });
    expect(onSwitched).toHaveBeenCalledTimes(1);

    facade.publish("t/2", "y");
    expect(created[1]!.published).toEqual([{ topic: "t/2", message: "y" }]);
    expect(created[0]!.published).toHaveLength(1);
  });

  it("ignores events from the replaced client", async () => {
    const { manager, created } = setUp();
    manager.start({ url: "mqtt://a:1883" });
    const p = manager.switchTo({ url: "mqtt://b:1883" }, 1000);
    created[0]!.emit("connect");
    created[0]!.emit("error", new Error("late"));
    created[1]!.emit("error", new Error("ECONNREFUSED"));
    const s = await p;
    expect(s).toMatchObject({ state: "disconnected", lastError: "ECONNREFUSED" });
  });

  it("switchTo resolves after the timeout when the broker never answers, keeping the new client", async () => {
    vi.useFakeTimers();
    const { manager, created } = setUp();
    manager.start({ url: "mqtt://a:1883" });
    const p = manager.switchTo({ url: "mqtt://dead:1883" }, 3000);
    await vi.advanceTimersByTimeAsync(3000);
    expect((await p).state).toBe("connecting");
    expect(manager.current).toBe(created[1]);
    vi.useRealTimers();
  });

  it("test() uses a throwaway client and never touches the running one", async () => {
    const { manager, created, probes } = setUp();
    manager.start({ url: "mqtt://a:1883" });
    created[0]!.emit("connect");
    const p = manager.test({ url: "mqtt://u:pw@ha:1883", username: "u", password: "pw" }, 1000);
    expect(probes[0]!.opts).toMatchObject({ reconnectPeriod: 0, username: "u", password: "pw" });
    probes[0]!.emit("connect");
    const r = await p;
    expect(r).toMatchObject({ ok: true, url: "mqtt://ha:1883", error: null });
    expect(probes[0]!.ended).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]!.ended).toBe(false);
    expect(manager.status().state).toBe("connected");
  });

  it("test() reports errors and timeouts", async () => {
    const { manager, probes } = setUp();
    manager.start({ url: "mqtt://a:1883" });
    const failing = manager.test({ url: "mqtt://ha:1883" }, 1000);
    probes[0]!.emit("error", new Error("Connection refused: Bad username or password"));
    expect(await failing).toMatchObject({ ok: false, error: "Connection refused: Bad username or password" });

    vi.useFakeTimers();
    const silent = manager.test({ url: "mqtt://ha:1883" }, 2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await silent).toMatchObject({ ok: false, error: "No answer from broker within 2 s" });
    expect(probes[1]!.ended).toBe(true);
    vi.useRealTimers();
  });
});
