import { useCallback, useState } from "react";
import { effectiveBeerDensity, type Tap } from "@brewhub/shared-types";

export type KegUnit = "weight" | "volume";

const KEY_PREFIX = "brewhub.kegscale.unit.";

export function unitStorageKey(deviceId: string): string {
  return `${KEY_PREFIX}${deviceId}`;
}

/** Stored choice wins; otherwise volume when an empty-keg weight is known (volume means something), else weight. */
export function readKegUnit(
  deviceId: string,
  emptyWeightKnown: boolean,
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): KegUnit {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(unitStorageKey(deviceId)) ?? null;
  } catch {
    // Private mode / disabled storage: fall through to the default.
  }
  if (stored === "weight" || stored === "volume") return stored;
  return emptyWeightKnown ? "volume" : "weight";
}

export function writeKegUnit(
  deviceId: string,
  unit: KegUnit,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(unitStorageKey(deviceId), unit);
  } catch {
    // Not persisted — still works for this page view.
  }
}

/** Per-scale-device unit preference, persisted in localStorage. */
export function useKegUnit(deviceId: string | null, emptyWeightKnown: boolean): [KegUnit, () => void] {
  const [override, setOverride] = useState<KegUnit | null>(null);
  const unit = override ?? (deviceId ? readKegUnit(deviceId, emptyWeightKnown) : "volume");
  const toggle = useCallback(() => {
    const next: KegUnit = unit === "volume" ? "weight" : "volume";
    if (deviceId) writeKegUnit(deviceId, next);
    setOverride(next);
  }, [deviceId, unit]);
  return [unit, toggle];
}

export function formatKg(grams: number): string {
  return (Math.max(0, grams) / 1000).toFixed(2);
}

export function formatLitres(ml: number): string {
  return (Math.max(0, ml) / 1000).toFixed(1);
}

/** A weight tap's remaining beer in the chosen unit: { value, unit label }. */
export function remainingInUnit(tap: Tap, unit: KegUnit): { value: string; label: "kg" | "L" } {
  if (unit === "weight") {
    return { value: formatKg(tap.remainingVolumeMl * effectiveBeerDensity(tap)), label: "kg" };
  }
  return { value: formatLitres(tap.remainingVolumeMl), label: "L" };
}

/** Parses a kg text field to grams, or null when empty/invalid/negative. */
export function kgFieldToGrams(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : null;
}
