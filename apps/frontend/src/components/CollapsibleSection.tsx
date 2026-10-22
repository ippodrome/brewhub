import { useEffect, useId, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  id: string;
  title: string;
  summary: string;
  open: boolean;
  /** When set, the section is pinned open and the toggle is disabled. */
  locked?: boolean;
  onToggle: (next: boolean) => void;
  children: ReactNode;
}

/**
 * A Settings card that collapses to its title plus a one-line status.
 * Content stays mounted (its queries keep the summary fresh) but is made
 * inert while collapsed so it can't be tabbed into or read out.
 */
export function CollapsibleSection({ id, title, summary, open, locked = false, onToggle, children }: Props): JSX.Element {
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const expanded = open || locked;

  useEffect(() => {
    panelRef.current?.toggleAttribute("inert", !expanded);
  }, [expanded]);

  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-disabled={locked || undefined}
          onClick={() => !locked && onToggle(!expanded)}
          className="card group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-focus motion-reduce:transition-none"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-display text-xl font-semibold text-fg">{title}</span>
            <span className="mt-0.5 block truncate text-sm text-muted">{summary}</span>
          </span>
          {!locked && (
            <ChevronDown
              aria-hidden="true"
              className={`h-5 w-5 shrink-0 text-muted transition-transform duration-200 ease-out group-hover:text-fg motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
            />
          )}
        </button>
      </h2>
      <div
        id={panelId}
        ref={panelRef}
        role="region"
        aria-label={title}
        aria-hidden={!expanded}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pt-4">{children}</div>
        </div>
      </div>
    </section>
  );
}
