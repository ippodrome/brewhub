import { loadConfig } from "./config/env.js";
import { createDbClient } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { buildApp } from "./app.js";
import { createMqttClient } from "./mqtt/client.js";
import { startPresenceSweep } from "./mqtt/presence.js";
import { getDevice, setDeviceFirmwareVersion, setDeviceOnline } from "./db/repositories/devices.repo.js";
import { insertReading } from "./db/repositories/readings.repo.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const db = createDbClient(config.DB_PATH);
  runMigrations(db);

  const app = await buildApp({ db, config });

  const mqttClient = createMqttClient({
    url: config.MQTT_URL,
    username: config.MQTT_USERNAME,
    password: config.MQTT_PASSWORD,
    logger: app.log,
    onStatus: (payload) => {
      if (!getDevice(db, payload.deviceId)) {
        app.log.warn({ deviceId: payload.deviceId }, "Status for unknown device, dropping");
        return;
      }
      setDeviceOnline(db, payload.deviceId, payload.online, payload.ts);
      setDeviceFirmwareVersion(db, payload.deviceId, payload.firmwareVersion);
    },
    onTelemetry: (payload) => {
      if (!getDevice(db, payload.deviceId)) {
        app.log.warn({ deviceId: payload.deviceId }, "Telemetry for unknown device, dropping");
        return;
      }
      insertReading(db, payload);
      // Telemetry is itself evidence of life, independent of the periodic status heartbeat.
      setDeviceOnline(db, payload.deviceId, true, payload.ts);
    },
  });

  startPresenceSweep({
    db,
    logger: app.log,
    intervalMs: config.PRESENCE_SWEEP_INTERVAL_MS,
    staleAfterMs: config.PRESENCE_STALE_AFTER_MS,
  });

  await app.listen({ port: config.PORT, host: "0.0.0.0" });

  const shutdown = async () => {
    app.log.info("Shutting down...");
    mqttClient.end(true);
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
