import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Sparkles, X } from "lucide-react";
import { useUpdateCheck } from "../hooks/useUpdateCheck";

const DISMISS_KEY = "brewhub_update_dismissed";

/** Quiet one-line notice under the header; dismissible per version. */
export function UpdateBanner(): JSX.Element | null {
  const { pathname } = useLocation();
  const { check } = useUpdateCheck();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY));
  const latest = check.data?.latest.version;
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
