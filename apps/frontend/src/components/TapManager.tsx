import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LOW_VOLUME_THRESHOLD_PERCENT, type Device, type Tap, type TapMeasurementType } from "@brewhub/shared-types";
import { createTap, deleteTap, listPours, listTaps, updateTap } from "../api/taps";
import { listDevices } from "../api/devices";
import { useLiveTelemetry } from "../ws/useLiveTelemetry";
import { FlowCalibrationPanel } from "./FlowCalibrationPanel";

function VolumeBar({ tap }: { tap: Tap }): JSX.Element {
  const fraction = tap.fullVolumeMl > 0 ? tap.remainingVolumeMl / tap.fullVolumeMl : 0;
  const percent = Math.max(0, Math.min(100, fraction * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-tint">
      <div
        className={`h-full rounded-full ${percent < LOW_VOLUME_THRESHOLD_PERCENT ? "bg-crit" : "bg-ok"}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function TapRow({ device, tap }: { device: Device; tap: Tap }): JSX.Element {
  const [poursOpen, setPoursOpen] = useState(false);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const queryClient = useQueryClient();

  const poursQuery = useQuery({
    queryKey: ["pours", device.id, tap.id],
    queryFn: () => listPours(device.id, tap.id),
    enabled: poursOpen,
  });

  const resetMutation = useMutation({
    mutationFn: () => updateTap(device.id, tap.id, { resetKeg: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["taps", device.id] }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTap(device.id, tap.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["taps", device.id] }),
  });

  return (
    <li className="space-y-2 rounded-xl border border-line bg-card px-3 py-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-fg">
            {tap.name}
            {tap.style && <span className="text-dim"> · {tap.style}</span>}
          </p>
          <p className="text-xs text-dim">
            {tap.measurementType === "flow" ? (
              <>Flow {tap.flowIndex}</>
            ) : (
              <>
                Scale {tap.weightDeviceId ?? "(unassigned)"} · channel {tap.weightIndex}
              </>
            )}
            {tap.abv !== null && <> · {tap.abv}% ABV</>}
            {tap.ibu !== null && <> · {tap.ibu} IBU</>}
          </p>
        </div>
        <div className="flex gap-2">
          {tap.measurementType === "flow" && (
            <>
              <button
                onClick={() => setPoursOpen((v) => !v)}
                className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg"
              >
                Pours
              </button>
              <button
                onClick={() => setCalibrationOpen((v) => !v)}
                className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg"
              >
                Calibrate
              </button>
            </>
          )}
          <button
            onClick={() => resetMutation.mutate()}
            disabled={resetMutation.isPending}
            className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg"
          >
            New keg
          </button>
          <button
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="rounded-xl px-2.5 py-1 text-xs text-dim hover:bg-tint hover:text-crit"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="space-y-1">
        <VolumeBar tap={tap} />
        <p className="text-xs text-dim">
          {Math.round(tap.remainingVolumeMl)} / {Math.round(tap.fullVolumeMl)} mL remaining
        </p>
      </div>

      {tap.kickedAt !== null && (
        <div className="rounded-xl border border-crit/30 bg-crit/10 px-3 py-2 text-xs text-crit">
          Kicked {new Date(tap.kickedAt).toLocaleString()} — gas was running through the line instead of beer.
          Tap a new keg with <strong>New keg</strong> to clear this.
        </div>
      )}

      {calibrationOpen && tap.measurementType === "flow" && (
        <FlowCalibrationPanel device={device} tap={tap} />
      )}

      {poursOpen && (
        <div className="border-t border-line pt-2 text-xs text-dim">
          {poursQuery.isLoading && <p>Loading...</p>}
          {poursQuery.data && poursQuery.data.length === 0 && <p>No pours logged yet.</p>}
          {poursQuery.data && poursQuery.data.length > 0 && (
            <ul className="space-y-1">
              {poursQuery.data.slice(0, 10).map((pour) => (
                <li key={pour.id} className="flex justify-between">
                  <span>{new Date(pour.startedAt).toLocaleString()}</span>
                  <span className="tabular-nums">{Math.round(pour.volumeMl)} mL</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

const inputClass =
  "w-full rounded-xl border border-line-strong bg-card px-2 py-1.5 text-sm text-fg outline-none focus:border-line-focus";
const labelClass = "text-xs text-dim";

export function TapManager({ device, onClose }: { device: Device; onClose: () => void }): JSX.Element {
  const [measurementType, setMeasurementType] = useState<TapMeasurementType>("flow");
  const [name, setName] = useState("");
  const [style, setStyle] = useState("");
  const [abv, setAbv] = useState("");
  const [ibu, setIbu] = useState("");
  const [fullVolumeMl, setFullVolumeMl] = useState("19000");

  const [flowIndex, setFlowIndex] = useState("0");
  const [pulsesPerLiter, setPulsesPerLiter] = useState("500");

  const [weightDeviceId, setWeightDeviceId] = useState("");
  const [weightIndex, setWeightIndex] = useState("0");
  const [tareWeightG, setTareWeightG] = useState("");
  const [fullWeightG, setFullWeightG] = useState("");

  const queryClient = useQueryClient();
  const { telemetryByDevice } = useLiveTelemetry();

  const tapsQuery = useQuery({
    queryKey: ["taps", device.id],
    queryFn: () => listTaps(device.id),
  });

  const devicesQuery = useQuery({ queryKey: ["devices"], queryFn: listDevices });
  const kegScaleDevices = (devicesQuery.data ?? []).filter((d) => d.type === "keg_scale");
  const currentScaleGrams = weightDeviceId ? telemetryByDevice[weightDeviceId]?.weights?.[0]?.grams : undefined;

  const createMutation = useMutation({
    mutationFn: () =>
      createTap(
        device.id,
        measurementType === "flow"
          ? {
              measurementType: "flow",
              flowIndex: Number(flowIndex),
              name,
              style: style || undefined,
              abv: abv ? Number(abv) : undefined,
              ibu: ibu ? Number(ibu) : undefined,
              pulsesPerLiter: Number(pulsesPerLiter),
              fullVolumeMl: Number(fullVolumeMl),
            }
          : {
              measurementType: "weight",
              weightDeviceId,
              weightIndex: Number(weightIndex),
              tareWeightG: Number(tareWeightG),
              fullWeightG: Number(fullWeightG),
              name,
              style: style || undefined,
              abv: abv ? Number(abv) : undefined,
              ibu: ibu ? Number(ibu) : undefined,
              fullVolumeMl: Number(fullVolumeMl),
            },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["taps", device.id] });
      setName("");
      setStyle("");
      setAbv("");
      setIbu("");
      setTareWeightG("");
      setFullWeightG("");
    },
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <div className="mt-3 space-y-4 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-fg">Taps</h3>
        <button onClick={onClose} className="text-xs text-dim hover:text-fg">
          Close
        </button>
      </div>

      {tapsQuery.isLoading && <p className="text-xs text-dim">Loading taps...</p>}
      {tapsQuery.data && tapsQuery.data.length === 0 && (
        <p className="text-xs text-dim">No taps configured yet.</p>
      )}
      {tapsQuery.data && tapsQuery.data.length > 0 && (
        <ul className="space-y-2">
          {tapsQuery.data.map((tap) => (
            <TapRow key={tap.id} device={device} tap={tap} />
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="space-y-2 border-t border-line pt-3">
        <p className="text-xs font-medium text-muted">New tap</p>

        <div className="space-y-1">
          <label className={labelClass}>Measurement</label>
          <select
            className={inputClass}
            value={measurementType}
            onChange={(e) => setMeasurementType(e.target.value as TapMeasurementType)}
          >
            <option value="flow">Flow meter</option>
            <option value="weight">Keg scale</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {measurementType === "flow" ? (
            <div className="space-y-1">
              <label className={labelClass}>Flow input</label>
              <select className={inputClass} value={flowIndex} onChange={(e) => setFlowIndex(e.target.value)}>
                {Array.from({ length: 9 }, (_, i) => (
                  <option key={i} value={i}>
                    Flow {i}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-1">
              <label className={labelClass}>Scale device</label>
              <select
                className={inputClass}
                value={weightDeviceId}
                onChange={(e) => setWeightDeviceId(e.target.value)}
                required
              >
                <option value="" disabled>
                  Select a keg_scale device
                </option>
                {kegScaleDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.id})
                  </option>
                ))}
              </select>
              {kegScaleDevices.length === 0 && (
                <p className="text-xs text-amber">No keg_scale devices added yet.</p>
              )}
            </div>
          )}
          <div className="space-y-1">
            <label className={labelClass}>Name</label>
            <input
              className={inputClass}
              placeholder="House IPA"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <label className={labelClass}>Style</label>
            <input className={inputClass} value={style} onChange={(e) => setStyle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>ABV %</label>
            <input
              type="number"
              step="0.1"
              className={inputClass}
              value={abv}
              onChange={(e) => setAbv(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>IBU</label>
            <input type="number" className={inputClass} value={ibu} onChange={(e) => setIbu(e.target.value)} />
          </div>
        </div>

        {measurementType === "flow" ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className={labelClass}>Calibration (pulses/L)</label>
              <input
                type="number"
                className={inputClass}
                value={pulsesPerLiter}
                onChange={(e) => setPulsesPerLiter(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Full keg volume (mL)</label>
              <input
                type="number"
                className={inputClass}
                value={fullVolumeMl}
                onChange={(e) => setFullVolumeMl(e.target.value)}
                required
              />
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className={labelClass}>Scale channel</label>
                <input
                  type="number"
                  min={0}
                  className={inputClass}
                  value={weightIndex}
                  onChange={(e) => setWeightIndex(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Empty (tare) weight (g)</label>
                <input
                  type="number"
                  className={inputClass}
                  value={tareWeightG}
                  onChange={(e) => setTareWeightG(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Full keg weight (g)</label>
                <input
                  type="number"
                  className={inputClass}
                  value={fullWeightG}
                  onChange={(e) => setFullWeightG(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Full keg volume (mL)</label>
              <input
                type="number"
                className={inputClass}
                value={fullVolumeMl}
                onChange={(e) => setFullVolumeMl(e.target.value)}
                required
              />
            </div>
            {weightDeviceId && (
              <p className="text-xs text-dim">
                Current scale reading:{" "}
                {currentScaleGrams === undefined
                  ? "no reading yet"
                  : currentScaleGrams === null
                    ? "sensor fault"
                    : `${Math.round(currentScaleGrams)} g`}{" "}
                — place an empty keg and note the value for "Empty weight", then a full keg for "Full weight".
              </p>
            )}
          </>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-xl bg-amber hover:bg-amber-hi px-3 py-1.5 text-xs font-medium text-on-amber disabled:opacity-50"
          >
            {createMutation.isPending ? "Adding..." : "Add tap"}
          </button>
        </div>
      </form>
    </div>
  );
}
