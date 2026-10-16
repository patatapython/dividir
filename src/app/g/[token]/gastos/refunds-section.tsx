'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createRefund, deleteRefund } from '@/server/actions/refunds';
import { asCents } from '@/domain/money';
import { Field } from '@/app/_ui/field';
import { MoneyInput } from '@/app/_ui/money-input';
import { Button } from '@/app/_ui/button';
import { TicketCard } from '@/app/_ui/ticket-card';
import { SectionLabel } from '@/app/_ui/section-label';
import { DotLeaderRow } from '@/app/_ui/dot-leader-row';
import { MoneyAmount } from '@/app/_ui/money-amount';
import { ConfirmDialog } from '@/app/_ui/confirm-dialog';
import { runClientAction } from '@/app/_ui/run-client-action';
import { formatDay } from '@/app/_ui/dates';

interface RefundView {
  id: string;
  receivedById: string;
  receivedByName: string;
  amountCents: number;
  createdAt: Date;
}

interface Person {
  id: string;
  name: string;
}


export function RefundsSection({
  token,
  expenseId,
  refunds,
  persons,
  defaultReceiverId,
}: {
  token: string;
  expenseId: string;
  refunds: RefundView[];
  persons: Person[];
  defaultReceiverId: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  // Clamp to a real <option> so the controlled select never shows one person while submitting another.
  const [receiverId, setReceiverId] = useState(
    persons.some((p) => p.id === defaultReceiverId) ? defaultReceiverId : persons[0]?.id ?? '',
  );
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(() => createRefund(token, { expenseId, receivedById: receiverId, amount }));
      if (result.ok) {
        setAdding(false);
        setAmount('');
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function confirmDelete() {
    if (!deleteId) return;
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(() => deleteRefund(token, deleteId));
      if (result.ok) {
        setDeleteId(null);
        router.refresh();
      } else {
        setError(result.error); // shown inside the still-open dialog
      }
    });
  }

  return (
    <section style={{ marginTop: 20 }}>
      <SectionLabel level={3}>Devoluciones</SectionLabel>
      {refunds.map((r) => (
        <TicketCard key={r.id}>
          <DotLeaderRow
            label={<strong>Devolución</strong>}
            end={<strong><MoneyAmount cents={asCents(r.amountCents)} /></strong>}
          />
          <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span>
              recibió {r.receivedByName} · {formatDay(r.createdAt)}
            </span>
            <Button variant="danger" size="sm" onClick={() => setDeleteId(r.id)}>
              Eliminar
            </Button>
          </div>
        </TicketCard>
      ))}

      {adding ? (
        <form onSubmit={submit} className="panel" style={{ marginTop: 10 }}>
          <Field label="Recibida por">
            <select value={receiverId} onChange={(e) => setReceiverId(e.target.value)}>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <MoneyInput label="Importe devuelto (€)" value={amount} onChange={setAmount} />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              Registrar devolución
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setAdding(false); setError(null); }}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
          Registrar devolución
        </Button>
      )}

      <ConfirmDialog
        open={deleteId !== null}
        title="¿Eliminar esta devolución?"
        pending={pending}
        error={error}
        onConfirm={confirmDelete}
        onCancel={() => { setDeleteId(null); setError(null); }}
      >
        <p className="muted">El importe volverá a repartirse entre los beneficiarios originales.</p>
      </ConfirmDialog>
    </section>
  );
}
