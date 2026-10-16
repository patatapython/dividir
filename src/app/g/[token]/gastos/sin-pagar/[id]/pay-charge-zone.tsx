'use client';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import type { ActionResult } from '@/server/action-result';
import { Button } from '@/app/_ui/button';
import { ChipRadio } from '@/app/_ui/chip';
import { ConfirmDialog } from '@/app/_ui/confirm-dialog';
import { SectionLabel } from '@/app/_ui/section-label';
import { runClientAction } from '@/app/_ui/run-client-action';

/**
 * "¿Ya lo ha pagado alguien?" (owner review, session 10): when somebody paid the whole charge
 * from their own pocket, it becomes an ordinary expense of theirs with the same
 * split and enters the reparto. It deletes the unpaid charge and cannot be
 * undone in place (going back means deleting the expense and typing the charge
 * again), so by D-03's verb rule it asks first, through the one ConfirmDialog,
 * with its error inside it.
 *
 * `action` is `payGroupCharge` bound to the token and charge by the server page.
 */
export function PayChargeZone({ concept, people, action, redirectTo }: {
  concept: string;
  people: { id: string; name: string }[];
  action: (input: { payerId: string }) => Promise<ActionResult<{ expenseId: string }>>;
  redirectTo: string;
}) {
  const router = useRouter();
  const group = useId();
  const [payerId, setPayerId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const payer = people.find((p) => p.id === payerId);

  function handlePay() {
    if (!payerId) return;
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(() => action({ payerId }));
      if (result.ok) router.push(redirectTo);
      else setError(result.error); // shown inside the still-open dialog
    });
  }

  return (
    <section className="panel pay-charge" aria-labelledby={`${group}-title`}>
      <SectionLabel level={2}><span id={`${group}-title`}>¿Ya lo ha pagado alguien?</span></SectionLabel>
      <p className="muted">
        Si una persona lo pagó entero de su bolsillo, pasa a ser un gasto normal pagado por ella, con el mismo
        reparto: entra en los saldos y cada uno le debe su parte.
      </p>
      <div className="payer-row" role="radiogroup" aria-label="Lo pagó">
        {people.map((p) => (
          <ChipRadio key={p.id} name={group} checked={p.id === payerId} onChange={() => setPayerId(p.id)}>
            {p.name}
          </ChipRadio>
        ))}
      </div>
      <div className="pay-charge-action">
        <Button
          type="button"
          variant="dark"
          disabled={!payer || pending}
          aria-describedby={payer ? undefined : `${group}-why`}
          onClick={() => { setError(null); setConfirming(true); }}
        >
          {payer ? `Lo pagó ${payer.name}` : 'Lo pagó…'}
        </Button>
        {!payer && <span id={`${group}-why`} className="muted">Elige quién lo pagó.</span>}
      </div>
      {payer && (
        <ConfirmDialog
          open={confirming}
          title={`¿Lo pagó ${payer.name}?`}
          confirmLabel={`Sí, lo pagó ${payer.name}`}
          confirmVariant="primary"
          pending={pending}
          error={error}
          onConfirm={handlePay}
          onCancel={() => { setConfirming(false); setError(null); }}
        >
          <p>
            «{concept}» deja de estar sin pagar y pasa a ser un gasto pagado por {payer.name}, con el mismo reparto:
            cada uno le debe su parte.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
