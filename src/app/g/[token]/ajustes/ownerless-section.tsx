'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setOwnerlessExtra } from '@/server/actions/group';
import type { OwnerlessView } from '@/server/queries';
import { asCents, formatCents, parseAmount } from '@/domain/money';
import { formatEuros } from '@/app/_ui/money-format';
import { MoneyInput } from '@/app/_ui/money-input';
import { Button } from '@/app/_ui/button';
import { ConfirmDialog } from '@/app/_ui/confirm-dialog';
import { SectionLabel } from '@/app/_ui/section-label';
import { runClientAction } from '@/app/_ui/run-client-action';
import { ownerlessStatus } from '../ownerless-status';

/**
 * The one place the group declares its leftover ("Sobrante", D-04). It stores just the total;
 * what is left comes from the server (declared − applied), and applying it is manual, per
 * expense, through the "Sobrante" payer chip. Guardar only takes a positive amount: clearing
 * discards stored state, so it is its own verb, "Vaciar", and asks first (D-03).
 */
export function OwnerlessSection({ token, ownerless }: { token: string; ownerless: OwnerlessView }) {
  const router = useRouter();
  const declared = ownerless.declaredCents > 0;
  const [raw, setRaw] = useState(declared ? formatCents(asCents(ownerless.declaredCents)) : '');
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(() => setOwnerlessExtra(token, { amount: raw }));
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function clear() {
    setClearError(null);
    startTransition(async () => {
      const result = await runClientAction(() => setOwnerlessExtra(token, { amount: '0' }));
      if (result.ok) {
        setConfirmOpen(false);
        setRaw('');
        router.refresh();
      } else {
        setClearError(result.error);
      }
    });
  }

  return (
    <section className="panel" style={{ marginTop: 20 }}>
      <div className="card-head">
        <SectionLabel level={2}>Sobrante de otra vez</SectionLabel>
        {declared && <span className="card-head-meta">{ownerlessStatus(ownerless.remainingCents)}</span>}
      </div>
      <p className="muted">
        Dinero que os sobró de antes. Se aplica en cada gasto eligiendo «Sobrante» como pagador; no se reparte solo.
      </p>
      <form onSubmit={save}>
        <MoneyInput label="Sobrante declarado (€)" value={raw} onChange={setRaw} />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Button type="submit" variant="primary" size="sm" disabled={pending || parseAmount(raw) === null}>
            Guardar sobrante
          </Button>
          {declared && (
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirmOpen(true)}>
              Vaciar
            </Button>
          )}
        </div>
      </form>
      <ConfirmDialog
        open={confirmOpen}
        title="¿Vaciar el sobrante?"
        confirmLabel="Vaciar"
        pending={pending}
        error={clearError}
        onConfirm={clear}
        onCancel={() => {
          setConfirmOpen(false);
          setClearError(null);
        }}
      >
        <p>
          Se borra el sobrante declarado ({formatEuros(asCents(ownerless.declaredCents))}). Los gastos que ya lo usaron
          como pagador no cambian.
        </p>
      </ConfirmDialog>
    </section>
  );
}
