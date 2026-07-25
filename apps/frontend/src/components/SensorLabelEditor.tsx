import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MAX_SENSOR_OFFSET_C, type Device } from "@brewhub/shared-types";
import { listSensors, updateSensor } from "../api/sensors";

const inputClass =
  "rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 px-2 py-1 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500";

function SensorFields({
  deviceId,
  address,
  initialLabel,
  initialOffsetC,
}: {
  deviceId: string;
  address: string;
  initialLabel: string | null;
  initialOffsetC: number;
}): JSX.Element {
  const [label, setLabel] = useState(initialLabel ?? "");
  const [offset, setOffset] = useState(String(initialOffsetC));
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (patch: { label?: string | null; offsetC?: number }) =>
      updateSensor(deviceId, address, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sensors", deviceId] }),
  });

  function commitOffset(): void {
    const parsed = Number(offset);
    // Reset the field rather than sending something the API would reject —
    // an offset outside the allowed band is always a typo.
    if (!Number.isFinite(parsed) || Math.abs(parsed) > MAX_SENSOR_OFFSET_C) {
      setOffset(String(initialOffsetC));
      return;
    }
    if (parsed === initialOffsetC) return;
    mutation.mutate({ offsetC: parsed });
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <input
        className={`${inputClass} w-32`}
        placeholder="Label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => mutation.mutate({ label: label || null })}
        onKeyDown={(e) => {
          if (e.key === "Enter") mutation.mutate({ label: label || null });
        }}
      />
      <label className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-500">
        <span title={`Added to this sensor's raw reading. Range ±${MAX_SENSOR_OFFSET_C} °C.`}>
          Offset
        </span>
        <input
          className={`${inputClass} w-20 text-right`}
          type="number"
          step="0.05"
          value={offset}
          onChange={(e) => setOffset(e.target.value)}
          onBlur={commitOffset}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitOffset();
          }}
        />
        <span>°C</span>
      </label>
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
    <div className="mt-3 space-y-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-4">
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
        <>
        <p className="text-xs text-neutral-600 dark:text-neutral-500">
          Offset is added to the raw reading to correct it against a reference thermometer. The
          control sensor's offset is also pushed to the device, so its own control loop corrects the
          same way.
        </p>
        <ul className="space-y-2">
          {sensorsQuery.data.map((sensor) => (
            <li
              key={sensor.address}
              className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs text-neutral-600 dark:text-neutral-500">{sensor.address}</p>
                <SensorFields
                  deviceId={device.id}
                  address={sensor.address}
                  initialLabel={sensor.label}
                  initialOffsetC={sensor.offsetC}
                />
              </div>
              {sensor.isControlSensor ? (
                <span className="whitespace-nowrap rounded-xl bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-400">
                  Control sensor
                </span>
              ) : (
                <button
                  onClick={() => setControlMutation.mutate(sensor.address)}
                  disabled={setControlMutation.isPending}
                  className="whitespace-nowrap rounded-xl px-2.5 py-1 text-xs text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200"
                >
                  Set as control
                </button>
              )}
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  );
}
