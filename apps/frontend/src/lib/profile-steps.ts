import type { CreateProfileRequest, GravityProfileStep, TimeProfileStep } from "@brewhub/shared-types";

export type StepDraft =
  | { triggerType: "time"; steps: TimeProfileStep[] }
  | { triggerType: "gravity"; steps: GravityProfileStep[] };

/** "3 d 4 h", "45 min" — compact durations for step times and countdowns. */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} d`);
  if (h) parts.push(`${h} h`);
  if (min && !d) parts.push(`${min} min`);
  return parts.length ? parts.join(" ") : "0 min";
}

function sortTime(steps: TimeProfileStep[]): TimeProfileStep[] {
  return [...steps].sort((a, b) => a.atMinutes - b.atMinutes);
}

/**
 * True when an edit to a running time profile changes, adds or removes a step
 * that has already begun (its start time is at or before `elapsedMinutes`).
 * Those changes can't be "replayed" — the brew already went through them —
 * so the editor warns before saving. Gravity profiles use step order instead.
 */
export function editTouchesPassedSteps(
  original: StepDraft,
  draft: StepDraft,
  progress: { elapsedMinutes: number; stepIndex: number },
): boolean {
  if (original.triggerType !== draft.triggerType) return true;
  const key = (s: TimeProfileStep | GravityProfileStep) => JSON.stringify(s);

  if (original.triggerType === "time" && draft.triggerType === "time") {
    const passed = (steps: TimeProfileStep[]) =>
      sortTime(steps)
        .filter((s) => s.atMinutes <= progress.elapsedMinutes)
        .map(key);
    return passed(original.steps).join("|") !== passed(draft.steps).join("|");
  }

  const byGravity = (steps: GravityProfileStep[]) =>
    [...steps].sort((a, b) => b.atGravitySg - a.atGravitySg).slice(0, progress.stepIndex + 1).map(key);
  return (
    byGravity(original.steps as GravityProfileStep[]).join("|") !==
    byGravity(draft.steps as GravityProfileStep[]).join("|")
  );
}

/** Polyline points for a time profile: x in minutes, y in °C, holding the last target to `endMinutes`. */
export function curvePoints(steps: TimeProfileStep[], endMinutes: number): Array<[number, number]> {
  const sorted = sortTime(steps);
  if (sorted.length === 0) return [];
  const pts: Array<[number, number]> = [];
  if (sorted[0]!.atMinutes > 0) pts.push([0, sorted[0]!.targetC]);
  for (const s of sorted) pts.push([s.atMinutes, s.targetC]);
  const last = sorted[sorted.length - 1]!;
  if (endMinutes > last.atMinutes) pts.push([endMinutes, last.targetC]);
  return pts;
}

export function toRequest(name: string, draft: StepDraft): CreateProfileRequest {
  return draft.triggerType === "time"
    ? { name, triggerType: "time", steps: sortTime(draft.steps) }
    : { name, triggerType: "gravity", steps: draft.steps };
}
