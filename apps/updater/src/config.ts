/**
 * Updater configuration, read once from the environment at startup.
 *
 * Everything that decides *what* gets run against Docker is fixed here by
 * the operator — nothing in an HTTP request can choose an image name, a
 * compose file or a project. A request can only say "update to the version
 * GitHub currently calls the latest release", and even that is re-checked.
 */
export interface UpdaterConfig {
  port: number;
  /** Shared secret the backend must present as `Authorization: Bearer …`. */
  secret: string;
  /** owner/repo whose releases define what "latest" means. */
  githubRepo: string;
  /** Optional read-only token — required when the repo is private. */
  githubToken?: string;
  /** Compose project name the stack was started under (`docker compose ls`). */
  composeProject: string;
  /** Host path of the compose project dir, mounted at the same path inside. */
  composeDir: string;
  /** Optional colon-separated list of compose files (relative to composeDir). */
  composeFiles?: string;
  /** Path of the .env file holding BREWHUB_IMAGE_TAG / BREWHUB_FRONTEND_TAG. */
  envFile: string;
  /** Live SQLite database (backend-data volume mounted into the updater). */
  dbPath: string;
  /** Where backups, status.json and the update log live. */
  stateDir: string;
  keepBackups: number;
  /** Backend health URL — must report the expected version after an update. */
  backendHealthUrl: string;
  healthTimeoutMs: number;
  dryRun: boolean;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v || v.trim() === "") throw new Error(`Missing required env var ${key}`);
  return v.trim();
}

export function loadUpdaterConfig(env: NodeJS.ProcessEnv = process.env): UpdaterConfig {
  const secret = required(env, "UPDATER_SECRET");
  if (secret.length < 32) throw new Error("UPDATER_SECRET must be at least 32 characters");
  const composeDir = required(env, "COMPOSE_DIR");
  return {
    port: Number(env.UPDATER_PORT ?? 8080),
    secret,
    githubRepo: env.GITHUB_REPO?.trim() || "ippodrome/brewhub",
    githubToken: env.GITHUB_TOKEN?.trim() || undefined,
    composeProject: required(env, "COMPOSE_PROJECT"),
    composeDir,
    composeFiles: env.COMPOSE_FILES?.trim() || undefined,
    envFile: env.ENV_FILE?.trim() || `${composeDir}/.env`,
    dbPath: env.DB_PATH?.trim() || "/data/brewhub.db",
    stateDir: env.STATE_DIR?.trim() || "/state",
    keepBackups: Math.max(1, Number(env.KEEP_BACKUPS ?? 5)),
    backendHealthUrl: env.BACKEND_HEALTH_URL?.trim() || "http://backend:3000/api/health",
    healthTimeoutMs: Number(env.HEALTH_TIMEOUT_MS ?? 180_000),
    dryRun: env.UPDATER_DRY_RUN === "1" || env.UPDATER_DRY_RUN === "true",
  };
}
