import type { FirmwareBuild, MqttBrokerSettings, NotificationSettings } from "@brewhub/shared-types";
import type { UpdateCheck, UpdateStatus } from "../api/system";

/** Collapsible Settings sections. The id doubles as the URL hash (#mqtt). */
export const SETTINGS_SECTION_IDS = ["notifications", "mqtt", "updates", "firmware", "backup"] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

export const OPEN_SECTIONS_STORAGE_KEY = "brewhub.settings.openSections";

export function isSectionId(value: string): value is SettingsSectionId {
  return (SETTINGS_SECTION_IDS as readonly string[]).includes(value);
}

/** Parse the remembered open sections; anything malformed means "all collapsed". */
export function parseOpenSections(raw: string | null): SettingsSectionId[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((v): v is SettingsSectionId => typeof v === "string" && isSectionId(v)))];
  } catch {
    return [];
  }
}

export function toggleSection(open: readonly SettingsSectionId[], id: SettingsSectionId, next: boolean): SettingsSectionId[] {
  const without = open.filter((s) => s !== id);
  return next ? [...without, id] : without;
}

/** "#mqtt" → "mqtt"; unknown hashes → null. */
export function sectionFromHash(hash: string): SettingsSectionId | null {
  const id = decodeURIComponent(hash.replace(/^#/, "")).trim().toLowerCase();
  return isSectionId(id) ? id : null;
}

export function mqttSummary(s: MqttBrokerSettings | undefined): string {
  if (!s) return "Loading…";
  const label = s.mode === "builtin" ? "Built-in broker" : "Custom broker";
  const state = { connected: "Connected", connecting: "Connecting", disconnected: "Disconnected" }[s.status.state];
  return `${state} · ${label} · ${s.status.url}`;
}

export function notificationsSummary(s: NotificationSettings | undefined): string {
  if (!s) return "Loading…";
  const channels = ["Browser push"];
  if (s.telegramBotToken && s.telegramChatId) channels.push("Telegram");
  if (s.discordWebhookUrl) channels.push("Discord");
  return channels.length > 1 ? channels.join(" · ") : "Browser push only · Telegram and Discord not configured";
}

export function firmwareSummary(builds: FirmwareBuild[] | undefined): string {
  if (!builds) return "Loading…";
  if (builds.length === 0) return "No firmware uploaded";
  const devices = new Set(builds.map((b) => b.deviceId)).size;
  return `${builds.length} build${builds.length === 1 ? "" : "s"} · ${devices} device${devices === 1 ? "" : "s"}`;
}

export function updatesSummary(installed: string | undefined, check: UpdateCheck | undefined, status: UpdateStatus | undefined): string {
  if (status?.state === "running") return `Updating to ${status.toVersion ?? "new version"}…`;
  if (check?.updateAvailable) return `Update available · ${check.latest.version}`;
  return installed ? `Installed ${installed} · up to date` : "Loading…";
}

/** The Updates card stays open while there is something to act on. */
export function updatesForcedOpen(check: UpdateCheck | undefined, status: UpdateStatus | undefined): boolean {
  return status?.state === "running" || check?.updateAvailable === true;
}
