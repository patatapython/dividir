'use client';
import { useEffect, useId, useRef } from 'react';

/**
 * The one modal primitive, on the native <dialog> in modal mode (T-30).
 * showModal() makes the page behind inert, so neither Tab nor a click can
 * reach it, and close() hands focus back to the element that opened the
 * dialog. Initial focus goes to the child marked `data-autofocus` (React's
 * autoFocus fires before showModal and never reaches the DOM), else to the
 * first focusable child. The parent owns `open`; when the browser closes the
 * dialog itself (Escape), the native close event reports it through onClose.
 */
export function Dialog({ open, title, onClose, children }: {
  open: boolean; title: string; onClose: () => void; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onClose={() => { if (open) onClose(); }}
      // The body fills the box, so a click that targets the dialog itself landed on the backdrop.
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {open && (
        <div className="dialog-body">
          <h2 id={titleId}>{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
