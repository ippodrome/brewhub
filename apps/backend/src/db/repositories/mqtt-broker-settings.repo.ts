import type Database from "better-sqlite3";
import type { MqttBrokerMode, UpdateMqttBrokerRequest } from "@brewhub/shared-types";
import type { AppConfig } from "../../config/env.js";

interface MqttBrokerSettingsRow {
  id: number;
  mode: MqttBrokerMode | null;
  host: string | null;
  port: number;
  tls: number;
  username: string | null;
  password: string | null;
  updated_at: number;
}

/** Everything mqtt.connect() needs. Contains the password — backend-internal only. */
export interface MqttConnectionParams {
  url: string;
  username?: string;
  password?: string;
}

export interface StoredMqttBrokerSettings {
  mode: MqttBrokerMode;
  saved: boolean;
  host: string | null;
  port: number;
  tls: boolean;
  username: string | null;
  hasPassword: boolean;
}

function getRow(db: Database.Database): MqttBrokerSettingsRow {
  const row = db.prepare<[], MqttBrokerSettingsRow>("SELECT * FROM mqtt_broker_settings WHERE id = 1").get();
  if (!row) throw new Error("mqtt_broker_settings singleton row is missing — migration 0019 didn't run?");
  return row;
}

/** API-safe view: hasPassword instead of the password. */
export function getMqttBrokerSettings(db: Database.Database): StoredMqttBrokerSettings {
  const row = getRow(db);
  return {
    mode: row.mode ?? "builtin",
    saved: row.mode !== null,
    host: row.host,
    port: row.port,
    tls: row.tls === 1,
    username: row.username,
    hasPassword: !!row.password,
  };
}

/**
 * Persists the card. Switching to "builtin" keeps the custom fields (so
 * switching back doesn't mean retyping them). An empty/omitted password
 * keeps the stored one; clearPassword removes it.
 */
export function saveMqttBrokerSettings(db: Database.Database, req: UpdateMqttBrokerRequest): StoredMqttBrokerSettings {
  const current = getRow(db);
  if (req.mode === "builtin") {
    db.prepare("UPDATE mqtt_broker_settings SET mode = 'builtin', updated_at = unixepoch() WHERE id = 1").run();
  } else {
    db.prepare(
      `UPDATE mqtt_broker_settings SET mode = 'custom', host = @host, port = @port, tls = @tls,
         username = @username, password = @password, updated_at = unixepoch() WHERE id = 1`,
    ).run({
      host: req.host,
      port: req.port,
      tls: req.tls ? 1 : 0,
      username: req.username ? req.username : null,
      password: resolvePassword(current.password, req),
    });
  }
  return getMqttBrokerSettings(db);
}

function resolvePassword(stored: string | null, req: { password?: string | null; clearPassword?: boolean }): string | null {
  if (req.password) return req.password;
  if (req.clearPassword) return null;
  return stored;
}

export function buildBrokerUrl(host: string, port: number, tls: boolean): string {
  const h = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${tls ? "mqtts" : "mqtt"}://${h}:${port}`;
}

/** Strips any user:pass@ from a URL for display/logging. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/\/\/[^@/]*@/, "//");
  }
}

function envParams(config: AppConfig): MqttConnectionParams {
  return { url: config.MQTT_URL, username: config.MQTT_USERNAME || undefined, password: config.MQTT_PASSWORD || undefined };
}

/**
 * Connection params for a request (save or test) without persisting it.
 * Custom requests with no password fall back to the stored one, so "Test"
 * works on an already-saved broker without retyping the password.
 */
export function connectionParamsFor(
  db: Database.Database,
  config: AppConfig,
  req: UpdateMqttBrokerRequest,
): MqttConnectionParams {
  if (req.mode === "builtin") return envParams(config);
  const password = resolvePassword(getRow(db).password, req);
  return {
    url: buildBrokerUrl(req.host, req.port, req.tls),
    username: req.username || undefined,
    password: password ?? undefined,
  };
}

/** What the backend should connect to right now. Env when nothing (or "builtin") is saved. */
export function resolveMqttConnection(db: Database.Database, config: AppConfig): MqttConnectionParams {
  const row = getRow(db);
  if (row.mode !== "custom" || !row.host) return envParams(config);
  return {
    url: buildBrokerUrl(row.host, row.port, row.tls === 1),
    username: row.username ?? undefined,
    password: row.password ?? undefined,
  };
}
