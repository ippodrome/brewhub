import type Database from "better-sqlite3";
import type { MqttClient } from "mqtt";
import { loadConfig } from "./config/env.js";
import { createDbClient } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { buildApp } from "./app.js";
import { createMqttClient } from "./mqtt/client.js";
import { startPresenceSweep } from "./mqtt/presence.js";
import { startProfileScheduler } from "./profiles/scheduler.js";
import { startTelemetryRollup } from "./telemetry/rollup.js";
import { applySensorOffsets } from "./telemetry/apply-sensor-offsets.js";
import { getDevice, listDevices, setDeviceFirmwareVersion, setDeviceOnline } from "./db/repositories/devices.repo.js";
import { insertReading } from "./db/repositories/readings.repo.js";
import { insertFlowReading } from "./db/repositories/flow-readings.repo.js";
import { insertWeightReading } from "./db/repositories/weight-readings.repo.js";
import { insertGravityReading } from "./db/repositories/gravity-readings.repo.js";
import { getDeviceConfig, updateDeviceConfig } from "./db/repositories/device-configs.repo.js";
import {
  deleteDecisionsOlderThan,
  insertDecision,
  upsertControlState,
} from "./db/repositories/control-state.repo.js";
import {
  getSensorOffsets,
  listSensorsForDevice,
  recordSensorSeen,
} from "./db/repositories/device-sensors.repo.js";
import { upsertDiscoveredDevice } from "./db/repositories/discovered-devices.repo.js";
import { getHydrometerByIdentifier } from "./db/repositories/hydrometers.repo.js";
import { applyCalibration } from "./gravity/apply-calibration.js";
import { ensureVapidKeys } from "./db/repositories/notification-settings.repo.js";
import { getTapByFlowIndex, listTapsByWeightChannel, listTapsForDevice } from "./db/repositories/taps.repo.js";
import { publishDeviceConfig } from "./mqtt/publish-config.js";
import {
  publishDeviceOnlineDiscovery,
  publishTapVolumeDiscovery,
  publishTemperatureSensorDiscovery,
} from "./mqtt/publish-ha-discovery.js";
import { publishTapState } from "./mqtt/publish-tap-state.js";
import { sendNotification } from "./notifications/send.js";
import { applyFlowReading } from "./taps/apply-flow-reading.js";
import { applyWeightReading } from "./taps/apply-weight-reading.js";
import { broadcastToAll } from "./ws/broadcast.js";

/**
 * Republishes every HA discovery config + current tap state on startup —
 * covers brokers without persistent retained-message storage (the bundled
 * one has persistence on, but an externally-supplied broker might not).
 * Idempotent: republishing an unchanged config is a no-op from HA's side.
 */
