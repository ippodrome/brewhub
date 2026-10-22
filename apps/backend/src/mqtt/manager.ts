import mqtt, { type IClientOptions, type MqttClient } from "mqtt";
import type { FastifyBaseLogger } from "fastify";
import type { MqttConnectionStatus } from "@brewhub/shared-types";
import { redactUrl, type MqttConnectionParams } from "../db/repositories/mqtt-broker-settings.repo.js";

export type MqttClientFactory = (params: MqttConnectionParams) => MqttClient;
export type MqttConnectFn = (url: string, options: IClientOptions) => MqttClient;

export interface MqttTestResult {
  ok: boolean;
  url: string;
  latencyMs: number | null;
  error: string | null;
}

export interface MqttConnectionManagerOptions {
  /** Builds the long-lived client (subscriptions + message handlers live there). */
  factory: MqttClientFactory;
  logger: FastifyBaseLogger;
  /** Used only by test(); injectable for unit tests. */
  connectFn?: MqttConnectFn;
  /** Called on the first successful connect after switchTo(), e.g. to republish HA discovery. */
  onSwitched?: (client: MqttClient) => void;
}

function message(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" && !err.message.includes(code) ? `${err.message} (${code})` : err.message;
  }
  return String(err);
}

/**
 * Owns the backend's one MQTT client and lets it be swapped at runtime when
 * the broker setting changes, without restarting the container. Everything
 * else holds `facade`, a stable MqttClient-shaped proxy that always forwards
 * to the current client — so publish helpers, the profile scheduler and
 * route handlers keep working across a switch with no re-wiring.
 */
export class MqttConnectionManager {
  private client: MqttClient | null = null;
  private params: MqttConnectionParams | null = null;
  private state: MqttConnectionStatus["state"] = "disconnected";
  private lastError: string | null = null;
  private connectedAt: number | null = null;
  private generation = 0;

  readonly facade: MqttClient;

  constructor(private readonly options: MqttConnectionManagerOptions) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.facade = new Proxy({} as MqttClient, {
      get(_target, prop) {
        const current = self.client;
        if (!current) throw new Error("MQTT client not started");
        const value = Reflect.get(current, prop, current) as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(current) : value;
      },
    });
  }

  get current(): MqttClient | null {
    return this.client;
  }

  start(params: MqttConnectionParams): MqttClient {
    if (this.client) throw new Error("MqttConnectionManager already started");
    return this.attach(params, false);
  }

  /**
   * Replaces the running client with one for `params` and resolves once it
   * has connected or `timeoutMs` passed. The new client is kept either way
   * (it keeps retrying in the background, like the env-configured one always
   * did) — the caller just learns whether it came up in time.
   */
  async switchTo(params: MqttConnectionParams, timeoutMs = 5000): Promise<MqttConnectionStatus> {
    const old = this.client;
    this.client = null;
    if (old) {
      old.removeAllListeners();
      // Swallow late errors from the old socket so they can't crash the process.
      old.on("error", () => undefined);
      old.end(true);
    }
    this.connectedAt = null;
    this.lastError = null;
    const next = this.attach(params, true);
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        next.off("connect", done);
        next.off("error", done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      next.once("connect", done);
      next.once("error", done);
    });
    return this.status();
  }

  status(): MqttConnectionStatus {
    return {
      state: this.state,
      url: this.params ? redactUrl(this.params.url) : "",
      lastError: this.lastError,
      connectedAt: this.connectedAt,
    };
  }

  /**
   * One-shot connection test on a separate, throwaway client (own client id,
   * no retries, no subscriptions) — the running client is never touched.
   */
  async test(params: MqttConnectionParams, timeoutMs = 5000): Promise<MqttTestResult> {
    const connect = this.options.connectFn ?? mqtt.connect;
    const url = redactUrl(params.url);
    const started = Date.now();
    let probe: MqttClient;
    try {
      probe = connect(params.url, {
        username: params.username,
        password: params.password,
        clientId: `brewhub-test-${Math.random().toString(16).slice(2, 10)}`,
        reconnectPeriod: 0,
        connectTimeout: timeoutMs,
        clean: true,
      });
    } catch (err) {
      return { ok: false, url, latencyMs: null, error: message(err) };
    }
    return new Promise<MqttTestResult>((resolve) => {
      let settled = false;
      const finish = (result: MqttTestResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        probe.removeAllListeners();
        probe.on("error", () => undefined);
        probe.end(true);
        resolve(result);
      };
      const timer = setTimeout(
        () => finish({ ok: false, url, latencyMs: null, error: `No answer from broker within ${Math.round(timeoutMs / 1000)} s` }),
        timeoutMs,
      );
      probe.once("connect", () => finish({ ok: true, url, latencyMs: Date.now() - started, error: null }));
      probe.once("error", (err) => finish({ ok: false, url, latencyMs: null, error: message(err) }));
      probe.once("close", () => finish({ ok: false, url, latencyMs: null, error: "Connection closed by broker" }));
    });
  }

  async stop(): Promise<void> {
    const c = this.client;
    this.client = null;
    this.state = "disconnected";
    if (c) await new Promise<void>((r) => c.end(true, {}, () => r()));
  }

  private attach(params: MqttConnectionParams, switched: boolean): MqttClient {
    const gen = ++this.generation;
    this.params = params;
    this.state = "connecting";
    const client = this.options.factory(params);
    this.client = client;
    let notifiedSwitch = !switched;
    const mine = (): boolean => gen === this.generation;

    client.on("connect", () => {
      if (!mine()) return;
      this.state = "connected";
      this.lastError = null;
      this.connectedAt = Date.now();
      if (!notifiedSwitch) {
        notifiedSwitch = true;
        this.options.logger.info({ url: redactUrl(params.url) }, "MQTT switched to new broker");
        this.options.onSwitched?.(client);
      }
    });
    client.on("reconnect", () => {
      if (mine()) this.state = "connecting";
    });
    client.on("close", () => {
      if (mine() && this.state === "connected") this.state = "disconnected";
    });
    client.on("offline", () => {
      if (mine()) this.state = "disconnected";
    });
    client.on("error", (err) => {
      if (!mine()) return;
      this.lastError = message(err);
      if (this.state !== "connected") this.state = "disconnected";
    });
    return client;
  }
}
