import { useQuery } from "@tanstack/react-query";
import { LOW_VOLUME_THRESHOLD_PERCENT, type Device } from "@brewhub/shared-types";
import { listTaps } from "../api/taps";

export function TapVolumeSummary({ device }: { device: Device }): JSX.Element | null {
  const tapsQuery = useQuery({
    queryKey: ["taps", device.id],
    queryFn: () => listTaps(device.id),
  });

  const taps = tapsQuery.data ?? [];
  if (taps.length === 0) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-neutral-200 dark:border-neutral-800 pt-3">
      {taps.map((tap) => {
        const fraction = tap.fullVolumeMl > 0 ? tap.remainingVolumeMl / tap.fullVolumeMl : 0;
        const percent = Math.max(0, Math.min(100, fraction * 100));
        return (
          <div key={tap.id} className="space-y-1">
            <div className="flex justify-between text-xs text-neutral-600 dark:text-neutral-500">
              <span>{tap.name}</span>
              <span className="tabular-nums">{Math.round(percent)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div
                className={`h-full rounded-full ${percent < LOW_VOLUME_THRESHOLD_PERCENT ? "bg-red-400" : "bg-emerald-400"}`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
