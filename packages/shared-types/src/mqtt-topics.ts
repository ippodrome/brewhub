export const TOPIC_PREFIX = "unibrew";

export type TopicKind =
  | "status"
  | "telemetry"
  | "state"
  | "decision"
  | "command"
  | "config"
  | "ota"
  | "discovery"
  | "gravity";

export function statusTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/status`;
}

export function telemetryTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/telemetry`;
}

/**
 * Current control state. Retained: a client that has just connected must know
 * what the loop is doing without waiting for the next transition.
 */
export function stateTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/state`;
}

/** One message per control decision. Not retained — this is a log. */
export function decisionTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/decision`;
}

export function stateWildcardTopic(): string {
  return `${TOPIC_PREFIX}/+/state`;
}

export function decisionWildcardTopic(): string {
  return `${TOPIC_PREFIX}/+/decision`;
}

export function configTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/config`;
}

export function otaTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/ota`;
}

/**
 * claude.md §6 originally sketched a single shared "unibrew/discovery"
 * topic. Deviated to the same per-device shape as everything else
 * (unibrew/{deviceId}/discovery) so it can be retained — a single shared
 * topic's retained value gets overwritten by whichever device announced
 * most recently, so a backend that's down when a device announces would
 * permanently miss it. Per-device + retained means a newly-started backend
 * still discovers every device that's ever announced by subscribing to the
 * wildcard below. See DECISIONS.md.
 */
export function discoveryTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/discovery`;
}

/**
 * Published by any gravity-reading source (BrewHub's own gravity-bridge
 * firmware, or an external bridge like Home Assistant/ESPHome republishing
 * Tilt/Rapt Pill readings) — a documented contract, not exclusive to
 * BrewHub's own firmware. See DECISIONS.md.
 */
export function gravityTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/gravity`;
}

export function statusWildcardTopic(): string {
  return `${TOPIC_PREFIX}/+/status`;
}

export function telemetryWildcardTopic(): string {
  return `${TOPIC_PREFIX}/+/telemetry`;
}

export function discoveryWildcardTopic(): string {
  return `${TOPIC_PREFIX}/+/discovery`;
}

export function gravityWildcardTopic(): string {
  return `${TOPIC_PREFIX}/+/gravity`;
}

const VALID_KINDS: ReadonlySet<string> = new Set<TopicKind>([
  "status",
  "telemetry",
  "state",
  "decision",
  "command",
  "config",
  "ota",
  "discovery",
  "gravity",
]);

/** Parses `unibrew/{deviceId}/{kind}` topics; returns null for anything else. */
export function parseTopic(topic: string): { deviceId: string; kind: TopicKind } | null {
  const parts = topic.split("/");
  if (parts.length !== 3 || parts[0] !== TOPIC_PREFIX) {
    return null;
  }
  const [, deviceId, kind] = parts;
  if (!deviceId || !kind || !VALID_KINDS.has(kind)) {
    return null;
  }
  return { deviceId, kind: kind as TopicKind };
}
