/** Strict release versions only: 1.2.3 (optionally written v1.2.3). */
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(v: string | undefined | null): [number, number, number] | null {
  const m = v ? SEMVER.exec(v.trim()) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function normalizeVersion(v: string): string {
  return v.trim().replace(/^v/, "");
}

/** >0 if a is newer than b. Non-semver sorts as oldest. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    const d = pa[i]! - pb[i]!;
    if (d !== 0) return d;
  }
  return 0;
}
