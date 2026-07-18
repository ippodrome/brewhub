import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Device } from "@brewhub/shared-types";
import { deleteDevice, updateDeviceConfig } from "../api/devices";
import { useLiveTelemetry } from "../ws/useLiveTelemetry";
import { DeviceConfigForm } from "./DeviceConfigForm";
import { DeviceHistoryPanel } from "./DeviceHistoryPanel";
import { HydrometerManager } from "./HydrometerManager";
import { ProfileManager } from "./ProfileManager";
import { SensorLabelEditor } from "./SensorLabelEditor";
import { TapManager } from "./TapManager";

function KegScaleReadout({ device }: { device: Device }): JSX.Element {
  const { telemetryByDevice } = useLiveTelemetry();
  const grams = telemetryByDevice[device.id]?.weights?.[0]?.grams;

  const tareMutation = useMutation({
    mutationFn: () => updateDeviceConfig(device.id, { tareRequestId: Date.now() }),
  });

  return (
    <div className="mt-2 flex items-center justify-between border-t border-neutral-200 dark:border-neutral-800 pt-2">
      <p className="text-xs text-neutral-600 dark:text-neutral-500">
        {grams === undefined ? "No reading yet" : grams === null ? "Sensor fault" : `${Math.round(grams)} g`}
      </p>
      <button
        onClick={() => tareMutation.mutate()}
        disabled={tareMutation.isPending}
        className="rounded-lg px-2.5 py-1 text-xs text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200 disabled:opacity-50"
        title="Zero the scale at its current load — only do this with the platform in its true reference state (see firmware README)"
      >
        {tareMutation.isPending ? "Taring..." : "Tare"}
      </button>
    </div>
  );
}

export function DeviceCard({ device }: { device: Device }): JSX.Element {
  const [configOpen, setConfigOpen] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [sensorsOpen, setSensorsOpen] = useState(false);
  const [tapsOpen, setTapsOpen] = useState(false);
  const [hydrometerOpen, setHydrometerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () => deleteDevice(device.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["devices"] }),
  });

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${device.isOnline ? "bg-emerald-400" : "bg-neutral-400 dark:bg-neutral-600"}`}
              title={device.isOnline ? "Online" : "Offline"}
            />
            <span className="font-medium text-neutral-900 dark:text-neutral-100">{device.name}</span>
          </div>
          <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-500">
            {device.type} · {device.id}
            {device.chamberName && <> · {device.chamberName}</>}
          </p>
        </div>
        <div className="flex gap-2">
          {device.type !== "keg_scale" && device.type !== "gravity_bridge" && (
            <button
              onClick={() => setConfigOpen((v) => !v)}
              className="rounded-lg px-2.5 py-1 text-xs text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              Configure
            </button>
          )}
          {device.type !== "keg_scale" && device.type !== "gravity_bridge" && (
            <button
              onClick={() => setSensorsOpen((v) => !v)}
              className="rounded-lg px-2.5 py-1 text-xs text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              Sensors
            </button>
          )}
          {device.type === "fermenter" && (
            <button
              onClick={() => setProfilesOpen((v) => !v)}
              className="rounded-lg px-2.5 py-1 text-xs text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              Profiles
            </button>
          )}
          {device.type === "kegerator" && (
            <button
              onClick={() => setTapsOpen((v) => !v)}
              className="rounded-lg px-2.5 py-1 text-xs text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              Taps
            </button>
          )}
          {device.type === "fermenter" && (
            <button
              onClick={() => setHydrometerOpen((v) => !v)}
              className="rounded-lg px-2.5 py-1 text-xs text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              Hydrometer
            </button>
          )}
          {device.type !== "sensor" && device.type !== "gravity_bridge" && (
            <button
              onClick={() => setHistoryOpen((v) => !v)}
              className="rounded-lg px-2.5 py-1 text-xs text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              History
            </button>
          )}
          {confirmingDelete ? (
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="rounded-lg bg-red-500/10 px-2.5 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/20"
            >
              Confirm delete
            </button>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              onBlur={() => setConfirmingDelete(false)}
              className="rounded-lg px-2.5 py-1 text-xs text-neutral-600 dark:text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {device.type === "keg_scale" && <KegScaleReadout device={device} />}

      {configOpen && <DeviceConfigForm device={device} onClose={() => setConfigOpen(false)} />}
      {sensorsOpen && <SensorLabelEditor device={device} onClose={() => setSensorsOpen(false)} />}
      {profilesOpen && <ProfileManager device={device} onClose={() => setProfilesOpen(false)} />}
      {tapsOpen && <TapManager device={device} onClose={() => setTapsOpen(false)} />}
      {hydrometerOpen && <HydrometerManager device={device} onClose={() => setHydrometerOpen(false)} />}
      {historyOpen && <DeviceHistoryPanel device={device} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
