/** Numeric compare of "1.2.3" style versions (leading "v" and pre-release suffix ignored). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v.replace(/^v/, "").split(/[-+]/)[0]!.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const isRelease = (v: string | null | undefined): v is string => !!v && /^v?\d+(\.\d+)*/.test(v);

/**
 * The browser still runs an older interface than the installed backend —
 * only then is a reload useful. Dev builds never ask.
 */
export function interfaceNeedsReload(uiVersion: string, installedVersion: string | null | undefined): boolean {
  if (!isRelease(uiVersion) || !isRelease(installedVersion)) return false;
  return compareVersions(uiVersion, installedVersion) < 0;
}
