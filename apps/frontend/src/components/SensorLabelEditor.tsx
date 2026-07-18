import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Device } from "@brewhub/shared-types";
import { listSensors, updateSensor } from "../api/sensors";

function LabelInput({
  deviceId,
  address,
  initialLabel,
}: {
  deviceId: string;
  address: string;
  initialLabel: string | null;
}): JSX.Element {
  const [label, setLabel] = useState(initialLabel ?? "");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => updateSensor(deviceId, address, { label: label || null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sensors", deviceId] }),
  });

  return (
    <div className="flex gap-2">
      <input
        className="w-32 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 px-2 py-1 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
        placeholder="Label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => mutation.mutate()}
        onKeyDown={(e) => {
          if (e.key === "Enter") mutation.mutate();
        }}
      />
    </div>
  );
}

export function SensorLabelEditor({ device, onClose }: { device: Device; onClose: () => void }): JSX.Element {
  const queryClient = useQueryClient();
  const sensorsQuery = useQuery({
    queryKey: ["sensors", device.id],
    queryFn: () => listSensors(device.id),
  });

  const setControlMutation = useMutation({
    mutationFn: (address: string) => updateSensor(device.id, address, { isControlSensor: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sensors", device.id] });
      queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
  });

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Sensors</h3>
        <button onClick={onClose} className="text-xs text-neutral-600 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300">
          Close
        </button>
      </div>

      {sensorsQuery.isLoading && <p className="text-xs text-neutral-600 dark:text-neutral-500">Loading sensors...</p>}
      {sensorsQuery.data && sensorsQuery.data.length === 0 && (
        <p className="text-xs text-neutral-600 dark:text-neutral-500">
          No sensors discovered yet — they appear here automatically once the device starts reporting telemetry.
        </p>
      )}
      {sensorsQuery.data && sensorsQuery.data.length > 0 && (
        <ul className="space-y-2">
          {sensorsQuery.data.map((sensor) => (
            <li
              key={sensor.address}
              className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs text-neutral-600 dark:text-neutral-500">{sensor.address}</p>
                <LabelInput deviceId={device.id} address={sensor.address} initialLabel={sensor.label} />
              </div>
              {sensor.isControlSensor ? (
                <span className="whitespace-nowrap rounded-lg bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-400">
                  Control sensor
                </span>
              ) : (
                <button
                  onClick={() => setControlMutation.mutate(sensor.address)}
                  disabled={setControlMutation.isPending}
                  className="whitespace-nowrap rounded-lg px-2.5 py-1 text-xs text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200"
                >
                  Set as control
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
