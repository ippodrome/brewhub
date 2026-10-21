import { spawn } from "node:child_process";
import type { UpdaterConfig } from "./config.js";
import { BACKEND_TAG_KEY, FRONTEND_TAG_KEY, type ImageTags } from "./envfile.js";

/** The only Docker operations the updater ever performs. */
export interface Compose {
  pull(tags: ImageTags): Promise<void>;
  stopBackend(): Promise<void>;
  /** Recreates backend + caddy only (never the updater or proxy). */
  up(tags: ImageTags): Promise<void>;
  /** True if every app service container is running. */
  servicesRunning(tags: ImageTags): Promise<boolean>;
}

export type Runner = (
  args: string[],
  env: NodeJS.ProcessEnv,
) => Promise<{ code: number; stdout: string; stderr: string }>;

export const APP_SERVICES = ["backend", "caddy"] as const;

export const spawnRunner: Runner = (args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn("docker", args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 15 * 60_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

export function composeBaseArgs(cfg: Pick<UpdaterConfig, "composeProject" | "composeDir" | "composeFiles" | "envFile">): string[] {
  const args = ["compose", "--project-name", cfg.composeProject, "--project-directory", cfg.composeDir, "--env-file", cfg.envFile];
  for (const f of (cfg.composeFiles ?? "").split(":").filter(Boolean)) args.push("-f", f.startsWith("/") ? f : `${cfg.composeDir}/${f}`);
  return args;
}

export function createCompose(cfg: UpdaterConfig, run: Runner = spawnRunner, log: (m: string) => void = () => {}): Compose {
  const base = composeBaseArgs(cfg);
  async function exec(extra: string[], tags?: ImageTags): Promise<string> {
    // Tags are passed as environment, which Compose ranks above .env — so a
    // half-written .env can never make us run a different version than asked.
    const env = { ...process.env, ...(tags ? { [BACKEND_TAG_KEY]: tags.backend, [FRONTEND_TAG_KEY]: tags.frontend } : {}) };
    log(`$ docker ${[...base, ...extra].join(" ")}`);
    const r = await run([...base, ...extra], env);
    if (r.code !== 0) throw new Error(`docker ${extra.join(" ")} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().slice(-800)}`);
    return r.stdout;
  }
  return {
    pull: async (tags) => void (await exec(["pull", "--quiet", ...APP_SERVICES], tags)),
    stopBackend: async () => void (await exec(["stop", "backend"])),
    up: async (tags) => void (await exec(["up", "-d", "--no-deps", "--force-recreate", ...APP_SERVICES], tags)),
    servicesRunning: async (tags) => {
      const out = await exec(["ps", "--format", "json", ...APP_SERVICES], tags);
      const rows = out
        .trim()
        .split(/\n+/)
        .filter(Boolean)
        .flatMap((l) => {
          const v = JSON.parse(l) as unknown;
          return Array.isArray(v) ? v : [v];
        }) as Array<{ Service?: string; State?: string }>;
      return APP_SERVICES.every((s) => rows.some((r) => r.Service === s && r.State === "running"));
    },
  };
}
