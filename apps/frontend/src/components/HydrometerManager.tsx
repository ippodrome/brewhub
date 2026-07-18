import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Device, HydrometerType } from "@brewhub/shared-types";
import { createHydrometer, deleteHydrometer, listHydrometers, updateHydrometer } from "../api/hydrometers";
import { getGravityHistory } from "../api/history";
import { DeviceHistoryChart } from "./DeviceHistoryChart";

const inputClass =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500";
const labelClass = "text-xs text-neutral-600 dark:text-neutral-500";

const TYPE_LABELS: Record<HydrometerType, string> = {
  tilt: "Tilt",
  rapt_pill: "Rapt Pill",
  ispindel: "iSpindel",
};

export function HydrometerManager({ device, onClose }: { device: Device; onClose: () => void }): JSX.Element {
  const queryClient = useQueryClient();
  const hydrometersQuery = useQuery({ queryKey: ["hydrometers"], queryFn: listHydrometers });

  const [identifier, setIdentifier] = useState("");
  const [type, setType] = useState<HydrometerType>("tilt");

  const assigned = hydrometersQuery.data?.find((h) => h.fermenterDeviceId === device.id);
  const unassigned = hydrometersQuery.data?.filter((h) => h.fermenterDeviceId === null) ?? [];

  const latestQuery = useQuery({
    queryKey: ["gravity-latest", assigned?.id],
    queryFn: () => getGravityHistory(assigned!.id),
    enabled: !!assigned,
  });
  const latest = latestQuery.data?.[latestQuery.data.length - 1];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["hydrometers"] });

  const createMutation = useMutation({
    mutationFn: () => createHydrometer({ identifier, type, fermenterDeviceId: device.id }),
    onSuccess: () => {
      invalidate();
      setIdentifier("");
    },
  });

  const assignMutation = useMutation({
    mutationFn: (hydrometerId: number) => updateHydrometer(hydrometerId, { fermenterDeviceId: device.id }),
    onSuccess: invalidate,
  });

  const unassignMutation = useMutation({
    mutationFn: (hydrometerId: number) => updateHydrometer(hydrometerId, { fermenterDeviceId: null }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (hydrometerId: number) => deleteHydrometer(hydrometerId),
    onSuccess: invalidate,
  });

  const calibrationMutation = useMutation({
    mutationFn: (patch: { calibrationSlope?: number; calibrationOffset?: number }) =>
      updateHydrometer(assigned!.id, patch),
    onSuccess: invalidate,
  });

  function handleCreate(event: FormEvent): void {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <div className="mt-3 space-y-4 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Hydrometer</h3>
        <button onClick={onClose} className="text-xs text-neutral-600 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300">
          Close
        </button>
      </div>

      {hydrometersQuery.isLoading && <p className="text-xs text-neutral-600 dark:text-neutral-500">Loading...</p>}

      {assigned ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-neutral-800 dark:text-neutral-200">
                  {TYPE_LABELS[assigned.type]} · {assigned.identifier}
                </p>
                <p className="text-xs text-neutral-600 dark:text-neutral-500">
                  {latest?.gravitySg != null ? `Latest: ${latest.gravitySg.toFixed(3)} SG` : "No reading yet"}
                </p>
              </div>
              <button
                onClick={() => unassignMutation.mutate(assigned.id)}
                disabled={unassignMutation.isPending}
                className="rounded-lg px-2.5 py-1 text-xs text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                Unassign
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className={labelClass}>Calibration slope</label>
                <input
                  type="number"
                  step="0.001"
                  className={inputClass}
                  defaultValue={assigned.calibrationSlope}
                  onBlur={(e) => calibrationMutation.mutate({ calibrationSlope: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Calibration offset</label>
                <input
                  type="number"
                  step="0.001"
                  className={inputClass}
                  defaultValue={assigned.calibrationOffset}
                  onBlur={(e) => calibrationMutation.mutate({ calibrationOffset: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>

          <DeviceHistoryChart deviceId={device.id} metric="gravity" channel={String(assigned.id)} label="Gravity" />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-neutral-600 dark:text-neutral-500">
            No hydrometer assigned to this fermenter yet.
          </p>

          {unassigned.length > 0 && (
            <div className="space-y-1">
              <p className={labelClass}>Assign an existing hydrometer</p>
              {unassigned.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2"
                >
                  <span className="text-sm text-neutral-800 dark:text-neutral-200">
                    {TYPE_LABELS[h.type]} · {h.identifier}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => assignMutation.mutate(h.id)}
                      disabled={assignMutation.isPending}
                      className="rounded-lg px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                    >
                      Assign
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(h.id)}
                      disabled={deleteMutation.isPending}
                      className="rounded-lg px-2.5 py-1 text-xs text-neutral-600 dark:text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-red-600 dark:hover:text-red-400"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-2 border-t border-neutral-200 dark:border-neutral-800 pt-3">
            <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Add a new hydrometer</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className={labelClass}>Type</label>
                <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as HydrometerType)}>
                  <option value="tilt">Tilt</option>
                  <option value="rapt_pill">Rapt Pill</option>
                  <option value="ispindel">iSpindel</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className={labelClass}>
                  {type === "tilt" ? "Colour (e.g. tilt-red)" : type === "ispindel" ? "iSpindel name" : "Identifier"}
                </label>
                <input
                  className={inputClass}
                  placeholder={type === "tilt" ? "tilt-red" : type === "ispindel" ? "iSpindel001" : "rapt-a1b2c3"}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                />
              </div>
            </div>
            {createMutation.isError && (
              <p className="text-xs text-red-600 dark:text-red-400">
                Could not add hydrometer — that identifier may already be in use.
              </p>
            )}
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="rounded-lg bg-neutral-900 dark:bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-100 dark:text-neutral-900 disabled:opacity-50"
              >
                {createMutation.isPending ? "Adding..." : "Add hydrometer"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
