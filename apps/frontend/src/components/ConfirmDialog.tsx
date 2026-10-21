import { useEffect, useRef, type ReactNode } from "react";

/** Modal confirmation for destructive actions. Escape / backdrop cancel. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  pendingLabel,
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Safe default: focus lands on Cancel, not on the destructive button.
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#140d06]/55 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="modal-panel card w-full max-w-sm space-y-4 p-7 shadow-lift">
        <h2 id="confirm-title" className="font-display text-xl font-semibold text-fg">
          {title}
        </h2>
        <div className="text-sm leading-relaxed text-muted">{children}</div>
        {error && <p className="text-sm text-crit">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button ref={cancelRef} type="button" onClick={onCancel} className="btn-ghost">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={pending} className="btn-danger">
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