function republishHomeAssistantDiscovery(db: Database.Database, mqttClient: MqttClient): void {
  for (const device of listDevices(db)) {
    publishDeviceOnlineDiscovery(mqttClient, device);
    for (const sensor of listSensorsForDevice(db, device.id)) {
      publishTemperatureSensorDiscovery(mqttClient, device, sensor.address, sensor.label);
    }
    for (const tap of listTapsForDevice(db, device.id)) {
      publishTapVolumeDiscovery(mqttClient, device, tap);
      publishTapState(mqttClient, device.id, tap);
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  const db = createDbClient(config.DB_PATH);
  runMigrations(db);
  ensureVapidKeys(db);

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
      // Date.now() (server wall-clock), not payload.ts — the device's ts is
      // millis()-since-boot, not an absolute timestamp (no NTP sync in the
      // firmware), so it resets on every reboot and can't be trusted as a
      // "last seen at" moment. See DECISIONS.md.
      setDeviceOnline(db, payload.deviceId, payload.online, Date.now());
      setDeviceFirmwareVersion(db, payload.deviceId, payload.firmwareVersion);
      broadcastToAll({ type: "status", payload });
    },
    onTelemetry: (rawPayload) => {
      const device = getDevice(db, rawPayload.deviceId);
      if (!device) {
        app.log.warn({ deviceId: rawPayload.deviceId }, "Telemetry for unknown device, dropping");
        return;
      }
      // Telemetry is itself evidence of life, independent of the periodic status heartbeat.
      setDeviceOnline(db, rawPayload.deviceId, true, Date.now());

      // Sensors are registered before offsets are read so a brand-new sensor
      // is present in the map (at its 0 default) rather than missing from it.
      for (const sensor of rawPayload.sensors) {
        const isNewSensor = recordSensorSeen(db, rawPayload.deviceId, sensor.address, Date.now());
        if (isNewSensor) {
          publishTemperatureSensorDiscovery(mqttClient, device, sensor.address, null);
        }
      }

      // Everything from here on works with calibrated temperatures — storage,
      // broadcast, HA. The device's own control loop applies the matching
      // correction itself, from config.controlSensorOffsetC (see ADR-020).
      const payload = applySensorOffsets(rawPayload, getSensorOffsets(db, rawPayload.deviceId));
      insertReading(db, payload);

      for (const flow of payload.flows) {
        const { lowVolume, kick } = applyFlowReading(db, payload.deviceId, flow, payload.ts);
        insertFlowReading(db, payload.deviceId, flow.index, payload.ts, flow.pulseCount);
        if (lowVolume) {
          // Fire-and-forget — network calls to push/Telegram/Discord must
          // never block MQTT message processing. sendNotification already
          // isolates failures per-channel internally.
          void sendNotification(db, app.log, {
            title: "Keg running low",
            body: `${lowVolume.tapName} is running low.`,
          });
        }
        if (kick) {
          app.log.warn(
            { tapId: kick.tapId, rateMlPerS: Math.round(kick.rateMlPerS) },
            "Kick detected — flow rate far above what a beer line can pour",
          );
          void sendNotification(db, app.log, {
            title: "Keg kicked",
            body: `${kick.tapName} looks empty — gas is running through the line. Close the tap and change the keg.`,
          });
        }
        const flowTap = getTapByFlowIndex(db, payload.deviceId, flow.index);
        if (flowTap) {
          publishTapState(mqttClient, payload.deviceId, {
            id: flowTap.id,
            remainingVolumeMl: flowTap.remaining_volume_ml,
            fullVolumeMl: flowTap.full_volume_ml,
          });
        }
      }

      for (const weight of payload.weights) {
        const lowVolumeEvents = applyWeightReading(db, payload.deviceId, weight);
        insertWeightReading(db, payload.deviceId, weight.index, payload.ts, weight.grams);
        for (const event of lowVolumeEvents) {
          void sendNotification(db, app.log, {
            title: "Keg running low",
            body: `${event.tapName} is running low.`,
          });
        }
        for (const weightTap of listTapsByWeightChannel(db, payload.deviceId, weight.index)) {
          publishTapState(mqttClient, weightTap.device_id, {
            id: weightTap.id,
            remainingVolumeMl: weightTap.remaining_volume_ml,
            fullVolumeMl: weightTap.full_volume_ml,
          });
        }
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
            // Sent together with the address so the two can never disagree,
            // even if an offset was set before this sensor was designated.
            controlSensorOffsetC: controlSensor.offsetC,
          });
          publishDeviceConfig(mqttClient, payload.deviceId, updated);
        }
      }

      broadcastToAll({ type: "telemetry", payload });
    },
    onDiscovery: (message) => {
      // Deliberately no getDevice() gate here, unlike status/telemetry —
      // discovery exists specifically to surface devices that AREN'T
      // registered yet (see README "Adding a device").
      upsertDiscoveredDevice(db, message);
    },
    onGravity: (payload) => {
      // Unmatched identifiers are dropped, not an error — a gravity-bridge
      // (or an external HA/ESPHome bridge publishing to the same contract)
      // may see other people's Tilts too.
      for (const reading of payload.readings) {
        const hydrometer = getHydrometerByIdentifier(db, reading.identifier);
        if (!hydrometer) {
          app.log.debug({ identifier: reading.identifier }, "Gravity reading for unconfigured hydrometer, dropping");
          continue;
        }
        const gravitySg = applyCalibration(hydrometer, reading.gravitySg);
        insertGravityReading(db, hydrometer.id, payload.ts, gravitySg, reading.temperatureC, reading.batteryPercent ?? null);
      }
      broadcastToAll({ type: "gravity", payload });
    },
    onControlState: (payload) => {
      // A device can publish before it has been registered — its retained
      // state message arrives the moment the backend subscribes. Dropping it
      // is right: an unregistered device has no row to hang state off, and
      // letting the foreign key throw would take the MQTT handler down.
      if (!getDevice(db, payload.deviceId)) {
        app.log.debug({ deviceId: payload.deviceId }, "Control state for unknown device, dropping");
        return;
      }
      upsertControlState(db, payload, Date.now());
    },
    onControlDecision: (payload) => {
      if (!getDevice(db, payload.deviceId)) {
        app.log.debug({ deviceId: payload.deviceId }, "Control decision for unknown device, dropping");
        return;
      }
      insertDecision(db, payload, Date.now());
    },
  });

  app.decorate("mqttClient", mqttClient);
  republishHomeAssistantDiscovery(db, mqttClient);

  // Decisions are a handful an hour, so 90 days costs almost nothing and
  // covers a full fermentation plus the argument about it afterwards.
  const DECISION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
  const decisionSweep = setInterval(
    () => {
      const removed = deleteDecisionsOlderThan(db, Date.now() - DECISION_RETENTION_MS);
      if (removed > 0) app.log.info({ removed }, "Expired old control decisions");
    },
    24 * 60 * 60 * 1000,
  );
  decisionSweep.unref();

  startPresenceSweep({
    db,
    logger: app.log,
    intervalMs: config.PRESENCE_SWEEP_INTERVAL_MS,
    staleAfterMs: config.PRESENCE_STALE_AFTER_MS,
    onDeviceOffline: (deviceId) => {
      // Sweep-driven transitions don't carry a fresh status payload, so
      // broadcast a full snapshot rather than fabricate one.
      broadcastToAll({ type: "device_list", payload: listDevices(db) });
      void sendNotification(db, app.log, {
        title: "Device offline",
        body: `${deviceId} has gone offline.`,
      });
    },
  });

  startProfileScheduler({
    db,
    mqttClient,
    logger: app.log,
    intervalMs: config.PROFILE_SCHEDULER_INTERVAL_MS,
  });

  startTelemetryRollup({
    db,
    logger: app.log,
    retentionDays: config.TELEMETRY_RETENTION_DAYS,
    intervalMs: config.TELEMETRY_ROLLUP_INTERVAL_MS,
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
