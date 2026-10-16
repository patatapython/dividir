'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { asCents, formatCents } from '@/domain/money';
import { createGroupCharge, updateGroupCharge } from '@/server/actions/group-charge';
import { ShareEditor } from './share-editor';
import { SaveBlockers } from './save-blockers';
import {
  initialCharge,
  fromChargeForEdit,
  setSplitMode,
  updateChargeShare,
  chargePreview,
  chargeProblems,
  toChargeInput,
  type ChargeState,
  type ChargeForEditModel,
} from './charge-model';
import { Field } from '@/app/_ui/field';
import { MoneyInput } from '@/app/_ui/money-input';
import { Button } from '@/app/_ui/button';
import { TicketCard } from '@/app/_ui/ticket-card';
import { SectionLabel } from '@/app/_ui/section-label';
import { DotLeaderRow } from '@/app/_ui/dot-leader-row';
import { MoneyAmount } from '@/app/_ui/money-amount';
import { runClientAction } from '@/app/_ui/run-client-action';

interface Participant {
  id: string;
  name: string;
  archivedAt: Date | null;
}

export function ChargeForm({
  token,
  participants,
  charge,
  chargeId,
  today,
}: {
  token: string;
  participants: Participant[];
  charge?: ChargeForEditModel;
  chargeId?: string;
  /** Default date of a new one: today, taken once on the server so render and hydration agree. */
  today: string;
}) {
  const router = useRouter();
  const personIds = participants.map((p) => p.id);
  const nameOf = (id: string) => participants.find((p) => p.id === id)?.name ?? '';

  const [state, setState] = useState<ChargeState>(() =>
    charge ? fromChargeForEdit(charge, personIds) : initialCharge(personIds, today),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const preview = chargePreview(state);
  const problems = chargeProblems(state);
  const input = toChargeInput(state);
  const blockersId = useId();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!input) return;
    // The model emits integer cents; the server groupChargeSchema parses a
    // decimal-comma string (amountSchema). Convert at the boundary — same as
    // the expense form. shareInputs stay numeric.
    const serverInput = {
      concept: input.concept,
      date: input.date,
      amount: formatCents(asCents(input.amount)),
      splitMode: input.splitMode,
      shares: input.shares,
    };
    startTransition(async () => {
      const result = await runClientAction(async () =>
        chargeId ? updateGroupCharge(token, chargeId, serverInput) : createGroupCharge(token, serverInput),
      );
      // Saved — created or edited — the ledger is where the result shows.
      if (result.ok) {
        router.push(`/g/${token}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <h2 className="screen-title">{chargeId ? 'Editar gasto sin pagar' : 'Nuevo gasto sin pagar'}</h2>
      <p className="muted" style={{ marginTop: 4, marginBottom: 8 }}>
        Un coste que nadie ha pagado y se debe pagar fuera (p. ej. la casa rural). No entra en el reparto entre vosotros.
      </p>
      <form onSubmit={handleSubmit}>
        <TicketCard className="ticket--featured">
          <Field label="Concepto">
            <input
              value={state.concept}
              onChange={(e) => setState((s) => ({ ...s, concept: e.target.value }))}
              placeholder="Casa rural, entradas…"
              required
            />
          </Field>
          <Field label="Fecha">
            <input type="date" value={state.date} onChange={(e) => setState((s) => ({ ...s, date: e.target.value }))} required />
          </Field>
          <MoneyInput
            label="Importe (€)"
            hero
            value={state.amountRaw}
            onChange={(v) => setState((s) => ({ ...s, amountRaw: v }))}
          />

          <SectionLabel level={3}>Reparto</SectionLabel>
          <ShareEditor
            groupName="charge-mode"
            splitMode={state.splitMode}
            shares={state.shares}
            nameOf={nameOf}
            onMode={(mode) => setState((s) => setSplitMode(s, mode))}
            onShare={(pid, patch) => setState((s) => updateChargeShare(s, pid, patch))}
          />
        </TicketCard>

        {preview && (
          <div className="panel" style={{ marginTop: 14 }}>
            <SectionLabel level={3}>Cada uno debe fuera</SectionLabel>
            {preview.rows.map((r) => (
              <DotLeaderRow key={r.participantId} label={nameOf(r.participantId)} end={<MoneyAmount cents={r.amountCents} />} />
            ))}
          </div>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <SaveBlockers id={blockersId} problems={problems} nameOf={nameOf} />
        <div className="form-actions">
          <Button
            type="submit"
            variant="primary"
            disabled={!input || pending}
            aria-describedby={problems.length > 0 ? blockersId : undefined}
          >
            Guardar gasto sin pagar
          </Button>
          <Link className="btn btn--ghost" href={`/g/${token}`}>
            Cancelar
          </Link>
        </div>
      </form>
    </>
  );
}
