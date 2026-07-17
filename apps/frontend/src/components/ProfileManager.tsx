import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Device, ProfileStep } from "@brewhub/shared-types";
import { createProfile, deleteProfile, listProfiles } from "../api/profiles";
import { updateDeviceConfig } from "../api/devices";

const EMPTY_STEP: ProfileStep = { atMinutes: 0, targetC: 20 };

export function ProfileManager({ device, onClose }: { device: Device; onClose: () => void }): JSX.Element {
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<ProfileStep[]>([EMPTY_STEP, { atMinutes: 1440, targetC: 20 }]);
  const queryClient = useQueryClient();

  const profilesQuery = useQuery({
    queryKey: ["profiles", device.id],
    queryFn: () => listProfiles(device.id),
  });

  const createMutation = useMutation({
    mutationFn: () => createProfile(device.id, { name, steps }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles", device.id] });
      setName("");
      setSteps([EMPTY_STEP, { atMinutes: 1440, targetC: 20 }]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (profileId: number) => deleteProfile(device.id, profileId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profiles", device.id] }),
  });

  const activateMutation = useMutation({
    mutationFn: (activeProfileId: number | null) =>
      updateDeviceConfig(device.id, { activeProfileId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["devices"] }),
  });

  function updateStep(index: number, patch: Partial<ProfileStep>): void {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function addStep(): void {
    const last = steps[steps.length - 1];
    setSteps((prev) => [...prev, { atMinutes: (last?.atMinutes ?? 0) + 1440, targetC: last?.targetC ?? 20 }]);
  }

  function removeStep(index: number): void {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <div className="mt-3 space-y-4 rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-200">Profiles</h3>
        <button onClick={onClose} className="text-xs text-neutral-500 hover:text-neutral-300">
          Close
        </button>
      </div>

      {profilesQuery.isLoading && <p className="text-xs text-neutral-500">Loading profiles...</p>}
      {profilesQuery.data && profilesQuery.data.length === 0 && (
        <p className="text-xs text-neutral-500">No profiles yet.</p>
      )}
      {profilesQuery.data && profilesQuery.data.length > 0 && (
        <ul className="space-y-2">
          {profilesQuery.data.map((profile) => (
            <li
              key={profile.id}
              className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2"
            >
              <div>
                <p className="text-sm text-neutral-200">{profile.name}</p>
                <p className="text-xs text-neutral-500">{profile.steps.length} steps</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => activateMutation.mutate(profile.id)}
                  disabled={activateMutation.isPending}
                  className="rounded-lg px-2.5 py-1 text-xs text-emerald-400 hover:bg-emerald-500/10"
                >
                  Activate
                </button>
                <button
                  onClick={() => deleteMutation.mutate(profile.id)}
                  disabled={deleteMutation.isPending}
                  className="rounded-lg px-2.5 py-1 text-xs text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={() => activateMutation.mutate(null)}
        disabled={activateMutation.isPending}
        className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-300"
      >
        Stop following a profile
      </button>

      <form onSubmit={handleSubmit} className="space-y-2 border-t border-neutral-800 pt-3">
        <p className="text-xs font-medium text-neutral-300">New profile</p>
        <input
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-500"
          placeholder="Ale ferment"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <div className="space-y-1">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="number"
                className="w-24 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-neutral-500"
                value={step.atMinutes}
                onChange={(e) => updateStep(i, { atMinutes: Number(e.target.value) })}
                title="Minutes from profile start"
              />
              <span className="text-xs text-neutral-600">min →</span>
              <input
                type="number"
                step="0.1"
                className="w-20 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-neutral-500"
                value={step.targetC}
                onChange={(e) => updateStep(i, { targetC: Number(e.target.value) })}
              />
              <span className="text-xs text-neutral-600">°C</span>
              {steps.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeStep(i)}
                  className="ml-auto text-xs text-neutral-600 hover:text-red-400"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addStep}
          className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-300"
        >
          Add step
        </button>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900 disabled:opacity-50"
          >
            {createMutation.isPending ? "Creating..." : "Create profile"}
          </button>
        </div>
      </form>
    </div>
  );
}
