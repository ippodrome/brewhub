import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Maximize2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { Device, TelemetryPayload } from "@brewhub/shared-types";
import { listSensors } from "../api/sensors";
import { timeAgo } from "../lib/status";
import { StatusDot } from "./StatusDot";

function shortAddress(address: string): string {
  return address.length > 8 ? `${address.slice(0, 8)}…` : address;
}

export function TemperatureReadout({
  device,
  telemetry,
  children,
}: {
  device: Device;
  telemetry: TelemetryPayload | undefined;
  children?: ReactNode;
}): JSX.Element {
  const sensorsQuery = useQuery({
    queryKey: ["sensors", device.id],
    queryFn: () => listSensors(device.id),
  });

  const sensors = telemetry?.sensors ?? [];
  const labels = sensorsQuery.data ?? [];

  function labelFor(address: string): string {
    return labels.find((s) => s.address === address)?.label ?? shortAddress(address);
  }

  const controlAddress = labels.find((s) => s.isControlSensor)?.address;
  const headline = sensors.find((s) => s.address === controlAddress) ?? sensors[0];
  const others = sensors.filter((s) => s !== headline);

  const hasReading = headline !== undefined && headline.temperatureC !== null;
  const lastTs = telemetry?.ts ?? device.lastSeenAt;

  return (
    <article className={`card flex flex-col p-6 sm:p-7 ${device.isOnline ? "" : "bg-surface/60"}`} aria-label={device.name}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-lg font-semibold text-fg">{device.name}</h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-dim">
            <StatusDot tone={device.isOnline ? "ok" : "idle"} className="!h-1.5 !w-1.5" />
            <span>{device.isOnline ? "Online" : "Offline"}</span>
            {device.chamberName && <span className="truncate">· {device.chamberName}</span>}
          </p>
        </div>
        {/* The way you first reach a device's display page; after that it is
            a bookmark on whatever screen lives next to the equipment. */}
        <Link
          to={`/display/${encodeURIComponent(device.id)}`}
          aria-label={`Open ${device.name} display view`}
          title="Open display view"
          className="icon-btn -mr-2 -mt-1"
        >
          <Maximize2 className="h-4 w-4" strokeWidth={1.75} />
        </Link>
      </div>

      {hasReading ? (
        <div className={`mt-6 ${device.isOnline ? "" : "opacity-60"}`}>
          <div className="flex items-start gap-1">
            <span className="font-display text-6xl font-medium leading-none tabular-nums tracking-tight text-fg">
              {headline.temperatureC!.toFixed(1)}
            </span>
            <span className="mt-1 font-display text-2xl text-amber">°C</span>
          </div>
          <p className="mt-2 text-sm text-muted">{labelFor(headline.address)}</p>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-line-strong px-4 py-5">
          <p className="font-medium text-fg">{device.isOnline ? "Waiting for first reading" : "No live reading"}</p>
          <p className="mt-1 text-sm text-muted">
            {device.isOnline
              ? "The controller is online but has not sent a temperature yet."
              : lastTs
                ? `Last heard from ${timeAgo(lastTs)}. The controller keeps running on its last settings — check power and Wi-Fi.`
                : "This device has never reported in. Check that it is powered and on the same network."}
          </p>
        </div>
      )}

      {others.length > 0 && (
        <dl className="mt-5 space-y-2 border-t border-line pt-4">
          {others.map((sensor) => (
            <div key={sensor.address} className="flex justify-between text-sm">
              <dt className="text-muted">{labelFor(sensor.address)}</dt>
              <dd className="tabular-nums font-medium text-fg">
                {sensor.temperatureC !== null ? `${sensor.temperatureC.toFixed(1)} °C` : "—"}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {hasReading && (
        <p className="mt-auto pt-4 text-xs text-dim">Updated {timeAgo(lastTs)}</p>
      )}

      {children}
    </article>
  );
}
