'use client';
import { Button } from './button';
import { Dialog } from './dialog';

/**
 * D-03, the single confirmation rule: every action that deletes or discards
 * stored state asks here first. Actions undone in place (archive/recover)
 * never ask; deleting the whole group asks for its typed name instead
 * (group-settings.tsx). The error stays inside the dialog, next to the
 * button that failed, so it is never hidden behind the backdrop.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Eliminar',
  confirmVariant = 'danger',
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  confirmLabel?: string;
  confirmVariant?: 'danger' | 'primary';
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} title={title} onClose={onCancel}>
      {children}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <Button variant={confirmVariant} size="sm" disabled={pending} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        {/* The safe choice takes focus, so Enter never deletes by accident. */}
        <Button variant="ghost" size="sm" onClick={onCancel} data-autofocus>
          Cancelar
        </Button>
      </div>
    </Dialog>
  );
}
