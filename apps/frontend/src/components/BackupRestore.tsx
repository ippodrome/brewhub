import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { downloadBackup, restoreBackup, type RestoreResult } from "../api/backup";

export function BackupRestore(): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);

  const downloadMutation = useMutation({ mutationFn: downloadBackup });

  const restoreMutation = useMutation({
    mutationFn: restoreBackup,
    onSuccess: (result) => setRestoreResult(result),
  });

  function handleFileChosen(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow choosing the same filename again later
    if (!file) return;

    const confirmed = window.confirm(
      `Restore the database from "${file.name}"? This replaces ALL current devices, taps, profiles, and history. ` +
        "A safety copy of the current database is made automatically first, but this cannot be undone from the UI.",
    );
    if (!confirmed) return;

    setRestoreResult(null);
    restoreMutation.mutate(file);
  }

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-card p-4">
      <div>
        <p className="text-sm font-medium text-muted">Backup</p>
        <p className="text-xs text-dim">
          Downloads the full application database — devices, taps, profiles, history, settings — as a single file.
        </p>
      </div>
      <button
        onClick={() => downloadMutation.mutate()}
        disabled={downloadMutation.isPending}
        className="rounded-xl bg-amber hover:bg-amber-hi px-3 py-1.5 text-xs font-medium text-on-amber disabled:opacity-50"
      >
        {downloadMutation.isPending ? "Preparing..." : "Download backup"}
      </button>
      {downloadMutation.isError && <p className="text-xs text-crit">Backup download failed.</p>}

      <div className="border-t border-line pt-4">
        <p className="text-sm font-medium text-muted">Restore</p>
        <p className="text-xs text-dim">
          Replaces the current database with a previously downloaded backup file.
        </p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".db"
        onChange={handleFileChosen}
        className="hidden"
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={restoreMutation.isPending}
        className="rounded-xl px-3 py-1.5 text-xs text-muted hover:bg-tint hover:text-fg disabled:opacity-50"
      >
        {restoreMutation.isPending ? "Restoring..." : "Restore from backup..."}
      </button>
      {restoreMutation.isError && (
        <p className="text-xs text-crit">
          {restoreMutation.error instanceof Error ? restoreMutation.error.message : "Restore failed."}
        </p>
      )}
      {restoreResult?.ok && (
        <p className="text-xs text-ok">
          Restore complete. A safety copy of the previous database was saved on the server at{" "}
          <code>{restoreResult.safetyBackup}</code>. Restart the backend now for the restored data to take effect
          (<code>docker compose restart backend</code>, or your process manager's equivalent) — it keeps running on
          the old data until then.
        </p>
      )}
    </div>
  );
}
