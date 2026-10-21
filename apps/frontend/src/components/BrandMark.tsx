import { Thermometer } from "lucide-react";

export function BrandMark({ size = "md" }: { size?: "md" | "lg" }): JSX.Element {
  const box = size === "lg" ? "h-11 w-11 rounded-2xl" : "h-9 w-9 rounded-xl";
  return (
    <span className="flex items-center gap-3">
      <span className={`flex ${box} items-center justify-center text-on-amber shadow-glow`} style={{ background: "var(--grad-amber)" }}>
        <Thermometer className={size === "lg" ? "h-5 w-5" : "h-4 w-4"} strokeWidth={2.25} />
      </span>
      <span className={`font-display font-semibold text-fg ${size === "lg" ? "text-2xl" : "text-xl"}`}>
        Brew<span className="italic text-amber">Hub</span>
      </span>
    </span>
  );
}

