import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import type { ActiveProfileProgress } from "@brewhub/shared-types";
import { getActiveProgress, restartActiveProfile } from "../api/profiles";
import { formatMinutes } from "../lib/profile-steps";
import { ProfileCurve } from "./ProfileCurve";
import { ConfirmDialog } from "./ConfirmDialog";

export type RunningProgress = Extract<ActiveProfileProgress, { active: true }>;

export function useActiveProgress(deviceId: string) {
  return useQuery({
    queryKey: ["profile-progress", deviceId],
    queryFn: () => getActiveProgress(deviceId),
    refetchInterval: 60_000,
  });
}

export function stepLabel(p: RunningProgress): string {
  if (p.finished) return `All ${p.stepCount} steps done · holding`;
  return `Step ${p.stepIndex + 1} of ${p.stepCount} in progress`;
}

function nextLabel(p: RunningProgress): string | null {
  if (p.profile.triggerType === "time") {
    if (p.nextChangeAtMinutes === null || p.nextTargetC === null) return p.finished ? null : "Last step";
    return `Next: ${p.nextTargetC.toFixed(1)} °C in ${formatMinutes(p.nextChangeAtMinutes - p.elapsedMinutes)}`;
  }
  const next = p.profile.steps[p.stepIndex + 1];
  if (!next || !("atGravitySg" in next)) return "Last step";
  return `Next: ${next.targetC.toFixed(1)} °C at ${next.atGravitySg.toFixed(3)} SG`;
}

/**
 * Where the device is in its profile. `compact` is the dashboard card version
 * (curve + one line); the full one adds Restart and lives in the Profiles panel.
 */
export function ProfileProgress({ deviceId, compact = false }: { deviceId: string; compact?: boolean }): JSX.Element | null {
  const query = useActiveProgress(deviceId);
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const restart = useMutation({
    mutationFn: () => restartActiveProfile(deviceId),
    onSuccess: (data) => {
      queryClient.setQueryData(["profile-progress", deviceId], data);
      setConfirming(false);
    },
  });

  const p = query.data;
  if (!p || !p.active) return null;
  const next = nextLabel(p);

  return (
    <section
      aria-label="Fermentation profile progress"
      className={compact ? "mt-5 border-t border-line pt-4" : "rounded-2xl border border-amber/25 bg-amber/[0.06] p-4"}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-medium text-fg">
          <span className="text-amber">●</span> {p.profile.name}
        </p>
        {p.currentSetpointC !== null && (
          <p className="shrink-0 text-xs tabular-nums text-muted">
            Target <span className="font-semibold text-fg">{p.currentSetpointC.toFixed(1)} °C</span>
          </p>
        )}
      </div>

      {p.profile.triggerType === "time" && (
        <ProfileCurve steps={p.profile.steps} elapsedMinutes={p.elapsedMinutes} className={compact ? "mt-3 h-12" : "mt-3 h-16"} />
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className="font-medium text-amber">{stepLabel(p)}</span>
        <span className="text-dim">
          {p.profile.triggerType === "time"
            ? `Day ${Math.floor(p.elapsedMinutes / 1440) + 1} · ${formatMinutes(p.elapsedMinutes)} in`
            : p.currentGravitySg !== null
              ? `${p.currentGravitySg.toFixed(3)} SG now`
              : "Waiting for a gravity reading"}
        </span>
      </div>
      {next && <p className="mt-1 text-xs text-muted">{next}</p>}

      {!compact && (
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={() => setConfirming(true)} className="chip">
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
            Restart
          </button>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={`Restart ${p.profile.name}?`}
          confirmLabel="Restart from step 1"
          pendingLabel="Restarting…"
          pending={restart.isPending}
          error={restart.isError ? "Could not restart the profile. Try again." : null}
          onConfirm={() => restart.mutate()}
          onCancel={() => setConfirming(false)}
        >
          The start time is reset to now and the setpoint jumps back to step 1 straight away. Use this when you
          pitch a new batch with the same profile.
        </ConfirmDialog>
      )}
    </section>
  );
}
