import { describe, expect, test } from "vitest";
import { computeKegContents, effectiveBeerDensity, type Tap } from "@brewhub/shared-types";
import { kgFieldToGrams, readKegUnit, remainingInUnit, unitStorageKey, writeKegUnit } from "./keg-scale";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

const tap = {
  id: 1, deviceId: "k", measurementType: "weight", name: "Pils", style: null, abv: null, ibu: null, notes: null,
  imageUrl: null, fullVolumeMl: 19000, remainingVolumeMl: 10000, createdAt: 0, kickedAt: null, flowIndex: null,
  pulsesPerLiter: null, weightDeviceId: "s", weightIndex: 0, tareWeightG: 4000, fullWeightG: 23190,
  beerDensityKgPerL: 1.01, finalGravitySg: null,
} satisfies Tap;

describe("keg unit preference", () => {
  test("defaults to volume when the empty weight is known, else weight", () => {
    const s = memoryStorage();
    expect(readKegUnit("a", true, s)).toBe("volume");
    expect(readKegUnit("a", false, s)).toBe("weight");
  });

  test("remembers per device", () => {
    const s = memoryStorage();
    writeKegUnit("a", "weight", s);
    expect(readKegUnit("a", true, s)).toBe("weight");
    expect(readKegUnit("b", true, s)).toBe("volume");
    expect(s.getItem(unitStorageKey("a"))).toBe("weight");
  });

  test("ignores garbage in storage", () => {
    const s = memoryStorage();
    s.setItem(unitStorageKey("a"), "furlongs");
    expect(readKegUnit("a", true, s)).toBe("volume");
  });
});

describe("keg contents", () => {
  test("volume = (gross − empty) / density, with net weight and percent", () => {
    const c = computeKegContents({ grossWeightG: 14100, emptyKegWeightG: 4000, densityKgPerL: 1.01, fullVolumeMl: 19000 });
    expect(c.netWeightG).toBe(10100);
    expect(c.volumeMl).toBeCloseTo(10000);
    expect(c.percent).toBeCloseTo(52.6, 1);
  });

  test("clamps at zero and has no percent without a full volume", () => {
    const c = computeKegContents({ grossWeightG: 3800, emptyKegWeightG: 4000, densityKgPerL: 1.01 });
    expect(c.netWeightG).toBe(0);
    expect(c.volumeMl).toBe(0);
    expect(c.percent).toBeNull();
  });

  test("FG beats the stored density, which beats the default", () => {
    expect(effectiveBeerDensity({ finalGravitySg: 1.014, beerDensityKgPerL: 1.0 })).toBe(1.014);
    expect(effectiveBeerDensity({ finalGravitySg: null, beerDensityKgPerL: 1.0 })).toBe(1.0);
    expect(effectiveBeerDensity({})).toBe(1.01);
  });

  test("remaining in unit", () => {
    expect(remainingInUnit(tap, "volume")).toEqual({ value: "10.0", label: "L" });
    expect(remainingInUnit(tap, "weight")).toEqual({ value: "10.10", label: "kg" });
  });

  test("kg field parsing", () => {
    expect(kgFieldToGrams("4,05")).toBe(4050);
    expect(kgFieldToGrams("")).toBeNull();
    expect(kgFieldToGrams("-1")).toBeNull();
  });
});
