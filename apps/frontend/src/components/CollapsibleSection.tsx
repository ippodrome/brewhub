import { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface Props {
  id: string;
  title: string;
  summary: string;
  open: boolean;
  onToggle: (next: boolean) => void;
  children: ReactNode;
}

/**
 * A Settings card that collapses to its title plus a one-line status.
 * Content stays mounted (its queries keep the summary fresh) but is hidden
 * with the `hidden` attribute while collapsed. That needs no CSS trick or
 * `inert` support, so the header always opens the card in every browser.
 * The header is never disabled: tapping it always toggles.
 */
export function CollapsibleSection({ id, title, summary, open, onToggle, children }: Props): JSX.Element {
  const panelId = useId();

  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onToggle(!open)}
          className="card group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-focus motion-reduce:transition-none"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-display text-xl font-semibold text-fg">{title}</span>
            <span className="mt-0.5 block truncate text-sm text-muted">{summary}</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`h-5 w-5 shrink-0 text-muted transition-transform duration-200 ease-out group-hover:text-fg motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          />
        </button>
      </h2>
      <div id={panelId} role="region" aria-label={title} hidden={!open} className="pt-4">
        {children}
      </div>
    </section>
  );
}
