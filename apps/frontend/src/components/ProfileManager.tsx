import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Device, GravityProfileStep, TimeProfileStep } from "@brewhub/shared-types";
import { createProfile, deleteProfile, listProfiles } from "../api/profiles";
import { listHydrometers } from "../api/hydrometers";
import { updateDeviceConfig } from "../api/devices";

const EMPTY_TIME_STEPS: TimeProfileStep[] = [
  { atMinutes: 0, targetC: 20 },
  { atMinutes: 1440, targetC: 20 },
];

/** atMinutes is still the storage/wire format (shared-types, backend interpolation) — this is purely a friendlier input for it. */
function splitMinutes(totalMinutes: number): { days: number; hours: number; minutes: number } {
  const clamped = Math.max(0, Math.floor(totalMinutes));
  const days = Math.floor(clamped / 1440);
  const hours = Math.floor((clamped % 1440) / 60);
  const minutes = clamped % 60;
  return { days, hours, minutes };
}
function combineMinutes(days: number, hours: number, minutes: number): number {
  return Math.max(0, days) * 1440 + Math.max(0, hours) * 60 + Math.max(0, minutes);
}
const EMPTY_GRAVITY_STEPS: GravityProfileStep[] = [
  { atGravitySg: 1.05, targetC: 20 },
  { atGravitySg: 1.01, targetC: 20 },
];

