import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Device } from "@brewhub/shared-types";
import { deleteDevice } from "../api/devices";
import { DeviceConfigForm } from "./DeviceConfigForm";
import { ProfileManager } from "./ProfileManager";

export function DeviceCard({ device }: { device: Device }): JSX.Element {
  const [configOpen, setConfigOpen] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () => deleteDevice(device.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["devices"] }),
  });

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${device.isOnline ? "bg-emerald-400" : "bg-neutral-600"}`}
              title={device.isOnline ? "Online" : "Offline"}
            />
            <span className="font-medium text-neutral-100">{device.name}</span>
          </div>
          <p className="mt-0.5 text-xs text-neutral-500">
            {device.type} · {device.id}
            {device.chamberName && <> · {device.chamberName}</>}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setConfigOpen((v) => !v)}
            className="rounded-lg px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          >
            Configure
          </button>
          {device.type === "fermenter" && (
            <button
              onClick={() => setProfilesOpen((v) => !v)}
              className="rounded-lg px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
            >
              Profiles
            </button>
          )}
          {confirmingDelete ? (
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="rounded-lg bg-red-500/10 px-2.5 py-1 text-xs text-red-400 hover:bg-red-500/20"
            >
              Confirm delete
            </button>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              onBlur={() => setConfirmingDelete(false)}
              className="rounded-lg px-2.5 py-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {configOpen && <DeviceConfigForm device={device} onClose={() => setConfigOpen(false)} />}
      {profilesOpen && <ProfileManager device={device} onClose={() => setProfilesOpen(false)} />}
    </div>
  );
}
