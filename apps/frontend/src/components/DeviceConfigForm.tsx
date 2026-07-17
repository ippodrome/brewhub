import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Device } from "@brewhub/shared-types";
import { updateDeviceConfig } from "../api/devices";

export function DeviceConfigForm({ device, onClose }: { device: Device; onClose: () => void }): JSX.Element {
  const [setpointC, setSetpointC] = useState("20.0");
  const [hysteresisC, setHysteresisC] = useState("0.5");
  const [mode, setMode] = useState<"off" | "thermostat">("thermostat");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      updateDeviceConfig(device.id, {
        setpointC: Number(setpointC),
        hysteresisC: Number(hysteresisC),
        mode,
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
    <form onSubmit={handleSubmit} className="mt-3 space-y-3 rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-neutral-500">Setpoint (°C)</label>
          <input
            type="number"
            step="0.1"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
            value={setpointC}
            onChange={(e) => setSetpointC(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-neutral-500">Hysteresis (°C)</label>
          <input
            type="number"
            step="0.1"
            min="0.1"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
            value={hysteresisC}
            onChange={(e) => setHysteresisC(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-neutral-500">Mode</label>
        <select
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          value={mode}
          onChange={(e) => setMode(e.target.value as "off" | "thermostat")}
        >
          <option value="thermostat">Thermostat</option>
          <option value="off">Off</option>
        </select>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-300">
          Cancel
        </button>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900 disabled:opacity-50"
        >
          {mutation.isPending ? "Saving..." : "Save config"}
        </button>
      </div>
    </form>
  );
}
