import { useState, type FormEvent } from "react";
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
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [calibrationFactor, setCalibrationFactor] = useState("");

  const tareMutation = useMutation({
    mutationFn: () => updateDeviceConfig(device.id, { tareRequestId: Date.now() }),
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

  return (
    <div className="mt-2 space-y-2 border-t border-line pt-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-dim">
          {grams === undefined ? "No reading yet" : grams === null ? "Sensor fault" : `${Math.round(grams)} g`}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setCalibrationOpen((v) => !v)}
            className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg"
            title="Set the HX711 raw-to-grams calibration factor"
          >
            Calibrate
          </button>
          <button
            onClick={() => tareMutation.mutate()}
            disabled={tareMutation.isPending}
            className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg disabled:opacity-50"
            title="Zero the scale at its current load — only do this with the platform in its true reference state (see firmware README)"
          >
            {tareMutation.isPending ? "Taring..." : "Tare"}
          </button>
        </div>
      </div>

      {calibrationOpen && (
        <form
          onSubmit={handleCalibrationSubmit}
          className="space-y-2 rounded-xl border border-line bg-surface p-3"
        >
          <p className="text-xs text-dim">
            Raw-to-grams calibration factor. Determine it by placing a known reference weight on the platform
            and adjusting until the reading above is correct — see the keg-scale firmware README.
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              step="any"
              placeholder="e.g. -22500"
              className="w-full rounded-xl border border-line-strong bg-card px-2 py-1.5 text-sm text-fg outline-none focus:border-line-focus"
              value={calibrationFactor}
              onChange={(e) => setCalibrationFactor(e.target.value)}
              required
            />
            <button
              type="submit"
              disabled={calibrationMutation.isPending}
              className="shrink-0 rounded-xl bg-amber hover:bg-amber-hi px-3 py-1.5 text-xs font-medium text-on-amber disabled:opacity-50"
            >
              {calibrationMutation.isPending ? "Applying..." : "Apply"}
            </button>
          </div>
          {calibrationMutation.isError && (
            <p className="text-xs text-crit">Could not apply calibration factor.</p>
          )}
        </form>
      )}
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
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${device.isOnline ? "bg-ok" : "bg-dim"}`}
              title={device.isOnline ? "Online" : "Offline"}
            />
            <span className="font-medium text-fg">{device.name}</span>
          </div>
          <p className="mt-0.5 text-xs text-dim">
            {device.type} · {device.id}
            {device.chamberName && <> · {device.chamberName}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {device.type !== "keg_scale" && device.type !== "gravity_bridge" && (
            <button
              onClick={() => setConfigOpen((v) => !v)}
              className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg"
            >
              Configure
            </button>
          )}
          {device.type !== "keg_scale" && device.type !== "gravity_bridge" && (
            <button
              onClick={() => setSensorsOpen((v) => !v)}
              className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg"
            >
              Sensors
            </button>
          )}
          {device.type === "fermenter" && (
            <button
              onClick={() => setProfilesOpen((v) => !v)}
              className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg"
            >
              Profiles
            </button>
          )}
          {device.type === "kegerator" && (
            <button
              onClick={() => setTapsOpen((v) => !v)}
              className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg"
            >
              Taps
            </button>
          )}
          {device.type === "fermenter" && (
            <button
              onClick={() => setHydrometerOpen((v) => !v)}
              className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg"
            >
              Hydrometer
            </button>
          )}
          {device.type !== "sensor" && device.type !== "gravity_bridge" && (
            <button
              onClick={() => setHistoryOpen((v) => !v)}
              className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg"
            >
              History
            </button>
          )}
          {confirmingDelete ? (
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="rounded-xl bg-crit/10 px-2.5 py-1 text-xs text-crit hover:bg-crit/20"
            >
              Confirm delete
            </button>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              onBlur={() => setConfirmingDelete(false)}
              className="rounded-xl px-2.5 py-1 text-xs text-dim hover:bg-tint hover:text-fg"
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
