import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getDeviceConfig } from "../api/devices";
import { listSensors } from "../api/sensors";
import { TapVolumeSummary } from "../components/TapVolumeSummary";
import { TemperatureBand, type BandMarker } from "../components/TemperatureBand";
import { useWakeLock } from "../hooks/useWakeLock";
import { freshnessOf } from "../lib/freshness";
import { useLiveTelemetry } from "../ws/useLiveTelemetry";

/**
 * Devices publish telemetry every few seconds; a minute of silence means
 * something is wrong, not that nothing changed.
 */
const STALE_AFTER_MS = 60_000;

/** How often the page re-evaluates staleness with no new data arriving. */
const FRESHNESS_TICK_MS = 5_000;

/**
 * A single device, sized to be read across a room.
 *
 * This is the page you leave open on a phone or tablet mounted next to the
 * equipment, so it deliberately renders no app chrome — no header, no tab
 * bar. Two things matter more here than on the dashboard: the screen must
 * not sleep, and a reading that has stopped updating must be obviously
 * different from one that is live. A frozen number that still looks
 * authoritative is worse than no screen at all.
 */
export function DeviceDisplay(): JSX.Element {
  const { deviceId = "" } = useParams();
  const { devices, telemetryByDevice } = useLiveTelemetry();
  useWakeLock(true);

  // Staleness has to advance on its own: if telemetry stops, nothing else
  // re-renders this page, and it would sit showing a stale number as live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), FRESHNESS_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const device = devices.find((d) => d.id === deviceId);
  const telemetry = telemetryByDevice[deviceId];

  const configQuery = useQuery({
    queryKey: ["device-config", deviceId],
    queryFn: () => getDeviceConfig(deviceId),
    enabled: Boolean(device),
  });

  const sensorsQuery = useQuery({
    queryKey: ["sensors", deviceId],
    queryFn: () => listSensors(deviceId),
    enabled: Boolean(device),
  });

  if (!device) {
    return (
      <Centered>
        <p className="text-2xl text-muted">Unknown device</p>
        <BackLink />
      </Centered>
    );
  }

  const freshness = freshnessOf(telemetry?.ts ?? null, now, STALE_AFTER_MS);
  const sensors = telemetry?.sensors ?? [];
  const labels = sensorsQuery.data ?? [];
  const config = configQuery.data;

  const controlAddress = labels.find((s) => s.isControlSensor)?.address;
  const control = sensors.find((s) => s.address === controlAddress) ?? sensors[0];
  const others = sensors.filter((s) => s !== control && s.temperatureC !== null);

  function labelFor(address: string): string {
    const label = labels.find((s) => s.address === address)?.label;
    return label ?? `${address.slice(0, 6)}…`;
  }

  const markers: BandMarker[] = [];
  if (control?.temperatureC != null) {
    markers.push({ label: labelFor(control.address), valueC: control.temperatureC, tone: "control" });
  }
  for (const sensor of others) {
    markers.push({ label: labelFor(sensor.address), valueC: sensor.temperatureC as number, tone: "context" });
  }

  return (
    <div className="min-h-screen bg-base px-5 py-6 sm:px-8 sm:py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-fg sm:text-3xl">{device.name}</h1>
          <p className="mt-0.5 text-sm text-dim">
            {device.chamberName ?? device.type}
          </p>
        </div>
        <BackLink />
      </header>

      {/* The whole point of the page: an unreliable reading must not look
          like a reliable one from four metres away. */}
      {(!device.isOnline || freshness !== "live") && (
        <p className="mt-5 rounded-xl border border-crit/40 bg-crit/10 px-4 py-3 text-lg font-medium text-crit">
          {!device.isOnline
            ? "Device offline — it keeps controlling on its last settings"
            : freshness === "never"
              ? "Waiting for the first reading"
              : "No update for over a minute — this reading may be out of date"}
        </p>
      )}

      <div className="mt-8 flex items-baseline gap-3">
        <span className="font-display text-7xl font-semibold tabular-nums leading-none text-fg sm:text-8xl">
          {control?.temperatureC != null ? control.temperatureC.toFixed(1) : "--.-"}
        </span>
        <span className="text-3xl text-dim">°C</span>
      </div>
      {control && <p className="mt-2 text-lg text-muted">{labelFor(control.address)}</p>}

      {config && markers.length > 0 && (
        <div className="mt-8">
          <TemperatureBand
            setpointC={config.setpointC}
            hysteresisC={config.hysteresisC}
            markers={markers}
          />
        </div>
      )}

      {/* The band shows these as dots, which answers "where are they
          relative to target" but not "what are they". On a screen you read
          from a distance, making someone decode a legend to get a number is
          a poor trade for the space it saves. */}
      {others.length > 0 && (
        <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3">
          {others.map((sensor) => (
            <div key={sensor.address}>
              <dt className="text-sm text-dim">{labelFor(sensor.address)}</dt>
              <dd className="font-display text-3xl font-semibold tabular-nums text-muted sm:text-4xl">
                {(sensor.temperatureC as number).toFixed(1)}
                <span className="ml-1 text-xl text-dim">°C</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {device.type === "kegerator" && (
        <div className="mt-8 text-lg">
          <TapVolumeSummary device={device} />
        </div>
      )}

      <p className="mt-10 text-sm tabular-nums text-dim">
        {telemetry ? `Updated ${Math.max(0, Math.round((now - telemetry.ts) / 1000))}s ago` : "No data yet"}
      </p>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base">{children}</div>
  );
}

function BackLink(): JSX.Element {
  return (
    <Link
      to="/"
      className="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-dim hover:bg-tint hover:text-fg"
    >
      <ArrowLeft className="h-4 w-4" strokeWidth={2} />
      Dashboard
    </Link>
  );
}
