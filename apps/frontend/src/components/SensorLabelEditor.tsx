import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MAX_SENSOR_OFFSET_C, type Device } from "@brewhub/shared-types";
import { listSensors, updateSensor } from "../api/sensors";

const inputClass =
  "rounded-xl border border-line-strong bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-line-focus";

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
      <label className="flex items-center gap-1 text-xs text-dim">
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
    <div className="mt-3 space-y-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-fg">Sensors</h3>
        <button onClick={onClose} className="text-xs text-dim hover:text-fg">
          Close
        </button>
      </div>

      {sensorsQuery.isLoading && <p className="text-xs text-dim">Loading sensors...</p>}
      {sensorsQuery.data && sensorsQuery.data.length === 0 && (
        <p className="text-xs text-dim">
          No sensors discovered yet — they appear here automatically once the device starts reporting telemetry.
        </p>
      )}
      {sensorsQuery.data && sensorsQuery.data.length > 0 && (
        <>
        <p className="text-xs text-dim">
          Offset is added to the raw reading to correct it against a reference thermometer. The
          control sensor's offset is also pushed to the device, so its own control loop corrects the
          same way.
        </p>
        <ul className="space-y-2">
          {sensorsQuery.data.map((sensor) => (
            <li
              key={sensor.address}
              className="flex items-center justify-between gap-2 rounded-xl border border-line bg-card px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-xs text-dim">{sensor.address}</p>
                <SensorFields
                  deviceId={device.id}
                  address={sensor.address}
                  initialLabel={sensor.label}
                  initialOffsetC={sensor.offsetC}
                />
              </div>
              {sensor.isControlSensor ? (
                <span className="whitespace-nowrap rounded-xl bg-ok/10 px-2.5 py-1 text-xs text-ok">
                  Control sensor
                </span>
              ) : (
                <button
                  onClick={() => setControlMutation.mutate(sensor.address)}
                  disabled={setControlMutation.isPending}
                  className="whitespace-nowrap rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg"
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
