import { useId } from "react";
import type { TimeProfileStep } from "@brewhub/shared-types";
import { curvePoints } from "../lib/profile-steps";
import { resolveSetpointAt } from "../lib/profile-progress";

const W = 300;
const H = 80;
const PAD_Y = 10;

/**
 * A compact temperature-over-time curve for a time profile, drawn as SVG so it
 * takes the design tokens through classes (stroke-amber etc.) in both themes.
 * When `elapsedMinutes` is given, the part already run is solid and a "now"
 * marker sits on the curve.
 */
export function ProfileCurve({
  steps,
  elapsedMinutes,
  className = "",
}: {
  steps: TimeProfileStep[];
  elapsedMinutes?: number;
  className?: string;
}): JSX.Element | null {
  const gradId = useId();
  const lastAt = Math.max(...steps.map((s) => s.atMinutes), 0);
  const end = Math.max(lastAt * 1.08, (elapsedMinutes ?? 0) * 1.02, 60);
  const pts = curvePoints(steps, end);
  if (pts.length === 0) return null;

  const temps = pts.map((p) => p[1]);
  const lo = Math.min(...temps) - 1;
  const hi = Math.max(...temps) + 1;
  const x = (m: number) => (m / end) * W;
  const y = (c: number) => PAD_Y + (1 - (c - lo) / (hi - lo)) * (H - 2 * PAD_Y);
  const line = pts.map(([m, c], i) => `${i ? "L" : "M"}${x(m).toFixed(1)},${y(c).toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;

  const now = elapsedMinutes === undefined ? null : Math.min(elapsedMinutes, end);
  const nowC = now === null ? null : resolveSetpointAt(steps, now);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={`block w-full min-w-0 overflow-visible ${className}`}
      role="img"
      aria-label={`Profile curve from ${Math.min(...temps)} to ${Math.max(...temps)} °C`}
    >
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" className="[stop-color:rgb(var(--c-amber))]" stopOpacity="0.22" />
          <stop offset="100%" className="[stop-color:rgb(var(--c-amber))]" stopOpacity="0" />
        </linearGradient>
        {now !== null && (
          <clipPath id={`${gradId}-done`}>
            <rect x="0" y="0" width={x(now)} height={H} />
          </clipPath>
        )}
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path
        d={line}
        fill="none"
        className="stroke-amber"
        strokeOpacity={now === null ? 1 : 0.35}
        strokeWidth="1.75"
        strokeDasharray={now === null ? undefined : "3 3"}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
      {now !== null && (
        <>
          <path
            d={line}
            fill="none"
            className="stroke-amber"
            strokeWidth="2.25"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            clipPath={`url(#${gradId}-done)`}
          />
          <line x1={x(now)} x2={x(now)} y1={0} y2={H} className="stroke-fg" strokeOpacity="0.25" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        </>
      )}
      {now !== null && nowC !== null && (
        // An HTML-free dot: circles get squashed by preserveAspectRatio="none",
        // so draw the marker as a zero-length round-capped stroke instead.
        <path
          d={`M${x(now)},${y(nowC)} l0,0`}
          className="stroke-amber"
          strokeWidth="9"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
