import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import {
  checkForUpdate,
  describeError,
  getUpdateStatus,
  startUpdate,
  UPDATE_STEPS,
  type UpdateStatus,
} from "../api/system";
import { useUpdateCheck } from "../hooks/useUpdateCheck";
import { ConfirmDialog } from "./ConfirmDialog";

declare const __APP_VERSION__: string;

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Tiny, text-only rendering of GitHub release notes (headings, bullets, paragraphs). */
function ReleaseNotes({ text }: { text: string }): JSX.Element {
  const lines = text.replace(/\r/g, "").split("\n");
  const clean = (l: string): string => l.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
  return (
    <div className="space-y-1.5">
      {lines.map((raw, i) => {
        const l = raw.trim();
        if (!l) return <div key={i} className="h-1" />;
        const h = /^#{1,6}\s+(.*)$/.exec(l);
        if (h) return <p key={i} className="pt-1 font-semibold text-fg">{clean(h[1]!)}</p>;
        const b = /^[-*]\s+(.*)$/.exec(l);
        if (b)
          return (
            <p key={i} className="flex gap-2">
              <span className="text-amber">•</span>
              <span>{clean(b[1]!)}</span>
            </p>
          );
        return <p key={i}>{clean(l)}</p>;
      })}
    </div>
  );
}

function VersionTile({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: boolean }): JSX.Element {
  return (
    <div className="rounded-2xl border border-line bg-surface/60 px-4 py-3">
      <p className="eyebrow">{label}</p>
      <p className={`mt-1 font-display text-2xl font-semibold tabular-nums ${accent ? "text-amber" : "text-fg"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-dim">{hint}</p>}
    </div>
  );
}

function Progress({ status, reconnecting }: { status: UpdateStatus; reconnecting: boolean }): JSX.Element {
  const currentIdx = UPDATE_STEPS.findIndex((s) => s.step === status.step);
  const done = status.state === "succeeded";
  return (
    <ol className="space-y-2" aria-label="Update progress">
      {UPDATE_STEPS.map((s, i) => {
        const state = done || i < currentIdx ? "done" : i === currentIdx && status.state === "running" ? "active" : "todo";
        return (
          <li key={s.step} className="flex items-center gap-3 text-sm">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                state === "done"
                  ? "border-ok/40 bg-ok/10 text-ok"
                  : state === "active"
                    ? "border-amber/50 bg-amber/10 text-amber"
                    : "border-line text-dim"
              }`}
            >
              {state === "done" ? (
                <Check className="h-3.5 w-3.5" strokeWidth={2.25} />
              ) : state === "active" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <span className="text-[10px] font-semibold">{i + 1}</span>
              )}
            </span>
            <span className={state === "todo" ? "text-dim" : "text-fg"}>{s.label}</span>
            {state === "active" && reconnecting && <span className="text-xs text-dim">BrewHub is restarting…</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Outcome({ status }: { status: UpdateStatus }): JSX.Element | null {
  if (status.state === "succeeded") {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-ok/30 bg-ok/[0.07] p-4 text-sm">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
        <div className="space-y-2">
          <p className="font-semibold text-fg">
            {status.dryRun ? `Dry run for ${status.toVersion} passed.` : `Updated to ${status.toVersion}.`}
          </p>
          {!status.dryRun && (
            <>
              <p className="text-muted">The database was backed up first. Reload to load the new interface.</p>
              <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => window.location.reload()}>
                Reload now
              </button>
            </>
          )}
        </div>
      </div>
    );
  }
  if (status.state === "rolled_back" || (status.state === "failed" && status.rollback.attempted === false)) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-amber/30 bg-amber/[0.07] p-4 text-sm">
        <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
        <div className="space-y-1">
          <p className="font-semibold text-fg">
            {status.state === "rolled_back"
              ? `Update to ${status.toVersion} failed — rolled back to ${status.fromVersion}.`
              : `Update to ${status.toVersion} did not start. Nothing was changed.`}
          </p>
          {status.state === "rolled_back" && (
            <p className="text-muted">The previous version and the pre-update database are running again.</p>
          )}
          {status.error && <p className="text-xs text-dim">Reason: {status.error}</p>}
        </div>
      </div>
    );
  }
  if (status.state === "failed") {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-amber/30 bg-amber/[0.07] p-4 text-sm">
        <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
        <div className="space-y-1">
          <p className="font-semibold text-fg">Update stopped before switching — {status.fromVersion} is running again.</p>
          {status.error && <p className="text-xs text-dim">Reason: {status.error}</p>}
        </div>
      </div>
    );
  }
  if (status.state === "rollback_failed") {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-2xl border border-crit/40 bg-crit/[0.07] p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-crit" />
        <div className="space-y-1">
          <p className="font-semibold text-fg">Update and automatic rollback both failed.</p>
          <p className="text-muted">
            Follow “Manual rollback” in docs/UPDATERING.md. The pre-update backup is at{" "}
            <code className="text-xs">{status.backup?.dir ?? "the updater's backups folder"}</code>.
          </p>
          {(status.rollback.error ?? status.error) && (
            <p className="text-xs text-dim">Reason: {status.rollback.error ?? status.error}</p>
          )}
        </div>
      </div>
    );
  }
  return null;
}

