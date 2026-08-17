import { useQuery } from "@tanstack/react-query";
import { listDevices } from "../api/devices";
import { useLiveTelemetry } from "../ws/useLiveTelemetry";
import { DeviceCard } from "./DeviceCard";

export function DeviceList(): JSX.Element {
  const { data: devices, isLoading, isError } = useQuery({
    queryKey: ["devices"],
    queryFn: listDevices,
  });
  // The REST list has everything (name, chamber, etc.) but is only a
  // snapshot from whenever it was last fetched. WsProvider's devices array
  // is comparatively sparse but kept live (patched on both status AND
  // telemetry messages — see WsProvider.tsx). Overlaying isOnline/lastSeenAt
  // from the live source is what makes this page's status dot actually live
  // instead of frozen at whatever it was on page load.
  const { devices: liveDevices } = useLiveTelemetry();

  if (isLoading) return <p className="text-sm text-dim">Loading devices...</p>;
  if (isError) return <p className="text-sm text-crit">Could not load devices.</p>;
  if (!devices || devices.length === 0) {
    return <p className="text-sm text-dim">No devices yet. Add one to get started.</p>;
  }

  const merged = devices.map((device) => {
    const live = liveDevices.find((d) => d.id === device.id);
    return live ? { ...device, isOnline: live.isOnline, lastSeenAt: live.lastSeenAt } : device;
  });

  return (
    <div className="space-y-3">
      {merged.map((device) => (
        <DeviceCard key={device.id} device={device} />
      ))}
    </div>
  );
}
