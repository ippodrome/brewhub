import type { Tone } from "../lib/status";

const DOT: Record<Tone, string> = {
  ok: "bg-ok shadow-[0_0_0_3px_rgb(var(--c-ok)/0.18)]",
  warn: "bg-amber shadow-[0_0_0_3px_rgb(var(--c-amber)/0.18)]",
  crit: "bg-crit shadow-[0_0_0_3px_rgb(var(--c-crit)/0.16)]",
  idle: "bg-dim",
};

const TEXT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-amber",
  crit: "text-crit",
  idle: "text-dim",
};

export function StatusDot({ tone, className = "" }: { tone: Tone; className?: string }): JSX.Element {
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[tone]} ${className}`} />;
}

/** Dot + label. Colour is never the only signal — the label always says it. */
export function StatusPill({ tone, label, title }: { tone: Tone; label: string; title?: string }): JSX.Element {
  return (
    <span title={title} className={`pill border border-line bg-card ${TEXT[tone]}`}>
      <StatusDot tone={tone} />
      <span>{label}</span>
    </span>
  );
}
