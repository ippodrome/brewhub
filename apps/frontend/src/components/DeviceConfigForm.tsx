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
    <form onSubmit={handleSubmit} className="mt-3 space-y-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-neutral-600 dark:text-neutral-500">Setpoint (°C)</label>
          <input
            type="number"
            step="0.1"
            className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
            value={setpointC}
            onChange={(e) => setSetpointC(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-neutral-600 dark:text-neutral-500">Hysteresis (°C)</label>
          <input
            type="number"
            step="0.1"
            min="0.1"
            className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
            value={hysteresisC}
            onChange={(e) => setHysteresisC(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-neutral-600 dark:text-neutral-500">Mode</label>
        <select
          className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
        >
          <option value="thermostat">Thermostat</option>
          <option value="pid">PID</option>
          <option value="off">Off</option>
        </select>
      </div>

      {mode === "pid" && (
        <div className="space-y-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-3">
          <p className="text-xs text-neutral-600 dark:text-neutral-500">
            PID gains. Output is time-proportioned: the relay is on for a fraction of each window
            matching the PID demand.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-xs text-neutral-600 dark:text-neutral-500">Kp</label>
              <input
                type="number"
                step="0.1"
                className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                value={kp}
                onChange={(e) => setKp(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-600 dark:text-neutral-500">Ki</label>
              <input
                type="number"
                step="0.01"
                className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                value={ki}
                onChange={(e) => setKi(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-neutral-600 dark:text-neutral-500">Kd</label>
              <input
                type="number"
                step="0.1"
                className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                value={kd}
                onChange={(e) => setKd(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-neutral-600 dark:text-neutral-500">Time-proportioning window (minutes)</label>
            <input
              type="number"
              step="1"
              min="1"
              className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
              value={pidWindowMinutes}
              onChange={(e) => setPidWindowMinutes(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-xl px-3 py-1.5 text-xs text-neutral-600 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300">
          Cancel
        </button>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-xl bg-amber-500 hover:bg-amber-400 dark:bg-amber-500 dark:hover:bg-amber-400 px-3 py-1.5 text-xs font-medium text-zinc-950 disabled:opacity-50"
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
    "w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500";

  return (
    <div className="space-y-2 border-t border-neutral-200 dark:border-neutral-800 pt-3">
      <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Relay wiring</p>
      <p className="text-xs text-neutral-600 dark:text-neutral-500">
        Which logic level switches your relay module on. Most opto-isolated boards are active-low. Only change this
        if the output is behaving backwards — the device forces everything off and waits out its minimum off-time
        before resuming control, so the compressor can't be short-cycled by the change.
      </p>

      <div className={hasHeating ? "grid grid-cols-2 gap-3" : ""}>
        <div className="space-y-1">
          <label className="text-xs text-neutral-600 dark:text-neutral-500">Cooling relay</label>
          <select className={selectClass} value={cooling} onChange={(e) => setCooling(e.target.value as Polarity)}>
            <option value="default">Board default</option>
            <option value="low">Active low</option>
            <option value="high">Active high</option>
          </select>
        </div>
        {hasHeating && (
          <div className="space-y-1">
            <label className="text-xs text-neutral-600 dark:text-neutral-500">Heating relay</label>
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
          className="rounded-xl px-3 py-1.5 text-xs text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200 disabled:opacity-50"
        >
          {mutation.isPending ? "Applying..." : "Apply relay wiring"}
        </button>
      </div>
      {mutation.isError && (
        <p className="text-xs text-red-600 dark:text-red-400">Could not apply the relay wiring change.</p>
      )}
    </div>
  );
}
