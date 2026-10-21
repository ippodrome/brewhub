import { bandScale } from "../lib/band-scale";
import { bandPosition } from "../lib/temperature-band";

export interface BandMarker {
  label: string;
  valueC: number;
  /** `control` is the reading the loop regulates on; everything else is context. */
  tone: "control" | "context";
}

/**
 * Setpoint, deadband and every live reading on one axis.
 *
 * A brewer standing in front of a chamber is not asking "what is the number",
 * they are asking "is the beer inside its window, and heading in or out". A
 * large numeral answers the first question and not the second; putting the
 * markers on a shared scale answers both, and does it from across a room.
 */
export function TemperatureBand({
  setpointC,
  hysteresisC,
  markers,
}: {
  setpointC: number;
  hysteresisC: number;
  markers: BandMarker[];
}): JSX.Element {
  const { minC, maxC } = bandScale(
    setpointC,
    markers.map((m) => m.valueC),
  );

  const lowC = setpointC - hysteresisC;
  const highC = setpointC + hysteresisC;
  const deadbandLeft = bandPosition(lowC, minC, maxC);
  const deadbandWidth = bandPosition(highC, minC, maxC) - deadbandLeft;

  const ticks = [minC, (minC + maxC) / 2, maxC];

  return (
    <div>
      <div className="relative h-12 overflow-hidden rounded-2xl border border-line-strong bg-tint sm:h-16">
        <div
          className="absolute inset-y-0 border-x border-amber/40 bg-amber/10"
          style={{ left: `${deadbandLeft}%`, width: `${deadbandWidth}%` }}
        />
        <div
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-amber"
          style={{ left: `${bandPosition(setpointC, minC, maxC)}%` }}
        />
        {markers.map((marker, i) => (
          <div
            key={`${i}-${marker.label}`}
            title={`${marker.label} ${marker.valueC.toFixed(1)} °C`}
            className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card transition-[left] duration-700 ease-out ${
              marker.tone === "control" ? "z-10 bg-fg" : "bg-cool"
            }`}
            style={{ left: `${bandPosition(marker.valueC, minC, maxC)}%` }}
          />
        ))}
      </div>

      <div className="mt-2 flex justify-between text-sm tabular-nums text-dim">
        {ticks.map((tick) => (
          <span key={tick}>{tick.toFixed(0)}</span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-base text-muted">
        {markers.map((marker, i) => (
          <span key={`${i}-${marker.label}`} className="flex items-center gap-2">
            <i
              aria-hidden="true"
              className={`h-2.5 w-2.5 rounded-full ${marker.tone === "control" ? "bg-fg" : "bg-cool"}`}
            />
            {marker.label}
          </span>
        ))}
        <span className="flex items-center gap-2">
          <i aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-amber" />
          Target {setpointC.toFixed(1)} ±{hysteresisC.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
