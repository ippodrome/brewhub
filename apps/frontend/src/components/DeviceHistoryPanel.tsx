import { useQuery } from "@tanstack/react-query";
import type { Device } from "@brewhub/shared-types";
import { listSensors } from "../api/sensors";
import { listTaps } from "../api/taps";
import { DeviceHistoryChart } from "./DeviceHistoryChart";

function shortAddress(address: string): string {
  return address.length > 8 ? `${address.slice(0, 8)}…` : address;
}

// v1 keg_scale hardware has exactly one HX711 channel (see firmware
// kWeightChannelIndex in firmware/keg-scale/src/main.cpp) — no per-device
// "which channels exist" API yet, so this is the same hardcoded assumption
// the firmware itself makes.
const KEG_SCALE_CHANNEL = "0";

function TemperatureCharts({ device }: { device: Device }): JSX.Element {
  const sensorsQuery = useQuery({
    queryKey: ["sensors", device.id],
    queryFn: () => listSensors(device.id),
  });

  const sensors = sensorsQuery.data ?? [];
  if (sensorsQuery.isLoading) return <p className="text-xs text-neutral-600 dark:text-neutral-500">Loading sensors...</p>;
  if (sensors.length === 0) {
    return <p className="text-xs text-neutral-600 dark:text-neutral-500">No sensors discovered yet.</p>;
  }

  return (
    <>
      {sensors.map((sensor) => (
        <div key={sensor.address} className="space-y-1">
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{sensor.label ?? shortAddress(sensor.address)}</p>
          <DeviceHistoryChart
            deviceId={device.id}
            metric="temperature"
            channel={sensor.address}
            label={sensor.label ?? shortAddress(sensor.address)}
          />
        </div>
      ))}
    </>
  );
}

function FlowCharts({ device }: { device: Device }): JSX.Element | null {
  const tapsQuery = useQuery({
    queryKey: ["taps", device.id],
    queryFn: () => listTaps(device.id),
  });

  const flowTaps = (tapsQuery.data ?? []).filter((t) => t.measurementType === "flow");
  if (flowTaps.length === 0) return null;

  return (
    <>
      {flowTaps.map((tap) => (
        <div key={tap.id} className="space-y-1">
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{tap.name} (flow {tap.flowIndex})</p>
          <DeviceHistoryChart
            deviceId={device.id}
            metric="flow"
            channel={String(tap.flowIndex)}
            label={tap.name}
          />
        </div>
      ))}
    </>
  );
}

export function DeviceHistoryPanel({ device, onClose }: { device: Device; onClose: () => void }): JSX.Element {
  return (
    <div className="mt-3 space-y-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">History</h3>
        <button onClick={onClose} className="text-xs text-neutral-600 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300">
          Close
        </button>
      </div>

      {(device.type === "fermenter" || device.type === "kegerator") && <TemperatureCharts device={device} />}
      {device.type === "kegerator" && <FlowCharts device={device} />}
      {device.type === "keg_scale" && (
        <DeviceHistoryChart
          deviceId={device.id}
          metric="weight"
          channel={KEG_SCALE_CHANNEL}
          label={device.name}
        />
      )}
    </div>
  );
}
