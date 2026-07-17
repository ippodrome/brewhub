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
}: {
  device: Device;
  telemetry: TelemetryPayload | undefined;
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
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${device.isOnline ? "bg-emerald-400" : "bg-neutral-600"}`}
        />
        <span className="text-sm font-medium text-neutral-300">{device.name}</span>
        {device.chamberName && <span className="text-xs text-neutral-500">· {device.chamberName}</span>}
      </div>

      <div className="mt-4 flex items-baseline gap-1">
        {headline && headline.temperatureC !== null ? (
          <>
            <span className="text-5xl font-semibold tabular-nums text-neutral-100">
              {headline.temperatureC.toFixed(1)}
            </span>
            <span className="text-xl text-neutral-500">°C</span>
          </>
        ) : (
          <span className="text-3xl font-medium text-neutral-600">No reading</span>
        )}
      </div>
      {headline && (
        <p className="text-xs text-neutral-600">{labelFor(headline.address)}</p>
      )}

      {others.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-neutral-800 pt-2">
          {others.map((sensor) => (
            <div key={sensor.address} className="flex justify-between text-xs text-neutral-500">
              <span>{labelFor(sensor.address)}</span>
              <span className="tabular-nums">
                {sensor.temperatureC !== null ? `${sensor.temperatureC.toFixed(1)}°C` : "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="mt-2 text-xs text-neutral-500">
        {device.isOnline ? "Online" : "Offline"} · last reading {timeAgo(telemetry?.ts ?? device.lastSeenAt)}
      </p>
    </div>
  );
}
