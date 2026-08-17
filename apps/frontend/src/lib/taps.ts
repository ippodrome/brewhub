/**
 * How full a keg is, as a percentage.
 *
 * Both ends are clamped because both ends occur in practice: a keg filled
 * past its nominal volume reads over 100, and a flow meter that overcounted
 * while a line was purged reads below zero. Either would draw a bar outside
 * its track.
 */
export function tapFillPercent(remainingMl: number, fullMl: number): number {
  if (fullMl <= 0) return 0;
  return Math.max(0, Math.min(100, (remainingMl / fullMl) * 100));
}

/** Millilitres as litres, one decimal, never negative. */
export function litresFrom(ml: number): string {
  return (Math.max(0, ml) / 1000).toFixed(1);
}
