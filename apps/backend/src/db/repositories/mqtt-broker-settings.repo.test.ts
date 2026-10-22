import { describe, expect, it } from "vitest";
import { createDbClient } from "../client.js";
import { runMigrations } from "../migrate.js";
import { loadConfig } from "../../config/env.js";
import {
  buildBrokerUrl,
  connectionParamsFor,
  getMqttBrokerSettings,
  redactUrl,
  resolveMqttConnection,
  saveMqttBrokerSettings,
} from "./mqtt-broker-settings.repo.js";

const config = loadConfig({
  NODE_ENV: "test",
  JWT_SECRET: "test-secret-at-least-16-chars",
  MQTT_URL: "mqtt://mosquitto:1883",
  MQTT_USERNAME: "backend",
  MQTT_PASSWORD: "env-pass",
});

function db() {
  const d = createDbClient(":memory:");
  runMigrations(d);
  return d;
}

describe("mqtt-broker-settings repo", () => {
  it("falls back to env values when nothing has been saved", () => {
    const d = db();
    expect(getMqttBrokerSettings(d)).toMatchObject({ mode: "builtin", saved: false, hasPassword: false });
    expect(resolveMqttConnection(d, config)).toEqual({ url: "mqtt://mosquitto:1883", username: "backend", password: "env-pass" });
  });

  it("stores a custom broker and resolves to it", () => {
    const d = db();
    const saved = saveMqttBrokerSettings(d, { mode: "custom", host: "192.168.1.20", port: 8883, tls: true, username: "brewhub", password: "s3cret" });
    expect(saved).toEqual({ mode: "custom", saved: true, host: "192.168.1.20", port: 8883, tls: true, username: "brewhub", hasPassword: true });
    expect(saved).not.toHaveProperty("password");
    expect(resolveMqttConnection(d, config)).toEqual({ url: "mqtts://192.168.1.20:8883", username: "brewhub", password: "s3cret" });
  });

  it("keeps the stored password when saved with an empty one, and clears it on request", () => {
    const d = db();
    saveMqttBrokerSettings(d, { mode: "custom", host: "ha.local", port: 1883, tls: false, username: "u", password: "keep-me" });
    saveMqttBrokerSettings(d, { mode: "custom", host: "ha.local", port: 1884, tls: false, username: "u", password: "" });
    expect(resolveMqttConnection(d, config).password).toBe("keep-me");
    saveMqttBrokerSettings(d, { mode: "custom", host: "ha.local", port: 1884, tls: false, username: "u", clearPassword: true });
    expect(resolveMqttConnection(d, config).password).toBeUndefined();
    expect(getMqttBrokerSettings(d).hasPassword).toBe(false);
  });

  it("switching back to built-in uses env but remembers the custom fields", () => {
    const d = db();
    saveMqttBrokerSettings(d, { mode: "custom", host: "ha.local", port: 1883, tls: false, username: "u", password: "p" });
    saveMqttBrokerSettings(d, { mode: "builtin" });
    expect(resolveMqttConnection(d, config).url).toBe("mqtt://mosquitto:1883");
    expect(getMqttBrokerSettings(d)).toMatchObject({ mode: "builtin", saved: true, host: "ha.local", hasPassword: true });
  });

  it("connectionParamsFor uses the stored password for an unsaved test without one", () => {
    const d = db();
    saveMqttBrokerSettings(d, { mode: "custom", host: "ha.local", port: 1883, tls: false, username: "u", password: "stored" });
    expect(connectionParamsFor(d, config, { mode: "custom", host: "other", port: 1883, tls: false, username: "u" })).toEqual({
      url: "mqtt://other:1883",
      username: "u",
      password: "stored",
    });
    expect(connectionParamsFor(d, config, { mode: "builtin" }).url).toBe("mqtt://mosquitto:1883");
  });

  it("builds and redacts URLs", () => {
    expect(buildBrokerUrl("fd00::5", 1883, false)).toBe("mqtt://[fd00::5]:1883");
    expect(redactUrl("mqtt://user:pw@host:1883")).toBe("mqtt://host:1883");
  });
});
