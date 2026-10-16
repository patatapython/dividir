'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ActionResult } from '@/server/action-result';
import { Button } from './button';
import { ConfirmDialog } from './confirm-dialog';
import { runClientAction } from './run-client-action';

/**
 * The place a stored entity is deleted from: the END of its page, apart from the form that saves it, so
 * "delete" is never the neighbour of "save". It asks through the single ConfirmDialog (D-03) and, once
 * the entity is gone, leaves for `redirectTo` — the page it was on no longer exists.
 *
 * `action` is a server action bound to its arguments by the server page (`deleteExpense.bind(null, …)`).
 */
export function DeleteZone({ label, confirmTitle, action, redirectTo }: {
  label: string;
  confirmTitle: string;
  action: () => Promise<ActionResult<unknown>>;
  redirectTo: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(action);
      if (result.ok) router.push(redirectTo);
      else setError(result.error); // shown inside the still-open dialog
    });
  }

  return (
    <section className="delete-zone" aria-label={label}>
      <Button type="button" variant="danger" onClick={() => { setError(null); setConfirming(true); }}>
        {label}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={confirmTitle}
        pending={pending}
        error={error}
        onConfirm={handleConfirm}
        onCancel={() => { setConfirming(false); setError(null); }}
      />
    </section>
  );
}
