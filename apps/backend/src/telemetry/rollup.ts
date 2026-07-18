import type Database from "better-sqlite3";
import type { FastifyBaseLogger } from "fastify";

const SECONDS_PER_HOUR = 3600;

export interface RollupResult {
  table: string;
  bucketsCollapsed: number;
  rowsDeleted: number;
}

/**
 * Collapses every hour-bucket of rows older than the cutoff into a single
 * representative row, replacing the originals — bounded, one table per
 * metric type (same "no generalized value column" precedent as the schema
 * itself, see migration 0007's comment). Buckets that already have exactly
 * one row (i.e. already collapsed by a previous run, or genuinely only had
 * one reading that hour) are skipped via HAVING COUNT(*) > 1, making
 * repeated runs cheap and idempotent rather than re-processing the entire
 * historical tail every time.
 */
function rollupReadings(db: Database.Database, cutoffSeconds: number): RollupResult {
  interface Bucket {
    device_id: string;
    sensor_address: string;
    bucket: number;
    avg_temp: number | null;
  }
  const buckets = db
    .prepare<[number], Bucket>(
      `SELECT device_id, sensor_address, (recorded_at / ${SECONDS_PER_HOUR}) * ${SECONDS_PER_HOUR} AS bucket,
              AVG(temperature_c) AS avg_temp
       FROM readings
       WHERE recorded_at < ?
       GROUP BY device_id, sensor_address, bucket
       HAVING COUNT(*) > 1`,
    )
    .all(cutoffSeconds);

  const del = db.prepare(
    `DELETE FROM readings WHERE device_id = ? AND sensor_address = ? AND recorded_at >= ? AND recorded_at < ?`,
  );
  const ins = db.prepare(
    `INSERT INTO readings (device_id, sensor_address, ts, temperature_c, recorded_at) VALUES (?, ?, ?, ?, ?)`,
  );

  let rowsDeleted = 0;
  const applyAll = db.transaction((rows: Bucket[]) => {
    for (const b of rows) {
      rowsDeleted += del.run(b.device_id, b.sensor_address, b.bucket, b.bucket + SECONDS_PER_HOUR).changes;
      ins.run(b.device_id, b.sensor_address, b.bucket * 1000, b.avg_temp, b.bucket);
    }
  });
  applyAll(buckets);

  return { table: "readings", bucketsCollapsed: buckets.length, rowsDeleted };
}

/**
 * pulse_count is cumulative and monotonic within a boot session (see
 * telemetry.ts's doc comment on FlowReadingSchema) — averaging it would
 * produce a value that was never actually reported and breaks the
 * "always non-decreasing" assumption downstream delta math relies on.
 * MAX keeps the highest (== chronologically last, since it only
 * increases) real value from the bucket instead.
 */
function rollupFlowReadings(db: Database.Database, cutoffSeconds: number): RollupResult {
  interface Bucket {
    device_id: string;
    flow_index: number;
    bucket: number;
    max_pulse: number;
  }
  const buckets = db
    .prepare<[number], Bucket>(
      `SELECT device_id, flow_index, (recorded_at / ${SECONDS_PER_HOUR}) * ${SECONDS_PER_HOUR} AS bucket,
              MAX(pulse_count) AS max_pulse
       FROM flow_readings
       WHERE recorded_at < ?
       GROUP BY device_id, flow_index, bucket
       HAVING COUNT(*) > 1`,
    )
    .all(cutoffSeconds);

  const del = db.prepare(
    `DELETE FROM flow_readings WHERE device_id = ? AND flow_index = ? AND recorded_at >= ? AND recorded_at < ?`,
  );
  const ins = db.prepare(
    `INSERT INTO flow_readings (device_id, flow_index, ts, pulse_count, recorded_at) VALUES (?, ?, ?, ?, ?)`,
  );

  let rowsDeleted = 0;
  const applyAll = db.transaction((rows: Bucket[]) => {
    for (const b of rows) {
      rowsDeleted += del.run(b.device_id, b.flow_index, b.bucket, b.bucket + SECONDS_PER_HOUR).changes;
      ins.run(b.device_id, b.flow_index, b.bucket * 1000, b.max_pulse, b.bucket);
    }
  });
  applyAll(buckets);

  return { table: "flow_readings", bucketsCollapsed: buckets.length, rowsDeleted };
}

