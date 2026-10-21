import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { boardToDeviceType, type DeviceType, type FirmwareBoard } from "@brewhub/shared-types";
import { createDevice } from "../api/devices";
import { listDiscoveredDevices } from "../api/discovered-devices";
import { ApiError } from "../api/client";

export function AddDeviceModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<DeviceType>("fermenter");
  const [chamberName, setChamberName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const discoveredQuery = useQuery({ queryKey: ["discovered-devices"], queryFn: listDiscoveredDevices });

  function pickDiscovered(deviceId: string, board: FirmwareBoard): void {
    setId(deviceId);
    setType(boardToDeviceType(board));
    if (!name) setName(deviceId);
  }

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
    <div className="modal-backdrop fixed inset-0 z-10 flex items-center justify-center bg-[#140d06]/55 backdrop-blur-sm p-4">
      <form
        onSubmit={handleSubmit}
        className="modal-panel card w-full max-w-md space-y-4 p-7 shadow-lift"
      >
        <h2 className="font-display text-xl font-semibold text-fg">Add device</h2>

        {discoveredQuery.data && discoveredQuery.data.length > 0 && (
          <div className="space-y-1.5 rounded-xl border border-line bg-surface p-2.5">
            <p className="text-xs text-dim">
              Announced over MQTT, not yet registered — click to fill in the fields below.
            </p>
            <ul className="space-y-1">
              {discoveredQuery.data.map((d) => (
                <li key={d.deviceId}>
                  <button
                    type="button"
                    onClick={() => pickDiscovered(d.deviceId, d.board)}
                    className="w-full rounded-xl px-2 py-1.5 text-left text-xs text-muted hover:bg-tint"
                  >
                    <span className="font-medium">{d.deviceId}</span>{" "}
                    <span className="text-dim">
                      · {d.board} · v{d.firmwareVersion}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-sm text-muted">Device ID</label>
          <input
            className="field"
            placeholder="fermenter-01"
            value={id}
            onChange={(e) => setId(e.target.value)}
            required
            autoFocus
          />
          <p className="text-xs text-dim">Must match the device's compile-time DEVICE_ID.</p>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-muted">Name</label>
          <input
            className="field"
            placeholder="Fermenter 1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-muted">Type</label>
          <select
            className="field"
            value={type}
            onChange={(e) => setType(e.target.value as DeviceType)}
          >
            <option value="fermenter">Fermenter</option>
            <option value="kegerator">Kegerator</option>
            <option value="keg_scale">Keg Scale</option>
            <option value="gravity_bridge">Gravity Bridge</option>
            <option value="sensor">Sensor</option>
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-muted">Chamber (optional)</label>
          <input
            className="field"
            placeholder="Garage"
            value={chamberName}
            onChange={(e) => setChamberName(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-crit">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3 py-2 text-sm text-muted hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="btn-primary"
          >
            {mutation.isPending ? "Adding..." : "Add device"}
          </button>
        </div>
      </form>
    </div>
  );
}
