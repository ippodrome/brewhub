/**
 * Two different questions the UI used to answer with one green badge:
 *
 *  - Is *this browser* connected to the BrewHub server? (WebSocket state)
 *  - Are the *devices* reporting in?
 *
 * The old header showed a green "Live" whenever the socket was open, even
 * with every device offline, which read as "all good". These helpers keep
 * the two apart so each gets its own, honestly-coloured indicator.
 */

export type Tone = "ok" | "warn" | "crit" | "idle";

export interface FleetSummary {
  total: number;
  online: number;
  tone: Tone;
  label: string;
}

export function summarizeFleet(devices: ReadonlyArray<{ isOnline: boolean }>): FleetSummary {
  const total = devices.length;
  const online = devices.filter((d) => d.isOnline).length;
  if (total === 0) return { total, online, tone: "idle", label: "No devices" };
  if (online === total) {
    return { total, online, tone: "ok", label: total === 1 ? "Device online" : `All ${total} devices online` };
  }
  if (online === 0) {
    return { total, online, tone: "crit", label: total === 1 ? "Device offline" : `All ${total} devices offline` };
  }
  return { total, online, tone: "warn", label: `${online} of ${total} devices online` };
}

export interface ConnectionSummary {
  tone: Tone;
  label: string;
  description: string;
}

export function summarizeConnection(connected: boolean): ConnectionSummary {
  return connected
    ? { tone: "ok", label: "Server connected", description: "Receiving live updates from BrewHub" }
    : { tone: "warn", label: "Reconnecting…", description: "Lost the live connection to BrewHub — retrying" };
}

/** Human "time since" for a millisecond timestamp. */
export function timeAgo(tsMs: number | null | undefined, nowMs: number = Date.now()): string {
  if (tsMs === null || tsMs === undefined) return "never";
  const seconds = Math.max(0, Math.floor((nowMs - tsMs) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}