function rollupWeightReadings(db: Database.Database, cutoffSeconds: number): RollupResult {
  interface Bucket {
    device_id: string;
    weight_index: number;
    bucket: number;
    avg_grams: number | null;
  }
  const buckets = db
    .prepare<[number], Bucket>(
      `SELECT device_id, weight_index, (recorded_at / ${SECONDS_PER_HOUR}) * ${SECONDS_PER_HOUR} AS bucket,
              AVG(grams) AS avg_grams
       FROM weight_readings
       WHERE recorded_at < ?
       GROUP BY device_id, weight_index, bucket
       HAVING COUNT(*) > 1`,
    )
    .all(cutoffSeconds);

  const del = db.prepare(
    `DELETE FROM weight_readings WHERE device_id = ? AND weight_index = ? AND recorded_at >= ? AND recorded_at < ?`,
  );
  const ins = db.prepare(
    `INSERT INTO weight_readings (device_id, weight_index, ts, grams, recorded_at) VALUES (?, ?, ?, ?, ?)`,
  );

  let rowsDeleted = 0;
  const applyAll = db.transaction((rows: Bucket[]) => {
    for (const b of rows) {
      rowsDeleted += del.run(b.device_id, b.weight_index, b.bucket, b.bucket + SECONDS_PER_HOUR).changes;
      ins.run(b.device_id, b.weight_index, b.bucket * 1000, b.avg_grams, b.bucket);
    }
  });
  applyAll(buckets);

  return { table: "weight_readings", bucketsCollapsed: buckets.length, rowsDeleted };
}

function rollupGravityReadings(db: Database.Database, cutoffSeconds: number): RollupResult {
  interface Bucket {
    hydrometer_id: number;
    bucket: number;
    avg_sg: number | null;
    avg_temp: number | null;
    avg_batt: number | null;
  }
  const buckets = db
    .prepare<[number], Bucket>(
      `SELECT hydrometer_id, (recorded_at / ${SECONDS_PER_HOUR}) * ${SECONDS_PER_HOUR} AS bucket,
              AVG(specific_gravity) AS avg_sg, AVG(temperature_c) AS avg_temp, AVG(battery_percent) AS avg_batt
       FROM gravity_readings
       WHERE recorded_at < ?
       GROUP BY hydrometer_id, bucket
       HAVING COUNT(*) > 1`,
    )
    .all(cutoffSeconds);

  const del = db.prepare(
    `DELETE FROM gravity_readings WHERE hydrometer_id = ? AND recorded_at >= ? AND recorded_at < ?`,
  );
  const ins = db.prepare(
    `INSERT INTO gravity_readings (hydrometer_id, ts, specific_gravity, temperature_c, battery_percent, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  let rowsDeleted = 0;
  const applyAll = db.transaction((rows: Bucket[]) => {
    for (const b of rows) {
      rowsDeleted += del.run(b.hydrometer_id, b.bucket, b.bucket + SECONDS_PER_HOUR).changes;
      ins.run(b.hydrometer_id, b.bucket * 1000, b.avg_sg, b.avg_temp, b.avg_batt, b.bucket);
    }
  });
  applyAll(buckets);

  return { table: "gravity_readings", bucketsCollapsed: buckets.length, rowsDeleted };
}

export interface RunRollupOptions {
  db: Database.Database;
  logger: Pick<FastifyBaseLogger, "info">;
  retentionDays?: number;
  now?: () => number; // injectable for tests
}

export function runTelemetryRollup(options: RunRollupOptions): RollupResult[] {
  const retentionDays = options.retentionDays ?? 30;
  const nowSeconds = Math.floor((options.now ?? Date.now)() / 1000);
  const cutoffSeconds = nowSeconds - retentionDays * 24 * SECONDS_PER_HOUR;

  const results = [
    rollupReadings(options.db, cutoffSeconds),
    rollupFlowReadings(options.db, cutoffSeconds),
    rollupWeightReadings(options.db, cutoffSeconds),
    rollupGravityReadings(options.db, cutoffSeconds),
  ];

  const totalBuckets = results.reduce((sum, r) => sum + r.bucketsCollapsed, 0);
  if (totalBuckets > 0) {
    options.logger.info({ results }, "Telemetry rollup collapsed old readings into hourly averages");
  }

  return results;
}

export interface StartRollupOptions extends RunRollupOptions {
  intervalMs: number;
}

/** Runs once immediately (not just after the first interval elapses), then on intervalMs thereafter. */
export function startTelemetryRollup(options: StartRollupOptions): NodeJS.Timeout {
  runTelemetryRollup(options);
  return setInterval(() => runTelemetryRollup(options), options.intervalMs);
}
