import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Maximize2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { Device, TelemetryPayload } from "@brewhub/shared-types";
import { listSensors } from "../api/sensors";

function timeAgo(tsMs: number | null): string {
  if (tsMs === null) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

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

  return (
    <div className="rounded-2xl border border-line bg-card p-6">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${device.isOnline ? "bg-ok shadow-[0_0_6px_rgb(var(--c-ok)/0.6)]" : "bg-dim"}`}
        />
        <span className="text-sm font-medium text-muted">{device.name}</span>
        {device.chamberName && <span className="text-xs text-dim">· {device.chamberName}</span>}
        <span className="flex-1" />
        {/* The way you first reach a device's display page; after that it is
            a bookmark on whatever screen lives next to the equipment. */}
        <Link
          to={`/display/${encodeURIComponent(device.id)}`}
          aria-label={`Open ${device.name} display view`}
          title="Open display view"
          className="rounded-lg p-1 text-dim hover:bg-tint hover:text-fg"
        >
          <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      </div>

      <div className="mt-4 flex items-baseline gap-1">
        {headline && headline.temperatureC !== null ? (
          <>
            <span className="font-display text-5xl font-semibold tabular-nums text-fg">
              {headline.temperatureC.toFixed(1)}
            </span>
            <span className="text-xl text-amber">°C</span>
          </>
        ) : (
          <span className="text-3xl font-medium text-dim">No reading</span>
        )}
      </div>
      {headline && (
        <p className="text-xs text-dim">{labelFor(headline.address)}</p>
      )}

      {others.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-line pt-2">
          {others.map((sensor) => (
            <div key={sensor.address} className="flex justify-between text-xs text-dim">
              <span>{labelFor(sensor.address)}</span>
              <span className="tabular-nums">
                {sensor.temperatureC !== null ? `${sensor.temperatureC.toFixed(1)}°C` : "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-2 text-xs text-dim">
        {device.isOnline ? "Online" : "Offline"} · last reading {timeAgo(telemetry?.ts ?? device.lastSeenAt)}
      </p>

      {children}
    </div>
  );
}
