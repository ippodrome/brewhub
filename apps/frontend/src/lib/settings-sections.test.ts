import { describe, expect, it } from "vitest";
import {
  firmwareSummary,
  mqttSummary,
  notificationsSummary,
  parseOpenSections,
  sectionFromHash,
  toggleSection,
  updatesAttentionKey,
  updatesSummary,
} from "./settings-sections";

describe("settings sections", () => {
  it("parses stored open sections defensively", () => {
    expect(parseOpenSections(null)).toEqual([]);
    expect(parseOpenSections("nope")).toEqual([]);
    expect(parseOpenSections('{"a":1}')).toEqual([]);
    expect(parseOpenSections('["mqtt","bogus","mqtt",3,"backup"]')).toEqual(["mqtt", "backup"]);
  });
  it("toggles", () => {
    expect(toggleSection(["mqtt"], "backup", true)).toEqual(["mqtt", "backup"]);
    expect(toggleSection(["mqtt", "backup"], "mqtt", false)).toEqual(["backup"]);
    expect(toggleSection(["mqtt"], "mqtt", true)).toEqual(["mqtt"]);
  });
  it("maps hashes", () => {
    expect(sectionFromHash("#mqtt")).toBe("mqtt");
    expect(sectionFromHash("#Firmware")).toBe("firmware");
    expect(sectionFromHash("#x")).toBeNull();
    expect(sectionFromHash("")).toBeNull();
  });
  it("summarises mqtt", () => {
    const s = {
      mode: "custom", saved: true, host: "ha", port: 1883, tls: false, username: null, hasPassword: false,
      builtinUrl: "mqtt://mosquitto:1883",
      status: { state: "connected", url: "mqtt://ha:1883", lastError: null, connectedAt: 1 },
    } as const;
    expect(mqttSummary(s)).toBe("Connected · Custom broker · mqtt://ha:1883");
    expect(mqttSummary(undefined)).toBe("Loading…");
  });
  it("summarises notifications", () => {
    const base = { vapidPublicKey: null, telegramBotToken: null, telegramChatId: null, discordWebhookUrl: null };
    expect(notificationsSummary(base)).toMatch(/not configured/);
    expect(notificationsSummary({ ...base, telegramBotToken: "t", telegramChatId: "c", discordWebhookUrl: "d" })).toBe(
      "Browser push · Telegram · Discord",
    );
  });
  it("summarises firmware", () => {
    expect(firmwareSummary([])).toBe("No firmware uploaded");
    const b = { id: 1, deviceId: "a", board: "esp32", version: "1", filename: "f", sizeBytes: 1, md5: "x".repeat(32), uploadedAt: 1 };
    expect(firmwareSummary([b, { ...b, id: 2 }] as never)).toBe("2 builds · 1 device");
  });
  it("summarises updates and flags them for auto-open when actionable", () => {
    const check = { currentVersion: "1.1.0", latest: { version: "1.2.0" }, updateAvailable: true } as never;
    expect(updatesSummary("1.1.0", check, undefined)).toBe("Update available · 1.2.0");
    expect(updatesSummary("1.1.0", undefined, undefined)).toBe("Installed 1.1.0 · up to date");
    expect(updatesAttentionKey(check, undefined)).toBe("available:1.2.0");
    expect(updatesAttentionKey(undefined, { state: "running", toVersion: "1.2.0" } as never)).toBe("running:1.2.0");
    expect(updatesAttentionKey(undefined, { state: "succeeded" } as never)).toBeNull();
    expect(updatesAttentionKey({ updateAvailable: false } as never, undefined)).toBeNull();
  });
});
