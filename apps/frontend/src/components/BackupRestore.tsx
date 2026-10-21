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
    <div className="card space-y-4 p-5">
      <div>
        <h3 className="font-display text-base font-semibold text-fg">Backup</h3>
        <p className="text-xs text-dim">
          Downloads the full application database — devices, taps, profiles, history, settings — as a single file.
        </p>
      </div>
      <button
        onClick={() => downloadMutation.mutate()}
        disabled={downloadMutation.isPending}
        className="btn-primary px-3 py-1.5 text-xs"
      >
        {downloadMutation.isPending ? "Preparing..." : "Download backup"}
      </button>
      {downloadMutation.isError && <p className="text-xs text-crit">Backup download failed.</p>}

      <div className="border-t border-line pt-4">
        <h3 className="font-display text-base font-semibold text-fg">Restore</h3>
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
