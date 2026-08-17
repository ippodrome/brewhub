import { useQuery } from "@tanstack/react-query";
import { LOW_VOLUME_THRESHOLD_PERCENT, type Device } from "@brewhub/shared-types";
import { listTaps } from "../api/taps";
import { tapFillPercent } from "../lib/taps";

export function TapVolumeSummary({ device }: { device: Device }): JSX.Element | null {
  const tapsQuery = useQuery({
    queryKey: ["taps", device.id],
    queryFn: () => listTaps(device.id),
  });

  const taps = tapsQuery.data ?? [];
  if (taps.length === 0) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      {taps.map((tap) => {
        const percent = tapFillPercent(tap.remainingVolumeMl, tap.fullVolumeMl);
        return (
          <div key={tap.id} className="space-y-1">
            <div className="flex justify-between text-xs text-dim">
              <span>{tap.name}</span>
              <span className="tabular-nums">{Math.round(percent)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-tint">
              <div
                className={`h-full rounded-full ${percent < LOW_VOLUME_THRESHOLD_PERCENT ? "bg-crit" : "bg-ok"}`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
