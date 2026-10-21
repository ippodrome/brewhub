import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Device } from "@brewhub/shared-types";
import { updateDeviceConfig } from "../api/devices";

type Mode = "off" | "thermostat" | "pid";

export function DeviceConfigForm({ device, onClose }: { device: Device; onClose: () => void }): JSX.Element {
  const [setpointC, setSetpointC] = useState("20.0");
  const [hysteresisC, setHysteresisC] = useState("0.5");
  const [mode, setMode] = useState<Mode>("thermostat");
  const [kp, setKp] = useState("0");
  const [ki, setKi] = useState("0");
  const [kd, setKd] = useState("0");
  const [pidWindowMinutes, setPidWindowMinutes] = useState("5");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      updateDeviceConfig(device.id, {
        setpointC: Number(setpointC),
        hysteresisC: Number(hysteresisC),
        mode,
        pidGains: { kp: Number(kp), ki: Number(ki), kd: Number(kd) },
        pidWindowMs: Number(pidWindowMinutes) * 60000,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      onClose();
    },
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3 rounded-xl border border-line bg-surface p-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-dim">Setpoint (°C)</label>
          <input
            type="number"
            step="0.1"
            className="field px-2.5 py-1.5 text-sm"
            value={setpointC}
            onChange={(e) => setSetpointC(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-dim">Hysteresis (°C)</label>
          <input
            type="number"
            step="0.1"
            min="0.1"
            className="field px-2.5 py-1.5 text-sm"
            value={hysteresisC}
            onChange={(e) => setHysteresisC(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-dim">Mode</label>
        <select
          className="field px-2.5 py-1.5 text-sm"
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
        >
          <option value="thermostat">Thermostat</option>
          <option value="pid">PID</option>
          <option value="off">Off</option>
        </select>
      </div>

      {mode === "pid" && (
        <div className="space-y-2 rounded-xl border border-line bg-card p-3">
          <p className="text-xs text-dim">
            PID gains. Output is time-proportioned: the relay is on for a fraction of each window
            matching the PID demand.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-dim">Kp</label>
              <input
                type="number"
                step="0.1"
                className="field px-2.5 py-1.5 text-sm"
                value={kp}
                onChange={(e) => setKp(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-dim">Ki</label>
              <input
                type="number"
                step="0.01"
                className="field px-2.5 py-1.5 text-sm"
                value={ki}
                onChange={(e) => setKi(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-dim">Kd</label>
              <input
                type="number"
                step="0.1"
                className="field px-2.5 py-1.5 text-sm"
                value={kd}
                onChange={(e) => setKd(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-dim">Time-proportioning window (minutes)</label>
            <input
              type="number"
              step="1"
              min="1"
              className="field px-2.5 py-1.5 text-sm"
              value={pidWindowMinutes}
              onChange={(e) => setPidWindowMinutes(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-xl px-3 py-1.5 text-xs text-dim hover:text-fg">
          Cancel
        </button>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="btn-primary px-3 py-1.5 text-xs"
        >
          {mutation.isPending ? "Saving..." : "Save config"}
        </button>
      </div>

      <RelayPolarityFields device={device} />
    </form>
  );
}

type Polarity = "default" | "low" | "high";

const POLARITY_TO_VALUE: Record<Polarity, boolean | null> = {
  default: null,
  low: true,
  high: false,
};

/**
 * Deliberately its own block with its own submit, not part of the form above.
 * That form doesn't hydrate from the device's stored config (its fields start
 * at hardcoded defaults), so folding polarity into it would silently reset an
 * already-corrected polarity every time someone saved a setpoint.
 */
function RelayPolarityFields({ device }: { device: Device }): JSX.Element {
  const [cooling, setCooling] = useState<Polarity>("default");
  const [heating, setHeating] = useState<Polarity>("default");
  const queryClient = useQueryClient();

  const hasHeating = device.type === "fermenter";

  const mutation = useMutation({
    mutationFn: () =>
      updateDeviceConfig(device.id, {
        coolingRelayActiveLow: POLARITY_TO_VALUE[cooling],
        ...(hasHeating ? { heatingRelayActiveLow: POLARITY_TO_VALUE[heating] } : {}),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["devices"] }),
  });

  const selectClass =
    "field px-2.5 py-1.5 text-sm";

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <p className="text-xs font-medium text-muted">Relay wiring</p>
      <p className="text-xs text-dim">
        Which logic level switches your relay module on. Most opto-isolated boards are active-low. Only change this
        if the output is behaving backwards — the device forces everything off and waits out its minimum off-time
        before resuming control, so the compressor can't be short-cycled by the change.
      </p>

      <div className={hasHeating ? "grid grid-cols-2 gap-3" : ""}>
        <div className="space-y-1">
          <label className="text-xs text-dim">Cooling relay</label>
          <select className={selectClass} value={cooling} onChange={(e) => setCooling(e.target.value as Polarity)}>
            <option value="default">Board default</option>
            <option value="low">Active low</option>
            <option value="high">Active high</option>
          </select>
        </div>
        {hasHeating && (
          <div className="space-y-1">
            <label className="text-xs text-dim">Heating relay</label>
            <select className={selectClass} value={heating} onChange={(e) => setHeating(e.target.value as Polarity)}>
              <option value="default">Board default</option>
              <option value="low">Active low</option>
              <option value="high">Active high</option>
            </select>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="rounded-xl px-3 py-1.5 text-xs text-muted hover:bg-tint hover:text-fg disabled:opacity-50"
        >
          {mutation.isPending ? "Applying..." : "Apply relay wiring"}
        </button>
      </div>
      {mutation.isError && (
        <p className="text-xs text-crit">Could not apply the relay wiring change.</p>
      )}
    </div>
  );
}
