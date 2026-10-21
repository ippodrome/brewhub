import { normalizeVersion, parseVersion } from "./version.js";

export interface ReleaseInfo {
  version: string;
  tag: string;
  name: string;
  notes: string;
  url: string;
  publishedAt: string | null;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchLatestRelease(
  repo: string,
  token: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<ReleaseInfo> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "brewhub-updater",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) {
    throw new Error(
      token
        ? `No published release found for ${repo}`
        : `No release found for ${repo} (a private repo needs GITHUB_TOKEN)`,
    );
  }
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  const tag = String(body.tag_name ?? "");
  if (!parseVersion(tag)) throw new Error(`Latest release tag "${tag}" is not a vX.Y.Z version`);
  return {
    version: normalizeVersion(tag),
    tag,
    name: String(body.name ?? tag),
    notes: String(body.body ?? "").slice(0, 20_000),
    url: String(body.html_url ?? ""),
    publishedAt: typeof body.published_at === "string" ? body.published_at : null,
  };
}
