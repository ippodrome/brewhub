import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Device, Tap } from "@brewhub/shared-types";
import { createTap, deleteTap, listPours, listTaps, updateTap } from "../api/taps";

function VolumeBar({ tap }: { tap: Tap }): JSX.Element {
  const fraction = tap.fullVolumeMl > 0 ? tap.remainingVolumeMl / tap.fullVolumeMl : 0;
  const percent = Math.max(0, Math.min(100, fraction * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
      <div
        className={`h-full rounded-full ${percent < 15 ? "bg-red-400" : "bg-emerald-400"}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function TapRow({ device, tap }: { device: Device; tap: Tap }): JSX.Element {
  const [poursOpen, setPoursOpen] = useState(false);
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
    <li className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-neutral-200">
            {tap.name}
            {tap.style && <span className="text-neutral-500"> · {tap.style}</span>}
          </p>
          <p className="text-xs text-neutral-500">
            Flow {tap.flowIndex}
            {tap.abv !== null && <> · {tap.abv}% ABV</>}
            {tap.ibu !== null && <> · {tap.ibu} IBU</>}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setPoursOpen((v) => !v)}
            className="rounded-lg px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            Pours
          </button>
          <button
            onClick={() => resetMutation.mutate()}
            disabled={resetMutation.isPending}
            className="rounded-lg px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            New keg
          </button>
          <button
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="rounded-lg px-2.5 py-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="space-y-1">
        <VolumeBar tap={tap} />
        <p className="text-xs text-neutral-500">
          {Math.round(tap.remainingVolumeMl)} / {Math.round(tap.fullVolumeMl)} mL remaining
        </p>
      </div>

      {poursOpen && (
        <div className="border-t border-neutral-800 pt-2 text-xs text-neutral-500">
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

export function TapManager({ device, onClose }: { device: Device; onClose: () => void }): JSX.Element {
  const [flowIndex, setFlowIndex] = useState("0");
  const [name, setName] = useState("");
  const [style, setStyle] = useState("");
  const [abv, setAbv] = useState("");
  const [ibu, setIbu] = useState("");
  const [pulsesPerLiter, setPulsesPerLiter] = useState("500");
  const [fullVolumeMl, setFullVolumeMl] = useState("19000");
  const queryClient = useQueryClient();

  const tapsQuery = useQuery({
    queryKey: ["taps", device.id],
    queryFn: () => listTaps(device.id),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createTap(device.id, {
        flowIndex: Number(flowIndex),
        name,
        style: style || undefined,
        abv: abv ? Number(abv) : undefined,
        ibu: ibu ? Number(ibu) : undefined,
        pulsesPerLiter: Number(pulsesPerLiter),
        fullVolumeMl: Number(fullVolumeMl),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["taps", device.id] });
      setName("");
      setStyle("");
      setAbv("");
      setIbu("");
    },
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <div className="mt-3 space-y-4 rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-200">Taps</h3>
        <button onClick={onClose} className="text-xs text-neutral-500 hover:text-neutral-300">
          Close
        </button>
      </div>

      {tapsQuery.isLoading && <p className="text-xs text-neutral-500">Loading taps...</p>}
      {tapsQuery.data && tapsQuery.data.length === 0 && (
        <p className="text-xs text-neutral-500">No taps configured yet.</p>
      )}
      {tapsQuery.data && tapsQuery.data.length > 0 && (
        <ul className="space-y-2">
          {tapsQuery.data.map((tap) => (
            <TapRow key={tap.id} device={device} tap={tap} />
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="space-y-2 border-t border-neutral-800 pt-3">
        <p className="text-xs font-medium text-neutral-300">New tap</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs text-neutral-500">Flow input</label>
            <select
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
              value={flowIndex}
              onChange={(e) => setFlowIndex(e.target.value)}
            >
              {Array.from({ length: 9 }, (_, i) => (
                <option key={i} value={i}>
                  Flow {i}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-500">Name</label>
            <input
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
              placeholder="House IPA"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <label className="text-xs text-neutral-500">Style</label>
            <input
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-500">ABV %</label>
            <input
              type="number"
              step="0.1"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
              value={abv}
              onChange={(e) => setAbv(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-500">IBU</label>
            <input
              type="number"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
              value={ibu}
              onChange={(e) => setIbu(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs text-neutral-500">Calibration (pulses/L)</label>
            <input
              type="number"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
              value={pulsesPerLiter}
              onChange={(e) => setPulsesPerLiter(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-500">Full keg volume (mL)</label>
            <input
              type="number"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
              value={fullVolumeMl}
              onChange={(e) => setFullVolumeMl(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900 disabled:opacity-50"
          >
            {createMutation.isPending ? "Adding..." : "Add tap"}
          </button>
        </div>
      </form>
    </div>
  );
}
