export const TOPIC_PREFIX = "unibrew";

export type TopicKind = "status" | "telemetry" | "state" | "command" | "config" | "ota";

export function statusTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/status`;
}

export function telemetryTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/telemetry`;
}

export function configTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/config`;
}

export function statusWildcardTopic(): string {
  return `${TOPIC_PREFIX}/+/status`;
}

export function telemetryWildcardTopic(): string {
  return `${TOPIC_PREFIX}/+/telemetry`;
}

const VALID_KINDS: ReadonlySet<string> = new Set<TopicKind>([
  "status",
  "telemetry",
  "state",
  "command",
  "config",
  "ota",
]);

/** Parses `unibrew/{deviceId}/{kind}` topics; returns null for anything else (e.g. discovery). */
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