export function UpdateManager(): JSX.Element {
  const queryClient = useQueryClient();
  const { version, check } = useUpdateCheck();
  const [confirming, setConfirming] = useState(false);
  const [watching, setWatching] = useState(false);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    if (window.location.hash === "#updates") document.getElementById("updates")?.scrollIntoView({ block: "start" });
  }, []);

  const configured = version.data?.updaterConfigured === true;
  const status = useQuery({
    queryKey: ["update-status"],
    queryFn: getUpdateStatus,
    enabled: configured,
    retry: false,
    refetchInterval: (q) => (watching || q.state.data?.state === "running" ? 2000 : false),
  });
  // The backend (and briefly Caddy) restarts mid-update, so polling errors
  // are expected — show them as "restarting", not as a failure.
  const reconnecting = watching && status.isError;
  const s = status.data;
  const running = watching || s?.state === "running";

  useEffect(() => {
    if (watching && s && s.state !== "running" && !status.isError && s.finishedAt) {
      setWatching(false);
      void queryClient.invalidateQueries({ queryKey: ["system-version"] });
      void queryClient.invalidateQueries({ queryKey: ["update-check"] });
    }
  }, [watching, s, status.isError, queryClient]);

  const recheck = useMutation({
    mutationFn: () => checkForUpdate(true),
    onSuccess: (data) => queryClient.setQueryData(["update-check"], data),
  });
  const update = useMutation({
    mutationFn: (v: string) => startUpdate(v),
    onSuccess: (data) => {
      setConfirming(false);
      setWatching(true);
      queryClient.setQueryData(["update-status"], data);
    },
  });

  if (version.isLoading) return <div className="card h-40 animate-pulse p-6" />;

  const c = check.data;
  const latest = c?.latest;
  const uiVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

  return (
    <div id="updates" className="card space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-lg font-semibold text-fg">BrewHub application</h3>
          <p className="mt-0.5 text-xs text-dim">
            Updates the app containers on your server. Device firmware is updated separately under Firmware.
          </p>
        </div>
        {configured && (
          <button
            type="button"
            className="btn-ghost px-3 py-1.5 text-xs"
            onClick={() => recheck.mutate()}
            disabled={recheck.isPending || running}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${recheck.isPending ? "animate-spin" : ""}`} />
            Check now
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <VersionTile label="Installed" value={version.data?.version ?? "—"} hint={`Interface ${uiVersion}`} />
        <VersionTile
          label="Latest release"
          value={latest?.version ?? (check.isLoading ? "…" : "—")}
          hint={latest?.publishedAt ? `Published ${formatDate(latest.publishedAt)}` : c ? undefined : " "}
          accent={c?.updateAvailable}
        />
      </div>

      {!configured && (
        <p className="rounded-2xl border border-line bg-surface/60 p-4 text-sm text-muted">
          In-app updates are not set up on this server. See <code className="text-xs">docs/UPDATERING.md</code> for
          the one-time setup, or update with <code className="text-xs">docker compose pull</code>.
        </p>
      )}

      {(check.isError || recheck.isError) && (
        <p className="text-sm text-crit">Could not check for updates: {describeError(check.error ?? recheck.error)}</p>
      )}

      {c && !running && (
        <>
          {c.updateAvailable && latest ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-line bg-surface/60 p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="eyebrow">What’s new in {latest.version}</p>
                  {latest.url && (
                    <a href={latest.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-amber hover:underline">
                      On GitHub
                    </a>
                  )}
                </div>
                <div className="mt-2 max-h-56 overflow-auto text-sm leading-relaxed text-muted">
                  {latest.notes.trim() ? <ReleaseNotes text={latest.notes} /> : "No release notes."}
                </div>
              </div>
              {c.blockedReason ? (
                <p className="text-sm text-amber">{c.blockedReason}</p>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className="btn-primary" onClick={() => setConfirming(true)}>
                    Update to {latest.version}
                  </button>
                  <span className="flex items-center gap-1.5 text-xs text-dim">
                    <ShieldCheck className="h-3.5 w-3.5 text-ok" /> Automatic backup and rollback
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Check className="h-4 w-4 text-ok" /> You’re on the latest version.
              <span className="text-xs text-dim">Checked {formatDate(c.checkedAt)}</span>
            </p>
          )}
        </>
      )}

      {s && (running || (s.state !== "idle" && s.finishedAt)) && (
        <div className="space-y-4 border-t border-line pt-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="eyebrow">
              {running ? `Updating to ${s.toVersion}` : `Last update · ${formatDate(s.finishedAt)}`}
            </p>
            {s.log.length > 0 && (
              <button type="button" className="text-xs font-medium text-dim hover:text-fg" onClick={() => setShowLog((v) => !v)}>
                {showLog ? "Hide log" : "Show log"}
              </button>
            )}
          </div>
          {running ? (
            s.step === "rolling_back" ? (
              <p className="flex items-center gap-2 text-sm text-amber">
                <Loader2 className="h-4 w-4 animate-spin" /> Something went wrong — rolling back to {s.fromVersion}…
              </p>
            ) : (
              <Progress status={s} reconnecting={reconnecting} />
            )
          ) : (
            <Outcome status={s} />
          )}
          {showLog && (
            <pre className="max-h-64 overflow-auto rounded-2xl border border-line bg-surface/60 p-4 text-[11px] leading-relaxed text-muted">
              {s.log.map((l) => `${new Date(l.ts).toLocaleTimeString()}  ${l.message}`).join("\n")}
            </pre>
          )}
        </div>
      )}

      {confirming && latest && (
        <ConfirmDialog
          title={`Update to ${latest.version}?`}
          confirmLabel="Update now"
          pendingLabel="Starting…"
          tone="primary"
          pending={update.isPending}
          error={update.isError ? describeError(update.error) : null}
          onConfirm={() => update.mutate(latest.version)}
          onCancel={() => setConfirming(false)}
        >
          <ul className="list-disc space-y-1.5 pl-4">
            <li>The database is backed up and verified before anything changes.</li>
            <li>BrewHub is unavailable for about a minute while it restarts. Devices keep controlling temperature on their own.</li>
            <li>If the new version doesn’t start, the previous version and database are restored automatically.</li>
          </ul>
        </ConfirmDialog>
      )}
    </div>
  );
}
