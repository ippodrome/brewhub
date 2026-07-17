import type { Device, TelemetryPayload } from "@brewhub/shared-types";

function timeAgo(tsMs: number | null): string {
  if (tsMs === null) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function TemperatureReadout({
  device,
  telemetry,
}: {
  device: Device;
  telemetry: TelemetryPayload | undefined;
}): JSX.Element {
  const temp = telemetry?.temperatureC ?? null;
  const lastSeen = telemetry?.ts ?? device.lastSeenAt;

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
        {temp !== null ? (
          <>
            <span className="text-5xl font-semibold tabular-nums text-neutral-100">{temp.toFixed(1)}</span>
            <span className="text-xl text-neutral-500">°C</span>
          </>
        ) : (
          <span className="text-3xl font-medium text-neutral-600">No reading</span>
        )}
      </div>

      <p className="mt-2 text-xs text-neutral-500">
        {device.isOnline ? "Online" : "Offline"} · last reading {timeAgo(lastSeen)}
      </p>
    </div>
  );
}
