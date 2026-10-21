import { useEffect, useId, useRef, useState } from "react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  destructive?: boolean;
}

/**
 * A small "⋯" menu for secondary and destructive actions, so a card's
 * action row stays one consistent line instead of wrapping a lone
 * "Remove" onto its own row.
 */
export function OverflowMenu({ label, items }: { label: string; items: MenuItem[] }): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent): void {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    // Move focus into the menu for keyboard users.
    rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="icon-btn"
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={2} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="modal-panel absolute right-0 top-full z-30 mt-1.5 min-w-[13rem] origin-top-right rounded-2xl border border-line bg-card p-1.5 shadow-lift"
        >
          {items.map(({ label: itemLabel, icon: Icon, onSelect, destructive }, i) => (
            <button
              key={itemLabel}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSelect();
              }}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm ${
                destructive ? "text-crit hover:bg-crit/10" : "text-fg hover:bg-tint"
              } ${destructive && i > 0 ? "mt-1 border-t border-line pt-3" : ""}`}
            >
              {Icon && <Icon className="h-4 w-4" strokeWidth={2} />}
              {itemLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
