import { useState, type FormEvent } from "react";
import { AlertTriangle, Plus, X } from "lucide-react";
import type { GravityProfileStep, TimeProfileStep } from "@brewhub/shared-types";
import type { StepDraft } from "../lib/profile-steps";
import { ProfileCurve } from "./ProfileCurve";

export const EMPTY_TIME_STEPS: TimeProfileStep[] = [
  { atMinutes: 0, targetC: 20 },
  { atMinutes: 1440, targetC: 20 },
];
export const EMPTY_GRAVITY_STEPS: GravityProfileStep[] = [
  { atGravitySg: 1.05, targetC: 20 },
  { atGravitySg: 1.01, targetC: 20 },
];

/** atMinutes stays the storage/wire format — days/hours/minutes is just a friendlier input for it. */
function splitMinutes(totalMinutes: number): { days: number; hours: number; minutes: number } {
  const clamped = Math.max(0, Math.floor(totalMinutes));
  return { days: Math.floor(clamped / 1440), hours: Math.floor((clamped % 1440) / 60), minutes: clamped % 60 };
}
function combineMinutes(days: number, hours: number, minutes: number): number {
  return Math.max(0, days) * 1440 + Math.max(0, hours) * 60 + Math.max(0, minutes);
}

/**
 * One editor for every place steps are written: new profile, edit, duplicate
 * and templates. Gravity steps can be switched off where no hydrometer exists.
 */
