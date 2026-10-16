'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deletePayment } from '@/server/actions/payments';
import { Button } from '@/app/_ui/button';
import { ConfirmDialog } from '@/app/_ui/confirm-dialog';
import { runClientAction } from '@/app/_ui/run-client-action';

export function DeletePaymentButton({ token, paymentId }: { token: string; paymentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(() => deletePayment(token, paymentId));
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <Button variant="danger" size="sm" aria-label="Eliminar pago" onClick={() => setOpen(true)}>
        Eliminar
      </Button>
      <ConfirmDialog
        open={open}
        title="¿Eliminar este pago?"
        pending={pending}
        error={error}
        onConfirm={confirm}
        onCancel={() => { setOpen(false); setError(null); }}
      />
    </>
  );
}
