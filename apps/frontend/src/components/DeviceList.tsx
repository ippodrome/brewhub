import { useQuery } from "@tanstack/react-query";
import { listDevices } from "../api/devices";
import { DeviceCard } from "./DeviceCard";

export function DeviceList(): JSX.Element {
  const { data: devices, isLoading, isError } = useQuery({
    queryKey: ["devices"],
    queryFn: listDevices,
  });

  if (isLoading) return <p className="text-sm text-neutral-500">Loading devices...</p>;
  if (isError) return <p className="text-sm text-red-400">Could not load devices.</p>;
  if (!devices || devices.length === 0) {
    return <p className="text-sm text-neutral-500">No devices yet. Add one to get started.</p>;
  }

  return (
    <div className="space-y-3">
      {devices.map((device) => (
        <DeviceCard key={device.id} device={device} />
      ))}
    </div>
  );
}
