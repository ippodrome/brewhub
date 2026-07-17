import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DeviceType } from "@brewhub/shared-types";
import { createDevice } from "../api/devices";
import { ApiError } from "../api/client";

export function AddDeviceModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<DeviceType>("fermenter");
  const [chamberName, setChamberName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => createDevice({ id, name, type, chamberName: chamberName || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError && err.status === 409 ? "A device with that ID already exists" : "Could not create device");
    },
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-6"
      >
        <h2 className="text-lg font-semibold text-neutral-100">Add device</h2>

        <div className="space-y-1">
          <label className="text-sm text-neutral-400">Device ID</label>
          <input
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-500"
            placeholder="fermenter-01"
            value={id}
            onChange={(e) => setId(e.target.value)}
            required
            autoFocus
          />
          <p className="text-xs text-neutral-500">Must match the device's compile-time DEVICE_ID.</p>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-neutral-400">Name</label>
          <input
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-500"
            placeholder="Fermenter 1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-neutral-400">Type</label>
          <select
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-500"
            value={type}
            onChange={(e) => setType(e.target.value as DeviceType)}
          >
            <option value="fermenter">Fermenter</option>
            <option value="kegerator">Kegerator</option>
            <option value="sensor">Sensor</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-neutral-400">Chamber (optional)</label>
          <input
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-500"
            placeholder="Garage"
            value={chamberName}
            onChange={(e) => setChamberName(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-neutral-400 hover:text-neutral-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 disabled:opacity-50"
          >
            {mutation.isPending ? "Adding..." : "Add device"}
          </button>
        </div>
      </form>
    </div>
  );
}
