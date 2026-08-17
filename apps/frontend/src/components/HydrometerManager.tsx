import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Device, HydrometerType } from "@brewhub/shared-types";
import { createHydrometer, deleteHydrometer, listHydrometers, updateHydrometer } from "../api/hydrometers";
import { getGravityHistory } from "../api/history";
import { DeviceHistoryChart } from "./DeviceHistoryChart";

const inputClass =
  "w-full rounded-xl border border-line-strong bg-card px-2 py-1.5 text-sm text-fg outline-none focus:border-line-focus";
const labelClass = "text-xs text-dim";

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
    <div className="mt-3 space-y-4 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-fg">Hydrometer</h3>
        <button onClick={onClose} className="text-xs text-dim hover:text-fg">
          Close
        </button>
      </div>

      {hydrometersQuery.isLoading && <p className="text-xs text-dim">Loading...</p>}

      {assigned ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-line bg-card p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-fg">
                  {TYPE_LABELS[assigned.type]} · {assigned.identifier}
                </p>
                <p className="text-xs text-dim">
                  {latest?.gravitySg != null ? `Latest: ${latest.gravitySg.toFixed(3)} SG` : "No reading yet"}
                </p>
              </div>
              <button
                onClick={() => unassignMutation.mutate(assigned.id)}
                disabled={unassignMutation.isPending}
                className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg"
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
          <p className="text-xs text-dim">
            No hydrometer assigned to this fermenter yet.
          </p>

          {unassigned.length > 0 && (
            <div className="space-y-1">
              <p className={labelClass}>Assign an existing hydrometer</p>
              {unassigned.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between rounded-xl border border-line bg-card px-3 py-2"
                >
                  <span className="text-sm text-fg">
                    {TYPE_LABELS[h.type]} · {h.identifier}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => assignMutation.mutate(h.id)}
                      disabled={assignMutation.isPending}
                      className="rounded-xl px-2.5 py-1 text-xs text-ok hover:bg-ok/10"
                    >
                      Assign
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(h.id)}
                      disabled={deleteMutation.isPending}
                      className="rounded-xl px-2.5 py-1 text-xs text-dim hover:bg-tint hover:text-crit"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-2 border-t border-line pt-3">
            <p className="text-xs font-medium text-muted">Add a new hydrometer</p>
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
              <p className="text-xs text-crit">
                Could not add hydrometer — that identifier may already be in use.
              </p>
            )}
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="rounded-xl bg-amber hover:bg-amber-hi px-3 py-1.5 text-xs font-medium text-on-amber disabled:opacity-50"
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