export function StepEditor({
  title,
  initialName = "",
  initialDraft,
  allowGravity,
  gravityHint = "Assign a hydrometer to this device first (see the Hydrometer tab)",
  submitLabel,
  pendingLabel = "Saving…",
  pending,
  error,
  warn,
  onSubmit,
  onCancel,
}: {
  title: string;
  initialName?: string;
  initialDraft?: StepDraft;
  allowGravity: boolean;
  gravityHint?: string;
  submitLabel: string;
  pendingLabel?: string;
  pending: boolean;
  error?: string | null;
  warn?: (draft: StepDraft) => string | null;
  onSubmit: (name: string, draft: StepDraft) => void;
  onCancel?: () => void;
}): JSX.Element {
  const [name, setName] = useState(initialName);
  const [triggerType, setTriggerType] = useState<"time" | "gravity">(initialDraft?.triggerType ?? "time");
  const [timeSteps, setTimeSteps] = useState<TimeProfileStep[]>(
    initialDraft?.triggerType === "time" ? initialDraft.steps : EMPTY_TIME_STEPS,
  );
  const [gravitySteps, setGravitySteps] = useState<GravityProfileStep[]>(
    initialDraft?.triggerType === "gravity" ? initialDraft.steps : EMPTY_GRAVITY_STEPS,
  );

  const draft: StepDraft =
    triggerType === "time" ? { triggerType: "time", steps: timeSteps } : { triggerType: "gravity", steps: gravitySteps };
  const warning = warn?.(draft) ?? null;

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
        { atGravitySg: Math.max(Number(((last?.atGravitySg ?? 1.05) - 0.01).toFixed(3)), 1.0), targetC: last?.targetC ?? 20 },
      ]);
    }
  }
  function removeStep(index: number): void {
    if (triggerType === "time") setTimeSteps((prev) => prev.filter((_, i) => i !== index));
    else setGravitySteps((prev) => prev.filter((_, i) => i !== index));
  }
  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    onSubmit(name.trim(), draft);
  }

  const stepCount = triggerType === "time" ? timeSteps.length : gravitySteps.length;

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-line bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">{title}</p>
        {onCancel && (
          <button type="button" onClick={onCancel} className="icon-btn -mr-2" aria-label="Cancel editing">
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <label className="block">
        <span className="text-xs font-medium text-muted">Name</span>
        <input
          className="field mt-1 px-3 py-2 text-sm"
          placeholder="Ale — ferment cool, then D-rest"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>

      <div className="inline-flex gap-1 rounded-full bg-tint/70 p-1 text-xs" role="group" aria-label="Step trigger">
        <button
          type="button"
          aria-pressed={triggerType === "time"}
          onClick={() => setTriggerType("time")}
          className={`rounded-full px-3 py-1.5 font-medium ${triggerType === "time" ? "bg-card text-fg shadow-card ring-1 ring-line" : "text-muted"}`}
        >
          Time-based
        </button>
        <button
          type="button"
          aria-pressed={triggerType === "gravity"}
          onClick={() => allowGravity && setTriggerType("gravity")}
          disabled={!allowGravity}
          title={allowGravity ? undefined : gravityHint}
          className={`rounded-full px-3 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-40 ${triggerType === "gravity" ? "bg-card text-fg shadow-card ring-1 ring-line" : "text-muted"}`}
        >
          Gravity-based
        </button>
      </div>

      {triggerType === "time" && timeSteps.length > 0 && (
        <ProfileCurve steps={timeSteps} className="h-20" />
      )}

      <ol className="space-y-2">
        {triggerType === "time"
          ? timeSteps.map((step, i) => {
              const { days, hours, minutes } = splitMinutes(step.atMinutes);
              const setPart = (patch: Partial<{ days: number; hours: number; minutes: number }>) => {
                const next = { days, hours, minutes, ...patch };
                updateTimeStep(i, { atMinutes: combineMinutes(next.days, next.hours, next.minutes) });
              };
              return (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2">
                  <span className="w-12 text-xs font-medium text-dim">Step {i + 1}</span>
                  <span className="flex items-center gap-1">
                    <span className="text-xs text-muted">after</span>
                    <input type="number" min={0} aria-label={`Step ${i + 1} days`} className="field w-14 px-2 py-1 text-xs" value={days} onChange={(e) => setPart({ days: Math.max(0, Number(e.target.value)) })} />
                    <span className="text-xs text-muted">d</span>
                    <input type="number" min={0} max={23} aria-label={`Step ${i + 1} hours`} className="field w-12 px-2 py-1 text-xs" value={hours} onChange={(e) => setPart({ hours: Math.max(0, Number(e.target.value)) })} />
                    <span className="text-xs text-muted">h</span>
                    <input type="number" min={0} max={59} aria-label={`Step ${i + 1} minutes`} className="field w-12 px-2 py-1 text-xs" value={minutes} onChange={(e) => setPart({ minutes: Math.max(0, Number(e.target.value)) })} />
                    <span className="text-xs text-muted">min</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="text-xs text-muted">→</span>
                    <input type="number" step="0.1" aria-label={`Step ${i + 1} target °C`} className="field w-20 px-2 py-1 text-xs" value={step.targetC} onChange={(e) => updateTimeStep(i, { targetC: Number(e.target.value) })} />
                    <span className="text-xs text-muted">°C</span>
                  </span>
                  {stepCount > 1 && (
                    <button type="button" onClick={() => removeStep(i)} className="ml-auto text-xs text-dim hover:text-crit">
                      Remove
                    </button>
                  )}
                </li>
              );
            })
          : gravitySteps.map((step, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2">
                <span className="w-12 text-xs font-medium text-dim">Step {i + 1}</span>
                <span className="text-xs text-muted">at</span>
                <input type="number" step="0.001" aria-label={`Step ${i + 1} gravity`} className="field w-24 px-2 py-1 text-xs" value={step.atGravitySg} onChange={(e) => updateGravityStep(i, { atGravitySg: Number(e.target.value) })} />
                <span className="text-xs text-muted">SG →</span>
                <input type="number" step="0.1" aria-label={`Step ${i + 1} target °C`} className="field w-20 px-2 py-1 text-xs" value={step.targetC} onChange={(e) => updateGravityStep(i, { targetC: Number(e.target.value) })} />
                <span className="text-xs text-muted">°C</span>
                {stepCount > 1 && (
                  <button type="button" onClick={() => removeStep(i)} className="ml-auto text-xs text-dim hover:text-crit">
                    Remove
                  </button>
                )}
              </li>
            ))}
      </ol>

      <button type="button" onClick={addStep} className="chip">
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        Add step
      </button>

      {warning && (
        <p className="flex gap-2 rounded-xl border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber" role="alert">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {warning}
        </p>
      )}
      {error && <p className="text-xs text-crit">{error}</p>}

      <div className="flex justify-end gap-2 border-t border-line pt-3">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-ghost px-3 py-1.5 text-xs">
            Cancel
          </button>
        )}
        <button type="submit" disabled={pending || !name.trim()} className="btn-primary px-4 py-1.5 text-xs">
          {pending ? pendingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
