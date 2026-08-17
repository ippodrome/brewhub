import { useQuery } from "@tanstack/react-query";
import { LOW_VOLUME_THRESHOLD_PERCENT, type Device } from "@brewhub/shared-types";
import { listTaps } from "../api/taps";
import { litresFrom, tapFillPercent } from "../lib/taps";

/**
 * The tap list, sized for a screen you read standing at the kegerator.
 *
 * The dashboard's summary answers "is anything running low" in a glance at a
 * card. Standing in front of the taps you are asking something else — which
 * handle pours what, and whether it is worth starting — so the beer's name
 * and what is left of it are the two things given real size here.
 */
export function TapWall({ device }: { device: Device }): JSX.Element | null {
  const tapsQuery = useQuery({
    queryKey: ["taps", device.id],
    queryFn: () => listTaps(device.id),
  });

  // Rendering nothing on failure is fine on a dashboard card you are actively
  // looking at, but this page is left running unattended — an empty space
  // reads as "no kegs", which is a different and wrong statement.
  if (tapsQuery.isError) {
    return (
      <p className="rounded-xl border border-crit/40 bg-crit/10 px-4 py-3 text-lg font-medium text-crit">
        Could not load the tap list
      </p>
    );
  }

  const taps = tapsQuery.data ?? [];
  if (taps.length === 0) return null;

  return (
    <ul className="space-y-3">
      {taps.map((tap, index) => {
        const percent = tapFillPercent(tap.remainingVolumeMl, tap.fullVolumeMl);
        const low = percent < LOW_VOLUME_THRESHOLD_PERCENT;
        const kicked = tap.kickedAt !== null;

        const meta = [tap.style, tap.abv !== null ? `${tap.abv.toFixed(1)} %` : null, tap.ibu !== null ? `${tap.ibu} IBU` : null]
          .filter(Boolean)
          .join(" · ");

        return (
          <li
            key={tap.id}
            className={`flex items-center gap-4 rounded-xl border border-line bg-card px-4 py-3.5 ${
              kicked ? "opacity-60" : ""
            }`}
          >
            <span className="w-6 shrink-0 text-center text-sm tabular-nums text-dim">{index + 1}</span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-medium text-fg sm:text-xl">{tap.name}</p>
              {meta && <p className="mt-0.5 truncate text-sm text-dim">{meta}</p>}
              <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-tint">
                <div
                  className={`h-full rounded-full ${low ? "bg-crit" : "bg-amber"}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>

            <div className="shrink-0 text-right">
              {/* A kicked keg is the one state where the number is a lie —
                  the meter stopped counting when the beer ran out, so
                  whatever litres it reports are stale by definition. */}
              {kicked ? (
                <p className="text-lg font-medium text-crit">Empty</p>
              ) : (
                <p className={`font-display text-3xl font-semibold tabular-nums sm:text-4xl ${low ? "text-crit" : "text-fg"}`}>
                  {litresFrom(tap.remainingVolumeMl)}
                  <span className="ml-1 text-lg text-dim">L</span>
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
