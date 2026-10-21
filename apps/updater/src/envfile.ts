import { readFile, rename, writeFile } from "node:fs/promises";

export const BACKEND_TAG_KEY = "BREWHUB_IMAGE_TAG";
export const FRONTEND_TAG_KEY = "BREWHUB_FRONTEND_TAG";

export interface ImageTags {
  backend: string;
  frontend: string;
}

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

/** Sets keys in place, preserving every other line and comment; appends missing keys. */
export function setEnvValues(text: string, values: Record<string, string>): string {
  const remaining = new Map(Object.entries(values));
  const lines = text.split(/\r?\n/).map((line) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m && remaining.has(m[1]!)) {
      const v = remaining.get(m[1]!)!;
      remaining.delete(m[1]!);
      return `${m[1]}=${v}`;
    }
    return line;
  });
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const [k, v] of remaining) lines.push(`${k}=${v}`);
  return lines.join("\n") + "\n";
}

export async function readTags(envFile: string): Promise<ImageTags> {
  const env = parseEnv(await readFile(envFile, "utf8"));
  return { backend: env[BACKEND_TAG_KEY] ?? "", frontend: env[FRONTEND_TAG_KEY] ?? "" };
}

/** Atomic write (temp file + rename in the same directory). */
export async function writeTags(envFile: string, tags: ImageTags): Promise<void> {
  const text = await readFile(envFile, "utf8");
  const next = setEnvValues(text, { [BACKEND_TAG_KEY]: tags.backend, [FRONTEND_TAG_KEY]: tags.frontend });
  const tmp = `${envFile}.updater-tmp`;
  await writeFile(tmp, next, { mode: 0o600 });
  await rename(tmp, envFile);
}
