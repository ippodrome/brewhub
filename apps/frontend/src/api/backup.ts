import { apiFetch, getToken } from "./client";

/** Triggers a browser download of the current SQLite database via an authenticated blob URL. */
export async function downloadBackup(): Promise<void> {
  const token = getToken();
  const res = await fetch("/api/backup", {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) {
    throw new Error(`Backup download failed: ${res.status}`);
  }

  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? "brewhub-backup.db";

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface RestoreResult {
  ok: boolean;
  restartRequired: boolean;
  safetyBackup: string;
}

export async function restoreBackup(file: File): Promise<RestoreResult> {
  const body = new FormData();
  body.append("file", file);
  return apiFetch<RestoreResult>("/api/backup/restore", { method: "POST", body });
}
