'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createPayment } from '@/server/actions/payments';
import { asCents, formatCents } from '@/domain/money';
import { Button } from '@/app/_ui/button';
import { ConfirmDialog } from '@/app/_ui/confirm-dialog';
import { runClientAction } from '@/app/_ui/run-client-action';
import { todayKey } from '@/app/_ui/dates';

export function RegisterPaymentButton({
  token,
  fromId,
  toId,
  amountCents,
}: {
  token: string;
  fromId: string;
  toId: string;
  amountCents: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function register(confirmDuplicate: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(() => createPayment(token, {
        fromId,
        toId,
        amount: formatCents(asCents(amountCents)),
        date: todayKey(),
        confirmDuplicate,
      }));
      if (result.ok) {
        setDuplicate(null);
        router.refresh();
      } else if (result.code === 'DUPLICATE_PAYMENT') {
        setDuplicate(result.error);
      } else {
        setDuplicate(null);
        setError(result.error);
      }
    });
  }

  return (
    <span>
      <Button variant="primary" size="sm" disabled={pending} onClick={() => register(false)}>
        Registrar pago
      </Button>
      {error && <span className="error" role="alert"> {error}</span>}
      <ConfirmDialog
        open={duplicate !== null}
        title="Pago repetido"
        confirmLabel="Registrar igualmente"
        confirmVariant="primary"
        pending={pending}
        onConfirm={() => register(true)}
        onCancel={() => setDuplicate(null)}
      >
        <p className="muted">{duplicate}</p>
      </ConfirmDialog>
    </span>
  );
}
