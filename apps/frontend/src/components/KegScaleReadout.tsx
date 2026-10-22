import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_BEER_DENSITY_KG_PER_L,
  KEG_TARE_PRESETS,
  computeKegContents,
  effectiveBeerDensity,
  type Device,
  type Tap,
} from "@brewhub/shared-types";
import { updateDeviceConfig } from "../api/devices";
import { listWeightTaps, tareKegNow, updateTap } from "../api/taps";
import { useLiveTelemetry } from "../ws/useLiveTelemetry";
import { ConfirmDialog } from "./ConfirmDialog";
import { formatKg, formatLitres, kgFieldToGrams, useKegUnit, type KegUnit } from "../lib/keg-scale";

const smallBtn = "rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg disabled:opacity-50";

export function UnitToggle({ unit, onToggle }: { unit: KegUnit; onToggle: () => void }): JSX.Element {
  return (
    <div role="group" aria-label="Display unit" className="inline-flex rounded-full bg-tint p-0.5 text-xs">
      {(["volume", "weight"] as const).map((u) => (
        <button
          key={u}
          type="button"
          aria-pressed={unit === u}
          onClick={() => unit !== u && onToggle()}
          className={`rounded-full px-2.5 py-0.5 font-medium ${unit === u ? "bg-card text-fg shadow-card ring-1 ring-line" : "text-muted"}`}
        >
          {u === "volume" ? "L" : "kg"}
        </button>
      ))}
    </div>
  );
}

