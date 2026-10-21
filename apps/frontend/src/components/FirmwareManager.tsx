import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FirmwareBoard, FirmwareBuild } from "@brewhub/shared-types";
import {
  deleteFirmwareBuild,
  downloadFirmwareBytes,
  listFirmwareBuilds,
  triggerOta,
  uploadFirmwareBuild,
} from "../api/firmware";
import { listDevices } from "../api/devices";
import { flashViaWebSerial, isWebSerialSupported } from "../firmware/flashViaWebSerial";

const inputClass =
  "field px-2.5 py-1.5 text-sm";
const labelClass = "text-xs text-dim";

const BOARD_OPTIONS: { value: FirmwareBoard; label: string }[] = [
  { value: "fermenter-brewpi", label: "Fermenter (BrewPi)" },
  { value: "kegerator-kegcop", label: "Kegerator (Keg Cop)" },
  { value: "keg-scale", label: "Keg Scale" },
  { value: "gravity-bridge", label: "Gravity Bridge" },
];

function FlashButton({ build }: { build: FirmwareBuild }): JSX.Element {
  const [flashing, setFlashing] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ written: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = isWebSerialSupported();

  async function handleFlash(): Promise<void> {
    setFlashing(true);
    setError(null);
    setLog([]);
    setProgress(null);
    try {
      const bytes = await downloadFirmwareBytes(build.id);
      await flashViaWebSerial(
        bytes,
        (line) => setLog((prev) => [...prev.slice(-49), line]),
        (p) => setProgress(p),
      );
      setLog((prev) => [...prev, "Done — device is rebooting."]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Flash failed");
    } finally {
      setFlashing(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleFlash}
        disabled={!supported || flashing}
        title={supported ? undefined : "WebSerial isn't available in this browser — use Chrome or Edge"}
        className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg disabled:opacity-50"
      >
        {flashing ? "Flashing..." : "Flash via WebSerial"}
      </button>
      {(log.length > 0 || error) && (
        <div className="mt-2 max-w-md space-y-1 rounded-xl border border-line bg-surface p-2 text-xs">
          {progress && (
            <p className="text-dim tabular-nums">
              {Math.round((progress.written / Math.max(1, progress.total)) * 100)}% ({progress.written}/
              {progress.total} bytes)
            </p>
          )}
          {log.map((line, i) => (
            <p key={i} className="font-mono text-dim">
              {line}
            </p>
          ))}
          {error && <p className="text-crit">{error}</p>}
        </div>
      )}
    </div>
  );
}

function FirmwareRow({ build, registeredDeviceIds }: { build: FirmwareBuild; registeredDeviceIds: Set<string> }): JSX.Element {
  const queryClient = useQueryClient();
  const isRegistered = registeredDeviceIds.has(build.deviceId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const otaMutation = useMutation({
    mutationFn: () => triggerOta(build.deviceId, build.id),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteFirmwareBuild(build.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["firmware"] }),
  });

  return (
    <li className="space-y-2 rounded-xl border border-line bg-card px-3 py-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-fg">
            {build.deviceId} <span className="text-dim">· v{build.version}</span>
          </p>
          <p className="text-xs text-dim">
            {build.board} · {Math.round(build.sizeBytes / 1024)} KB · {new Date(build.uploadedAt * 1000).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => otaMutation.mutate()}
            disabled={!isRegistered || otaMutation.isPending}
            title={isRegistered ? undefined : `Device "${build.deviceId}" isn't registered in BrewHub yet`}
            className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg disabled:opacity-50"
          >
            {otaMutation.isPending ? "Pushing..." : "Push OTA"}
          </button>
          {confirmingDelete ? (
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="rounded-xl bg-crit/10 px-2.5 py-1 text-xs text-crit hover:bg-crit/20"
            >
              {deleteMutation.isPending ? "Removing..." : "Confirm delete"}
            </button>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              onBlur={() => setConfirmingDelete(false)}
              className="rounded-xl px-2.5 py-1 text-xs text-dim hover:bg-tint hover:text-crit"
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {otaMutation.isSuccess && <p className="text-xs text-ok">OTA push sent.</p>}
      {otaMutation.isError && (
        <p className="text-xs text-crit">
          {otaMutation.error instanceof Error ? otaMutation.error.message : "OTA push failed"}
        </p>
      )}
      <FlashButton build={build} />
    </li>
  );
}

export function FirmwareManager(): JSX.Element {
  const [deviceId, setDeviceId] = useState("");
  const [board, setBoard] = useState<FirmwareBoard>("fermenter-brewpi");
  const [version, setVersion] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const queryClient = useQueryClient();

  const buildsQuery = useQuery({ queryKey: ["firmware"], queryFn: () => listFirmwareBuilds() });
  const devicesQuery = useQuery({ queryKey: ["devices"], queryFn: listDevices });
  const registeredDeviceIds = new Set((devicesQuery.data ?? []).map((d) => d.id));

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("No file selected");
      return uploadFirmwareBuild({ deviceId, board, version }, file);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["firmware"] });
      setDeviceId("");
      setVersion("");
      setFile(null);
    },
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    uploadMutation.mutate();
  }

  return (
    <div className="space-y-6">
      {!isWebSerialSupported() && (
        <p className="rounded-xl border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-amber">
          WebSerial isn't available in this browser — flashing needs Chrome or Edge. OTA pushes to already-paired
          devices still work here regardless.
        </p>
      )}

      <form onSubmit={handleSubmit} className="card space-y-3 p-5">
        <h3 className="font-display text-base font-semibold text-fg">Upload a build</h3>
        <p className="text-xs text-dim">
          Build locally with <code>pio run -e &lt;env&gt;</code> first — the compiled <code>.bin</code> is
          per-device (WiFi/MQTT credentials and device id are baked in at compile time), not a generic image.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className={labelClass}>Device ID</label>
            <input
              className={inputClass}
              placeholder="fermenter-01"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Board</label>
            <select className={inputClass} value={board} onChange={(e) => setBoard(e.target.value as FirmwareBoard)}>
              {BOARD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className={labelClass}>Version</label>
            <input
              className={inputClass}
              placeholder="0.2.0"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Binary (.bin)</label>
            <input
              type="file"
              accept=".bin"
              className={inputClass}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>
        </div>
        {uploadMutation.isError && (
          <p className="text-xs text-crit">
            {uploadMutation.error instanceof Error ? uploadMutation.error.message : "Upload failed"}
          </p>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={uploadMutation.isPending}
            className="btn-primary px-3 py-1.5 text-xs"
          >
            {uploadMutation.isPending ? "Uploading..." : "Upload"}
          </button>
        </div>
      </form>

      {buildsQuery.isLoading && <p className="text-sm text-dim">Loading builds...</p>}
      {buildsQuery.data && buildsQuery.data.length === 0 && (
        <p className="text-sm text-dim">No firmware builds uploaded yet.</p>
      )}
      {buildsQuery.data && buildsQuery.data.length > 0 && (
        <ul className="space-y-2">
          {buildsQuery.data.map((build) => (
            <FirmwareRow key={build.id} build={build} registeredDeviceIds={registeredDeviceIds} />
          ))}
        </ul>
      )}
    </div>
  );
}
