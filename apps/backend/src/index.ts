import { loadConfig } from "./config/env.js";
import { createDbClient } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { buildApp } from "./app.js";
import { createMqttClient } from "./mqtt/client.js";
import { startPresenceSweep } from "./mqtt/presence.js";
import { startProfileScheduler } from "./profiles/scheduler.js";
import { getDevice, listDevices, setDeviceFirmwareVersion, setDeviceOnline } from "./db/repositories/devices.repo.js";
import { insertReading } from "./db/repositories/readings.repo.js";
import { getDeviceConfig, updateDeviceConfig } from "./db/repositories/device-configs.repo.js";
import { listSensorsForDevice, recordSensorSeen } from "./db/repositories/device-sensors.repo.js";
import { publishDeviceConfig } from "./mqtt/publish-config.js";
import { applyFlowReading } from "./taps/apply-flow-reading.js";
import { broadcastToAll } from "./ws/broadcast.js";

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
      broadcastToAll({ type: "status", payload });
    },
    onTelemetry: (payload) => {
      if (!getDevice(db, payload.deviceId)) {
        app.log.warn({ deviceId: payload.deviceId }, "Telemetry for unknown device, dropping");
        return;
      }
      insertReading(db, payload);
      // Telemetry is itself evidence of life, independent of the periodic status heartbeat.
      setDeviceOnline(db, payload.deviceId, true, payload.ts);

      for (const sensor of payload.sensors) {
        recordSensorSeen(db, payload.deviceId, sensor.address, payload.ts);
      }

      for (const flow of payload.flows) {
        applyFlowReading(db, payload.deviceId, flow, payload.ts);
      }

      // If a control sensor has just been auto-designated (first-ever sensor
      // for this device) but the device hasn't been told yet, tell it now —
      // keeps firmware and backend in sync regardless of discovery timing.
      const deviceConfig = getDeviceConfig(db, payload.deviceId);
      if (deviceConfig && deviceConfig.controlSensorAddress === null) {
        const controlSensor = listSensorsForDevice(db, payload.deviceId).find((s) => s.isControlSensor);
        if (controlSensor) {
          const updated = updateDeviceConfig(db, payload.deviceId, {
            controlSensorAddress: controlSensor.address,
          });
          publishDeviceConfig(mqttClient, payload.deviceId, updated);
        }
      }

      broadcastToAll({ type: "telemetry", payload });
    },
  });

  app.decorate("mqttClient", mqttClient);

  startPresenceSweep({
    db,
    logger: app.log,
    intervalMs: config.PRESENCE_SWEEP_INTERVAL_MS,
    staleAfterMs: config.PRESENCE_STALE_AFTER_MS,
    onDeviceOffline: () => {
      // Sweep-driven transitions don't carry a fresh status payload, so
      // broadcast a full snapshot rather than fabricate one.
      broadcastToAll({ type: "device_list", payload: listDevices(db) });
    },
  });

  startProfileScheduler({
    db,
    mqttClient,
    logger: app.log,
    intervalMs: config.PROFILE_SCHEDULER_INTERVAL_MS,
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
