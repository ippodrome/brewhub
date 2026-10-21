import { useQuery } from "@tanstack/react-query";
import { listDevices } from "../api/devices";
import { useLiveTelemetry } from "../ws/useLiveTelemetry";
import { DeviceCard } from "./DeviceCard";
import { EmptyState } from "./EmptyState";
import { Cpu, WifiOff } from "lucide-react";

export function DeviceList({ onAdd }: { onAdd?: () => void }): JSX.Element {
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

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading devices">
        {[0, 1].map((i) => (
          <div key={i} className="card h-32 animate-pulse bg-tint/60" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <EmptyState icon={WifiOff} title="Could not load devices">
        The BrewHub server did not answer. Check that the backend is running, then reload the page.
      </EmptyState>
    );
  }
  if (!devices || devices.length === 0) {
    return (
      <EmptyState
        icon={Cpu}
        title="No devices yet"
        action={
          onAdd && (
            <button onClick={onAdd} className="btn-primary">
              Add your first device
            </button>
          )
        }
      >
        Flash a controller, power it on, and it will show up here as a discovered device ready to add.
      </EmptyState>
    );
  }

  const merged = devices.map((device) => {
    const live = liveDevices.find((d) => d.id === device.id);
    return live ? { ...device, isOnline: live.isOnline, lastSeenAt: live.lastSeenAt } : device;
  });

  return (
    <div className="space-y-4">
      {merged.map((device) => (
        <DeviceCard key={device.id} device={device} />
      ))}
    </div>
  );
}
