import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Device,
  GravityProfileStep,
  ImportProfilesResult,
  TimeProfileStep,
} from "@brewhub/shared-types";
import {
  createProfile,
  deleteProfile,
  downloadProfileExport,
  importProfiles,
  listProfiles,
} from "../api/profiles";
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
  const [importResult, setImportResult] = useState<ImportProfilesResult | null>(null);
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

  // undefined = every profile on the device; a number = just that one.
  const exportMutation = useMutation({
    mutationFn: (profileId: number | undefined) => downloadProfileExport(device.id, profileId),
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => importProfiles(device.id, file),
    onSuccess: (result) => {
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["profiles", device.id] });
    },
    onError: () => setImportResult(null),
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
    <div className="mt-3 space-y-4 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-fg">Profiles</h3>
        <button onClick={onClose} className="text-xs text-dim hover:text-fg">
          Close
        </button>
      </div>

      {profilesQuery.isLoading && <p className="text-xs text-dim">Loading profiles...</p>}
      {profilesQuery.data && profilesQuery.data.length === 0 && (
        <p className="text-xs text-dim">No profiles yet.</p>
      )}
      {profilesQuery.data && profilesQuery.data.length > 0 && (
        <ul className="space-y-2">
          {profilesQuery.data.map((profile) => (
            <li
              key={profile.id}
              className="flex items-center justify-between rounded-xl border border-line bg-card px-3 py-2"
            >
              <div>
                <p className="text-sm text-fg">{profile.name}</p>
                <p className="text-xs text-dim">
                  {profile.triggerType === "gravity" ? "Gravity-based" : "Time-based"} · {profile.steps.length} steps
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => activateMutation.mutate(profile.id)}
                  disabled={activateMutation.isPending}
                  className="rounded-xl px-2.5 py-1 text-xs text-ok hover:bg-ok/10"
                >
                  Activate
                </button>
                <button
                  onClick={() => exportMutation.mutate(profile.id)}
                  disabled={exportMutation.isPending}
                  title="Download this profile as a file you can import on another device"
                  className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg"
                >
                  Export
                </button>
                <button
                  onClick={() => deleteMutation.mutate(profile.id)}
                  disabled={deleteMutation.isPending}
                  className="rounded-xl px-2.5 py-1 text-xs text-dim hover:bg-tint hover:text-crit"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <button
          onClick={() => exportMutation.mutate(undefined)}
          disabled={exportMutation.isPending || !profilesQuery.data?.length}
          className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg disabled:opacity-40"
        >
          Export all
        </button>
        <label className="cursor-pointer rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg">
          {importMutation.isPending ? "Importing..." : "Import"}
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset so re-picking the same file fires change again.
              e.target.value = "";
              if (file) importMutation.mutate(file);
            }}
          />
        </label>
        <p className="text-xs text-dim">
          Profiles are portable — export one to reuse it on another chamber, or share it.
        </p>
      </div>

      {importResult && (
        <div className="rounded-xl border border-ok/30 bg-ok/10 px-3 py-2 text-xs text-ok">
          <p>
            Imported {importResult.imported.length}{" "}
            {importResult.imported.length === 1 ? "profile" : "profiles"}.
          </p>
          {importResult.imported.some((p) => p.renamedFrom) && (
            <p className="mt-0.5 opacity-80">
              Renamed to avoid clashing with what's already here:{" "}
              {importResult.imported
                .filter((p) => p.renamedFrom)
                .map((p) => `${p.renamedFrom} → ${p.name}`)
                .join(", ")}
              .
            </p>
          )}
        </div>
      )}
      {importMutation.isError && (
        <p className="text-xs text-crit">
          {importMutation.error instanceof Error && importMutation.error.message.includes("JSON")
            ? "That file isn't valid JSON."
            : "Could not import that file — it doesn't look like a BrewHub profile export."}
        </p>
      )}
      {exportMutation.isError && (
        <p className="text-xs text-crit">Could not export.</p>
      )}

      <button
        onClick={() => activateMutation.mutate(null)}
        disabled={activateMutation.isPending}
        className="text-xs text-dim underline underline-offset-2 hover:text-fg"
      >
        Stop following a profile
      </button>

      <form onSubmit={handleSubmit} className="space-y-2 border-t border-line pt-3">
        <p className="text-xs font-medium text-muted">New profile</p>
        <input
          className="field px-2.5 py-1.5 text-sm"
          placeholder="Ale ferment"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setTriggerType("time")}
            className={`rounded-xl px-2.5 py-1 ${triggerType === "time" ? "bg-tint text-fg" : "text-muted"}`}
          >
            Time-based
          </button>
          <button
            type="button"
            onClick={() => hasHydrometer && setTriggerType("gravity")}
            disabled={!hasHydrometer}
            title={hasHydrometer ? undefined : "Assign a hydrometer to this device first (see the Hydrometer tab)"}
            className={`rounded-xl px-2.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed ${triggerType === "gravity" ? "bg-tint text-fg" : "text-muted"}`}
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
                        className="field w-14 px-2 py-1 text-xs"
                        value={days}
                        onChange={(e) => setPart({ days: Math.max(0, Number(e.target.value)) })}
                        title="Days from profile start"
                      />
                      <span className="text-xs text-muted">d</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={23}
                        className="field w-12 px-2 py-1 text-xs"
                        value={hours}
                        onChange={(e) => setPart({ hours: Math.max(0, Number(e.target.value)) })}
                        title="Hours"
                      />
                      <span className="text-xs text-muted">h</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={59}
                        className="field w-12 px-2 py-1 text-xs"
                        value={minutes}
                        onChange={(e) => setPart({ minutes: Math.max(0, Number(e.target.value)) })}
                        title="Minutes"
                      />
                      <span className="text-xs text-muted">min →</span>
                    </div>
                    <input
                      type="number"
                      step="0.1"
                      className="field w-20 px-2 py-1 text-xs"
                      value={step.targetC}
                      onChange={(e) => updateTimeStep(i, { targetC: Number(e.target.value) })}
                    />
                    <span className="text-xs text-muted">°C</span>
                    {timeSteps.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeStep(i)}
                        className="ml-auto text-xs text-muted hover:text-crit"
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
                    className="field w-24 px-2 py-1 text-xs"
                    value={step.atGravitySg}
                    onChange={(e) => updateGravityStep(i, { atGravitySg: Number(e.target.value) })}
                    title="Specific gravity threshold"
                  />
                  <span className="text-xs text-muted">SG →</span>
                  <input
                    type="number"
                    step="0.1"
                    className="field w-20 px-2 py-1 text-xs"
                    value={step.targetC}
                    onChange={(e) => updateGravityStep(i, { targetC: Number(e.target.value) })}
                  />
                  <span className="text-xs text-muted">°C</span>
                  {gravitySteps.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeStep(i)}
                      className="ml-auto text-xs text-muted hover:text-crit"
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
          className="text-xs text-dim underline underline-offset-2 hover:text-fg"
        >
          Add step
        </button>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="btn-primary px-3 py-1.5 text-xs"
          >
            {createMutation.isPending ? "Creating..." : "Create profile"}
          </button>
        </div>
      </form>
    </div>
  );
}
