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
  "w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500";
const labelClass = "text-xs text-neutral-600 dark:text-neutral-500";

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
        className="rounded-xl px-2.5 py-1 text-xs text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200 disabled:opacity-50"
      >
        {flashing ? "Flashing..." : "Flash via WebSerial"}
      </button>
      {(log.length > 0 || error) && (
        <div className="mt-2 max-w-md space-y-1 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-2 text-xs">
          {progress && (
            <p className="text-neutral-600 dark:text-neutral-500 tabular-nums">
              {Math.round((progress.written / Math.max(1, progress.total)) * 100)}% ({progress.written}/
              {progress.total} bytes)
            </p>
          )}
          {log.map((line, i) => (
            <p key={i} className="font-mono text-neutral-600 dark:text-neutral-500">
              {line}
            </p>
          ))}
          {error && <p className="text-red-600 dark:text-red-400">{error}</p>}
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
    <li className="space-y-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-neutral-800 dark:text-neutral-200">
            {build.deviceId} <span className="text-neutral-600 dark:text-neutral-500">· v{build.version}</span>
          </p>
          <p className="text-xs text-neutral-600 dark:text-neutral-500">
            {build.board} · {Math.round(build.sizeBytes / 1024)} KB · {new Date(build.uploadedAt * 1000).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => otaMutation.mutate()}
            disabled={!isRegistered || otaMutation.isPending}
            title={isRegistered ? undefined : `Device "${build.deviceId}" isn't registered in BrewHub yet`}
            className="rounded-xl px-2.5 py-1 text-xs text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200 disabled:opacity-50"
          >
            {otaMutation.isPending ? "Pushing..." : "Push OTA"}
          </button>
          {confirmingDelete ? (
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="rounded-xl bg-red-500/10 px-2.5 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/20"
            >
              {deleteMutation.isPending ? "Removing..." : "Confirm delete"}
            </button>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              onBlur={() => setConfirmingDelete(false)}
              className="rounded-xl px-2.5 py-1 text-xs text-neutral-600 dark:text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-red-600 dark:hover:text-red-400"
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {otaMutation.isSuccess && <p className="text-xs text-emerald-600 dark:text-emerald-400">OTA push sent.</p>}
      {otaMutation.isError && (
        <p className="text-xs text-red-600 dark:text-red-400">
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
        <p className="rounded-xl border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-600 dark:text-amber-500">
          WebSerial isn't available in this browser — flashing needs Chrome or Edge. OTA pushes to already-paired
          devices still work here regardless.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Upload a build</p>
        <p className="text-xs text-neutral-600 dark:text-neutral-500">
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
          <p className="text-xs text-red-600 dark:text-red-400">
            {uploadMutation.error instanceof Error ? uploadMutation.error.message : "Upload failed"}
          </p>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={uploadMutation.isPending}
            className="rounded-xl bg-amber-500 hover:bg-amber-400 dark:bg-amber-500 dark:hover:bg-amber-400 px-3 py-1.5 text-xs font-medium text-zinc-950 disabled:opacity-50"
          >
            {uploadMutation.isPending ? "Uploading..." : "Upload"}
          </button>
        </div>
      </form>

      {buildsQuery.isLoading && <p className="text-sm text-neutral-600 dark:text-neutral-500">Loading builds...</p>}
      {buildsQuery.data && buildsQuery.data.length === 0 && (
        <p className="text-sm text-neutral-600 dark:text-neutral-500">No firmware builds uploaded yet.</p>
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
