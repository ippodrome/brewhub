import { apiFetch } from "./client";

export interface ReleaseInfo {
  version: string;
  tag: string;
  name: string;
  notes: string;
  url: string;
  publishedAt: string | null;
}

export interface SystemVersion {
  version: string;
  updaterConfigured: boolean;
}

export interface UpdateCheck {
  currentVersion: string | null;
  latest: ReleaseInfo;
  updateAvailable: boolean;
  blockedReason: string | null;
  checkedAt: string;
  cached?: boolean;
}

export type UpdateState = "idle" | "running" | "succeeded" | "failed" | "rolled_back" | "rollback_failed";
export type UpdateStep =
  | "checking"
  | "pulling"
  | "stopping"
  | "backing_up"
  | "switching"
  | "starting"
  | "health_check"
  | "rolling_back"
  | "done";

export interface UpdateStatus {
  state: UpdateState;
  step: UpdateStep | null;
  running?: boolean;
  fromVersion: string | null;
  toVersion: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  dryRun: boolean;
  error: string | null;
  rollback: { attempted: boolean; ok: boolean | null; error: string | null };
  backup: { dir: string; bytes: number; sha256: string } | null;
  log: Array<{ ts: string; message: string }>;
}

export const getSystemVersion = (): Promise<SystemVersion> => apiFetch("/api/system/version");
export const checkForUpdate = (force = false): Promise<UpdateCheck> =>
  apiFetch(`/api/system/update/check${force ? "?force=1" : ""}`);
export const getUpdateStatus = (): Promise<UpdateStatus> => apiFetch("/api/system/update/status");
export const startUpdate = (version: string): Promise<UpdateStatus> =>
  apiFetch("/api/system/update", { method: "POST", body: JSON.stringify({ version }) });

/** Ordered steps shown as progress; rolling_back is shown separately. */
export const UPDATE_STEPS: Array<{ step: UpdateStep; label: string }> = [
  { step: "pulling", label: "Download new version" },
  { step: "stopping", label: "Stop backend" },
  { step: "backing_up", label: "Back up database" },
  { step: "switching", label: "Switch version" },
  { step: "starting", label: "Start new version" },
  { step: "health_check", label: "Health check" },
];

/** Pulls a readable message out of an ApiError body ({error, message}). */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return "Something went wrong.";
  try {
    const body = JSON.parse(err.message) as { error?: string; message?: string };
    return body.message ?? body.error ?? err.message;
  } catch {
    return err.message;
  }
}
