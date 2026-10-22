import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { RefreshCw, Sparkles, X } from "lucide-react";
import { useUpdateCheck } from "../hooks/useUpdateCheck";
import { interfaceNeedsReload } from "../lib/update-outcome";

declare const __APP_VERSION__: string;

const DISMISS_KEY = "brewhub_update_dismissed";

/** Quiet one-line notice under the header; dismissible per version. */
export function UpdateBanner(): JSX.Element | null {
  const { pathname } = useLocation();
  const { version, check } = useUpdateCheck();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY));
  const latest = check.data?.latest.version;
  const uiVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
  const installed = version.data?.version;

  // Same rule as the Settings card: only ask for a reload while this tab
  // still runs an older interface than the installed backend.
  if (installed && interfaceNeedsReload(uiVersion, installed)) {
    return (
      <div className="border-b border-ok/20 bg-ok/[0.06]">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-2 text-xs sm:px-8">
          <RefreshCw className="h-3.5 w-3.5 shrink-0 text-ok" strokeWidth={1.75} aria-hidden />
          <p className="min-w-0 flex-1 truncate text-muted">
            <span className="font-semibold text-fg">BrewHub {installed}</span> is installed.
          </p>
          <button type="button" className="font-semibold text-ok hover:underline" onClick={() => window.location.reload()}>
            Reload now
          </button>
        </div>
      </div>
    );
  }
  if (!check.data?.updateAvailable || !latest || dismissed === latest || pathname === "/settings") return null;

  return (
    <div className="border-b border-amber/20 bg-amber/[0.06]">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-2 text-xs sm:px-8">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber" strokeWidth={1.75} aria-hidden />
        <p className="min-w-0 flex-1 truncate text-muted">
          <span className="font-semibold text-fg">BrewHub {latest}</span> is available.
        </p>
        <Link to="/settings#updates" className="font-semibold text-amber hover:underline">
          Review update
        </Link>
        <button
          type="button"
          className="rounded-lg p-1 text-dim hover:bg-tint hover:text-fg"
          aria-label="Dismiss update notice"
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, latest);
            setDismissed(latest);
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
