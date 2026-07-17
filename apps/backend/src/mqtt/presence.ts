import type Database from "better-sqlite3";
import type { FastifyBaseLogger } from "fastify";
import { listStaleOnlineDeviceIds, setDeviceOnline } from "../db/repositories/devices.repo.js";

export interface PresenceSweepOptions {
  db: Database.Database;
  logger: FastifyBaseLogger;
  intervalMs: number;
  staleAfterMs: number;
  onDeviceOffline?: (deviceId: string) => void;
}

/**
 * Explicit "offline" status messages and MQTT LWT can be missed (dropped
 * packet, ungraceful power loss). This sweep is the backstop that actually
 * guarantees is_online converges to reality within staleAfterMs.
 */
export function startPresenceSweep(options: PresenceSweepOptions): NodeJS.Timeout {
  const sweep = () => {
    const staleBeforeMs = Date.now() - options.staleAfterMs;
    const staleIds = listStaleOnlineDeviceIds(options.db, staleBeforeMs);

    for (const deviceId of staleIds) {
      setDeviceOnline(options.db, deviceId, false, staleBeforeMs);
      options.logger.info({ deviceId }, "Device marked offline by presence sweep");
      options.onDeviceOffline?.(deviceId);
    }
  };

  return setInterval(sweep, options.intervalMs);
}