export function ProfileManager({ device, onClose }: { device: Device; onClose: () => void }): JSX.Element {
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<"time" | "gravity">("time");
  const [timeSteps, setTimeSteps] = useState<TimeProfileStep[]>(EMPTY_TIME_STEPS);
  const [gravitySteps, setGravitySteps] = useState<GravityProfileStep[]>(EMPTY_GRAVITY_STEPS);
  const queryClient = useQueryClient();

  const profilesQuery = useQuery({
    queryKey: ["profiles", device.id],
    queryFn: () => listProfiles(device.id),
  });

  const hydrometersQuery = useQuery({ queryKey: ["hydrometers"], queryFn: listHydrometers });
  const hasHydrometer = (hydrometersQuery.data ?? []).some((h) => h.fermenterDeviceId === device.id);

  const createMutation = useMutation({
    mutationFn: () =>
      triggerType === "time"
        ? createProfile(device.id, { name, triggerType: "time", steps: timeSteps })
        : createProfile(device.id, { name, triggerType: "gravity", steps: gravitySteps }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles", device.id] });
      setName("");
      setTimeSteps(EMPTY_TIME_STEPS);
      setGravitySteps(EMPTY_GRAVITY_STEPS);
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

  function updateTimeStep(index: number, patch: Partial<TimeProfileStep>): void {
    setTimeSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }
  function updateGravityStep(index: number, patch: Partial<GravityProfileStep>): void {
    setGravitySteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function addStep(): void {
    if (triggerType === "time") {
      const last = timeSteps[timeSteps.length - 1];
      setTimeSteps((prev) => [...prev, { atMinutes: (last?.atMinutes ?? 0) + 1440, targetC: last?.targetC ?? 20 }]);
    } else {
      const last = gravitySteps[gravitySteps.length - 1];
      setGravitySteps((prev) => [
        ...prev,
        { atGravitySg: Math.max((last?.atGravitySg ?? 1.05) - 0.01, 1.0), targetC: last?.targetC ?? 20 },
      ]);
    }
  }

  function removeStep(index: number): void {
    if (triggerType === "time") {
      setTimeSteps((prev) => prev.filter((_, i) => i !== index));
    } else {
      setGravitySteps((prev) => prev.filter((_, i) => i !== index));
    }
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <div className="mt-3 space-y-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Profiles</h3>
        <button onClick={onClose} className="text-xs text-neutral-600 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-300">
          Close
        </button>
      </div>

      {profilesQuery.isLoading && <p className="text-xs text-neutral-600 dark:text-neutral-500">Loading profiles...</p>}
      {profilesQuery.data && profilesQuery.data.length === 0 && (
        <p className="text-xs text-neutral-600 dark:text-neutral-500">No profiles yet.</p>
      )}
      {profilesQuery.data && profilesQuery.data.length > 0 && (
        <ul className="space-y-2">
          {profilesQuery.data.map((profile) => (
            <li
              key={profile.id}
              className="flex items-center justify-between rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2"
            >
              <div>
                <p className="text-sm text-neutral-800 dark:text-neutral-200">{profile.name}</p>
                <p className="text-xs text-neutral-600 dark:text-neutral-500">
                  {profile.triggerType === "gravity" ? "Gravity-based" : "Time-based"} · {profile.steps.length} steps
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => activateMutation.mutate(profile.id)}
                  disabled={activateMutation.isPending}
                  className="rounded-xl px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                >
                  Activate
                </button>
                <button
                  onClick={() => deleteMutation.mutate(profile.id)}
                  disabled={deleteMutation.isPending}
                  className="rounded-xl px-2.5 py-1 text-xs text-neutral-600 dark:text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-red-600 dark:hover:text-red-400"
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
        className="text-xs text-neutral-600 dark:text-neutral-500 underline underline-offset-2 hover:text-neutral-600 dark:hover:text-neutral-300"
      >
        Stop following a profile
      </button>

      <form onSubmit={handleSubmit} className="space-y-2 border-t border-neutral-200 dark:border-neutral-800 pt-3">
        <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">New profile</p>
        <input
          className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
          placeholder="Ale ferment"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setTriggerType("time")}
            className={`rounded-xl px-2.5 py-1 ${triggerType === "time" ? "bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100" : "text-neutral-500 dark:text-neutral-400"}`}
          >
            Time-based
          </button>
          <button
            type="button"
            onClick={() => hasHydrometer && setTriggerType("gravity")}
            disabled={!hasHydrometer}
            title={hasHydrometer ? undefined : "Assign a hydrometer to this device first (see the Hydrometer tab)"}
            className={`rounded-xl px-2.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed ${triggerType === "gravity" ? "bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100" : "text-neutral-500 dark:text-neutral-400"}`}
          >
            Gravity-based
          </button>
        </div>

        <div className="space-y-1">
          {triggerType === "time"
            ? timeSteps.map((step, i) => {
                const { days, hours, minutes } = splitMinutes(step.atMinutes);
                const setPart = (patch: Partial<{ days: number; hours: number; minutes: number }>) => {
                  const next = { days, hours, minutes, ...patch };
                  updateTimeStep(i, { atMinutes: combineMinutes(next.days, next.hours, next.minutes) });
                };
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        className="w-14 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                        value={days}
                        onChange={(e) => setPart({ days: Math.max(0, Number(e.target.value)) })}
                        title="Days from profile start"
                      />
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">d</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={23}
                        className="w-12 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                        value={hours}
                        onChange={(e) => setPart({ hours: Math.max(0, Number(e.target.value)) })}
                        title="Hours"
                      />
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">h</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={59}
                        className="w-12 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                        value={minutes}
                        onChange={(e) => setPart({ minutes: Math.max(0, Number(e.target.value)) })}
                        title="Minutes"
                      />
                      <span className="text-xs text-neutral-500 dark:text-neutral-400">min →</span>
                    </div>
                    <input
                      type="number"
                      step="0.1"
                      className="w-20 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                      value={step.targetC}
                      onChange={(e) => updateTimeStep(i, { targetC: Number(e.target.value) })}
                    />
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">°C</span>
                    {timeSteps.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeStep(i)}
                        className="ml-auto text-xs text-neutral-500 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                );
              })
            : gravitySteps.map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.001"
                    className="w-24 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                    value={step.atGravitySg}
                    onChange={(e) => updateGravityStep(i, { atGravitySg: Number(e.target.value) })}
                    title="Specific gravity threshold"
                  />
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">SG →</span>
                  <input
                    type="number"
                    step="0.1"
                    className="w-20 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                    value={step.targetC}
                    onChange={(e) => updateGravityStep(i, { targetC: Number(e.target.value) })}
                  />
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">°C</span>
                  {gravitySteps.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeStep(i)}
                      className="ml-auto text-xs text-neutral-500 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
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
          className="text-xs text-neutral-600 dark:text-neutral-500 underline underline-offset-2 hover:text-neutral-600 dark:hover:text-neutral-300"
        >
          Add step
        </button>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-xl bg-amber-500 hover:bg-amber-400 dark:bg-amber-500 dark:hover:bg-amber-400 px-3 py-1.5 text-xs font-medium text-zinc-950 disabled:opacity-50"
          >
            {createMutation.isPending ? "Creating..." : "Create profile"}
          </button>
        </div>
      </form>
    </div>
  );
}
