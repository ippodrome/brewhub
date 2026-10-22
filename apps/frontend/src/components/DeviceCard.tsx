import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Maximize2, Trash2 } from "lucide-react";
import type { Device } from "@brewhub/shared-types";
import { deleteDevice, updateDeviceConfig } from "../api/devices";
import { useLiveTelemetry } from "../ws/useLiveTelemetry";
import { DeviceConfigForm } from "./DeviceConfigForm";
import { DeviceHistoryPanel } from "./DeviceHistoryPanel";
import { HydrometerManager } from "./HydrometerManager";
import { ProfileManager } from "./ProfileManager";
import { SensorLabelEditor } from "./SensorLabelEditor";
import { TapManager } from "./TapManager";
import { KegScaleReadout } from "./KegScaleReadout";
import { ConfirmDialog } from "./ConfirmDialog";
import { OverflowMenu, type MenuItem } from "./OverflowMenu";
import { StatusDot } from "./StatusDot";
import { timeAgo } from "../lib/status";


const TYPE_LABEL: Record<string, string> = {
  kegerator: "Kegerator",
  fermenter: "Fermenter",
  sensor: "Sensor",
  keg_scale: "Keg scale",
  gravity_bridge: "Gravity bridge",
};

export function DeviceCard({ device }: { device: Device }): JSX.Element {
  const [configOpen, setConfigOpen] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [sensorsOpen, setSensorsOpen] = useState(false);
  const [tapsOpen, setTapsOpen] = useState(false);
  const [hydrometerOpen, setHydrometerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const deleteMutation = useMutation({
    mutationFn: () => deleteDevice(device.id),
    onSuccess: () => {
      setConfirmingDelete(false);
      return queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
  });

  const controllable = device.type !== "keg_scale" && device.type !== "gravity_bridge";
  const hasDisplay = device.type === "kegerator" || device.type === "fermenter" || device.type === "sensor";

  // Every panel toggle in one ordered list → one consistent chip row.
  const panels: Array<{ label: string; open: boolean; toggle: () => void; show: boolean }> = [
    { label: "Configure", open: configOpen, toggle: () => setConfigOpen((v) => !v), show: controllable },
    { label: "Sensors", open: sensorsOpen, toggle: () => setSensorsOpen((v) => !v), show: controllable },
    { label: "Profiles", open: profilesOpen, toggle: () => setProfilesOpen((v) => !v), show: device.type === "fermenter" },
    { label: "Taps", open: tapsOpen, toggle: () => setTapsOpen((v) => !v), show: device.type === "kegerator" },
    { label: "Hydrometer", open: hydrometerOpen, toggle: () => setHydrometerOpen((v) => !v), show: device.type === "fermenter" },
    {
      label: "History",
      open: historyOpen,
      toggle: () => setHistoryOpen((v) => !v),
      show: device.type !== "sensor" && device.type !== "gravity_bridge",
    },
  ];

  const menuItems: MenuItem[] = [
    ...(hasDisplay
      ? [{ label: "Open display view", icon: Maximize2, onSelect: () => navigate(`/display/${encodeURIComponent(device.id)}`) }]
      : []),
    { label: "Remove device…", icon: Trash2, destructive: true, onSelect: () => setConfirmingDelete(true) },
  ];

  const meta = [TYPE_LABEL[device.type] ?? device.type, device.chamberName, device.id].filter(Boolean).join(" · ");

  return (
    <article className="card p-5 sm:p-6" aria-label={device.name}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="font-display text-xl font-semibold text-fg">{device.name}</h2>
            <span className={`pill ${device.isOnline ? "bg-ok/10 text-ok" : "bg-tint text-dim"}`}>
              <StatusDot tone={device.isOnline ? "ok" : "idle"} />
              {device.isOnline ? "Online" : `Offline · seen ${timeAgo(device.lastSeenAt)}`}
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-dim">{meta}</p>
        </div>
        <OverflowMenu label={`More actions for ${device.name}`} items={menuItems} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {panels
          .filter((p) => p.show)
          .map((p) => (
            <button key={p.label} type="button" aria-pressed={p.open} onClick={p.toggle} className="chip">
              {p.label}
            </button>
          ))}
      </div>

      {device.type === "keg_scale" && <KegScaleReadout device={device} />}

      {configOpen && <DeviceConfigForm device={device} onClose={() => setConfigOpen(false)} />}
      {sensorsOpen && <SensorLabelEditor device={device} onClose={() => setSensorsOpen(false)} />}
      {profilesOpen && <ProfileManager device={device} onClose={() => setProfilesOpen(false)} />}
      {tapsOpen && <TapManager device={device} onClose={() => setTapsOpen(false)} />}
      {hydrometerOpen && <HydrometerManager device={device} onClose={() => setHydrometerOpen(false)} />}
      {historyOpen && <DeviceHistoryPanel device={device} onClose={() => setHistoryOpen(false)} />}

      {confirmingDelete && (
        <ConfirmDialog
          title={`Remove ${device.name}?`}
          confirmLabel="Remove device"
          pendingLabel="Removing…"
          pending={deleteMutation.isPending}
          error={deleteMutation.isError ? "Could not remove the device. Try again." : null}
          onConfirm={() => deleteMutation.mutate()}
          onCancel={() => setConfirmingDelete(false)}
        >
          This deletes <span className="font-medium text-fg">{device.id}</span> together with its configuration,
          sensors, profiles and history. The physical device keeps running on its last settings until it is
          re-added.
        </ConfirmDialog>
      )}
    </article>
  );
}