/** Empty-keg weight (with presets + Tare now), density/FG, full volume — for one weight tap. */
function KegSetupForm({ tap, grossG, onDone }: { tap: Tap; grossG: number | null; onDone: () => void }): JSX.Element {
  const queryClient = useQueryClient();
  const [emptyKg, setEmptyKg] = useState(tap.tareWeightG !== null ? String(tap.tareWeightG / 1000) : "");
  const [density, setDensity] = useState(String(tap.beerDensityKgPerL ?? DEFAULT_BEER_DENSITY_KG_PER_L));
  const [fg, setFg] = useState(tap.finalGravitySg !== null ? String(tap.finalGravitySg) : "");
  const [fullL, setFullL] = useState(String(tap.fullVolumeMl / 1000));
  const [confirmTare, setConfirmTare] = useState(false);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["weight-taps"] });
    void queryClient.invalidateQueries({ queryKey: ["taps", tap.deviceId] });
  };

  const save = useMutation({
    mutationFn: () => {
      const tareWeightG = kgFieldToGrams(emptyKg);
      return updateTap(tap.deviceId, tap.id, {
        ...(tareWeightG !== null ? { tareWeightG } : {}),
        beerDensityKgPerL: Number(density.replace(",", ".")),
        finalGravitySg: fg.trim() === "" ? null : Number(fg.replace(",", ".")),
        fullVolumeMl: Math.round(Number(fullL.replace(",", ".")) * 1000),
      });
    },
    onSuccess: () => {
      invalidate();
      onDone();
    },
  });

  const tareNow = useMutation({
    mutationFn: () => tareKegNow(tap.deviceId, tap.id),
    onSuccess: (updated) => {
      setEmptyKg(String((updated.tareWeightG ?? 0) / 1000));
      setConfirmTare(false);
      invalidate();
    },
  });

  function submit(e: FormEvent): void {
    e.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-surface p-3">
      <div className="space-y-1">
        <label className="text-xs text-dim" htmlFor={`empty-${tap.id}`}>Empty keg weight (kg)</label>
        <div className="flex flex-wrap gap-2">
          <input
            id={`empty-${tap.id}`}
            type="number"
            step="0.01"
            min={0}
            className="field w-28 px-2.5 py-1.5 text-sm"
            value={emptyKg}
            onChange={(e) => setEmptyKg(e.target.value)}
          />
          <select
            aria-label="Keg preset"
            className="field min-w-0 flex-1 px-2.5 py-1.5 text-sm"
            value=""
            onChange={(e) => {
              const p = KEG_TARE_PRESETS.find((x) => x.id === e.target.value);
              if (p) {
                setEmptyKg(String(p.emptyWeightG / 1000));
                setFullL(String(p.volumeMl / 1000));
              }
            }}
          >
            <option value="">Preset (approximate)…</option>
            {KEG_TARE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <button type="button" className={`${smallBtn} ring-1 ring-line`} onClick={() => setConfirmTare(true)} disabled={grossG === null}>
            Tare now
          </button>
        </div>
        <p className="text-xs text-dim">
          Presets are approximate — kegs differ by a few hundred grams. For an exact value put the <em>empty</em> keg on
          the scale and press <strong>Tare now</strong>.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <label className="text-xs text-dim" htmlFor={`fg-${tap.id}`}>Final gravity</label>
          <input id={`fg-${tap.id}`} type="number" step="0.001" min={0.98} max={1.2} placeholder="e.g. 1.010" className="field px-2.5 py-1.5 text-sm" value={fg} onChange={(e) => setFg(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-dim" htmlFor={`density-${tap.id}`}>Density (kg/L)</label>
          <input id={`density-${tap.id}`} type="number" step="0.001" min={0.9} max={1.2} disabled={fg.trim() !== ""} className="field px-2.5 py-1.5 text-sm disabled:opacity-50" value={density} onChange={(e) => setDensity(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-dim" htmlFor={`full-${tap.id}`}>Full keg (L)</label>
          <input id={`full-${tap.id}`} type="number" step="0.1" min={0.1} className="field px-2.5 py-1.5 text-sm" value={fullL} onChange={(e) => setFullL(e.target.value)} required />
        </div>
      </div>
      <p className="text-xs text-dim">
        Volume = (scale reading − empty keg) ÷ density. A known FG is used as the density (FG 1.010 → 1.010 kg/L);
        otherwise the density field (default 1.010). Full keg volume is used for the % remaining.
      </p>

      <div className="flex justify-end gap-2">
        <button type="button" className={smallBtn} onClick={onDone}>Cancel</button>
        <button type="submit" disabled={save.isPending} className="btn-primary px-3 py-1.5 text-xs">
          {save.isPending ? "Saving..." : "Save"}
        </button>
      </div>
      {save.isError && <p className="text-xs text-crit">Could not save — check the values.</p>}

      {confirmTare && (
        <ConfirmDialog
          title="Use current reading as empty keg?"
          confirmLabel="Tare now"
          pendingLabel="Taring..."
          tone="primary"
          pending={tareNow.isPending}
          error={tareNow.isError ? "Could not read the scale — is it online?" : null}
          onConfirm={() => tareNow.mutate()}
          onCancel={() => setConfirmTare(false)}
        >
          The scale reads {grossG !== null ? `${formatKg(grossG)} kg` : "nothing"} right now. That becomes the empty
          weight for <strong>{tap.name}</strong>, so only do this with the empty keg (and nothing else) on the platform.
        </ConfirmDialog>
      )}
    </form>
  );
}

function KegChannel({ tap, grossG, unit, onToggle }: { tap: Tap; grossG: number | null | undefined; unit: KegUnit; onToggle: () => void }): JSX.Element {
  const [setupOpen, setSetupOpen] = useState(false);
  const calibrated = tap.tareWeightG !== null && typeof grossG === "number";
  const contents = calibrated
    ? computeKegContents({
        grossWeightG: grossG,
        emptyKegWeightG: tap.tareWeightG as number,
        densityKgPerL: effectiveBeerDensity(tap),
        fullVolumeMl: tap.fullVolumeMl,
      })
    : null;

  const big = contents ? (unit === "volume" ? formatLitres(contents.volumeMl) : formatKg(contents.netWeightG)) : "—";

  return (
    <div className="space-y-2 rounded-xl border border-line bg-card px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm text-fg">
          {tap.name} <span className="text-dim">· ch {tap.weightIndex}</span>
        </p>
        <UnitToggle unit={unit} onToggle={onToggle} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <p className="font-display text-2xl font-semibold tabular-nums text-fg">
          {big}
          <span className="ml-1 text-sm text-dim">{unit === "volume" ? "L" : "kg"}</span>
          {contents?.percent != null && <span className="ml-2 text-sm text-dim">{Math.round(contents.percent)}%</span>}
        </p>
        <button className={smallBtn} onClick={() => setSetupOpen((v) => !v)}>Keg setup</button>
      </div>
      <p className="text-xs text-dim tabular-nums">
        {contents
          ? `Beer ${formatKg(contents.netWeightG)} kg · ${formatLitres(contents.volumeMl)} L · gross ${formatKg(grossG as number)} kg · empty keg ${formatKg(tap.tareWeightG as number)} kg · ${effectiveBeerDensity(tap).toFixed(3)} kg/L`
          : grossG === null
            ? "Sensor fault"
            : grossG === undefined
              ? "No reading yet"
              : "Set the empty keg weight to see the beer amount"}
      </p>
      {contents?.percent != null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-tint">
          <div className="h-full rounded-full bg-ok" style={{ width: `${contents.percent}%` }} />
        </div>
      )}
      {setupOpen && <KegSetupForm tap={tap} grossG={typeof grossG === "number" ? grossG : null} onDone={() => setSetupOpen(false)} />}
    </div>
  );
}

export function KegScaleReadout({ device }: { device: Device }): JSX.Element {
  const { telemetryByDevice } = useLiveTelemetry();
  const weights = telemetryByDevice[device.id]?.weights ?? [];
  const gramsFor = (index: number): number | null | undefined => weights.find((w) => w.index === index)?.grams;
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [calibrationFactor, setCalibrationFactor] = useState("");
  const [confirmZero, setConfirmZero] = useState(false);

  const tapsQuery = useQuery({ queryKey: ["weight-taps", device.id], queryFn: () => listWeightTaps(device.id) });
  const taps = tapsQuery.data ?? [];
  const [unit, toggleUnit] = useKegUnit(device.id, taps.some((t) => t.tareWeightG !== null));

  const zeroMutation = useMutation({
    mutationFn: () => updateDeviceConfig(device.id, { tareRequestId: Date.now() }),
    onSuccess: () => setConfirmZero(false),
  });

  const calibrationMutation = useMutation({
    mutationFn: () => updateDeviceConfig(device.id, { loadCellCalibrationFactor: Number(calibrationFactor) }),
    onSuccess: () => {
      setCalibrationOpen(false);
      setCalibrationFactor("");
    },
  });

  function handleCalibrationSubmit(event: FormEvent): void {
    event.preventDefault();
    calibrationMutation.mutate();
  }

  const raw = gramsFor(0);

  return (
    <div className="mt-2 space-y-2 border-t border-line pt-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-dim">
          Scale: {raw === undefined ? "no reading yet" : raw === null ? "sensor fault" : `${formatKg(raw)} kg gross`}
        </p>
        <div className="flex gap-2">
          <button onClick={() => setCalibrationOpen((v) => !v)} className={smallBtn} title="Set the HX711 raw-to-grams calibration factor">
            Calibrate
          </button>
          <button
            onClick={() => setConfirmZero(true)}
            className={smallBtn}
            title="Zero the scale platform (HX711) — not the same as the keg's empty weight"
          >
            Zero scale
          </button>
        </div>
      </div>

      {taps.length === 0 && tapsQuery.isSuccess && (
        <p className="text-xs text-dim">
          No tap uses this scale yet. Add a <strong>Keg scale</strong> tap from a kegerator's Taps panel to set the empty
          keg weight and see litres left.
        </p>
      )}
      {taps.map((tap) => (
        <KegChannel key={tap.id} tap={tap} grossG={gramsFor(tap.weightIndex ?? 0)} unit={unit} onToggle={toggleUnit} />
      ))}

      {calibrationOpen && (
        <form onSubmit={handleCalibrationSubmit} className="space-y-2 rounded-xl border border-line bg-surface p-3">
          <p className="text-xs text-dim">
            Raw-to-grams calibration factor. Determine it by placing a known reference weight on the platform and
            adjusting until the reading above is correct — see the keg-scale firmware README.
          </p>
          <div className="flex gap-2">
            <input type="number" step="any" placeholder="e.g. -22500" className="field px-2.5 py-1.5 text-sm" value={calibrationFactor} onChange={(e) => setCalibrationFactor(e.target.value)} required />
            <button type="submit" disabled={calibrationMutation.isPending} className="shrink-0 btn-primary px-3 py-1.5 text-xs">
              {calibrationMutation.isPending ? "Applying..." : "Apply"}
            </button>
          </div>
          {calibrationMutation.isError && <p className="text-xs text-crit">Could not apply calibration factor.</p>}
        </form>
      )}

      {confirmZero && (
        <ConfirmDialog
          title="Zero the scale platform?"
          confirmLabel="Zero scale"
          pendingLabel="Zeroing..."
          tone="primary"
          pending={zeroMutation.isPending}
          error={zeroMutation.isError ? "Could not send the zero command." : null}
          onConfirm={() => zeroMutation.mutate()}
          onCancel={() => setConfirmZero(false)}
        >
          This re-zeroes the load cell itself (HX711) at whatever is on it now. Do it with the platform in its reference
          state — normally <strong>nothing</strong> on it. To record an empty keg's weight instead, use{" "}
          <strong>Keg setup → Tare now</strong>.
        </ConfirmDialog>
      )}
    </div>
  );
}
