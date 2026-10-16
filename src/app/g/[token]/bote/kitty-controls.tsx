'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import {
  openKittyRound,
  addContributions,
  addSpend,
  closeKittyRound,
  editContribution,
  deleteContribution,
  editSpend,
  deleteSpend,
} from '@/server/actions/kitty';
import { distributeKitty } from '@/domain/kitty';
import { asCents, formatCents, parseAmount } from '@/domain/money';
import { Field } from '@/app/_ui/field';
import { MoneyInput } from '@/app/_ui/money-input';
import { Button } from '@/app/_ui/button';
import { MoneyAmount } from '@/app/_ui/money-amount';
import { SectionLabel } from '@/app/_ui/section-label';
import { DotLeaderRow } from '@/app/_ui/dot-leader-row';
import { TicketCard } from '@/app/_ui/ticket-card';
import { FoldableList } from '@/app/_ui/foldable-list';
import { LIST_ROW } from '@/app/_ui/show-more';
import { Dialog } from '@/app/_ui/dialog';
import { ConfirmDialog } from '@/app/_ui/confirm-dialog';
import { EmptyState } from '@/app/_ui/empty-state';
import { labelSpends, orderContributionsWithLabels } from '@/app/_ui/repeat-labels';
import { formatEuros } from '@/app/_ui/money-format';
import { runClientAction } from '@/app/_ui/run-client-action';
import { useInlineEdit } from '@/app/_ui/use-inline-edit';
import { RoundName } from './round-name';
import type { ActionResult } from '@/server/action-result';

interface ParticipantOption {
  id: string;
  name: string;
}

interface ContributionView {
  id: string;
  participantId: string;
  participantName: string;
  amountCents: number;
}

interface SpendView {
  id: string;
  concept: string;
  amountCents: number;
}

interface OpenRoundView {
  id: string;
  name: string | null;
  carryInCents: number;
  balanceCents: number;
  contributions: ContributionView[];
  spends: SpendView[];
}

function payoutPreview(round: OpenRoundView): { participantId: string; participantName: string; amountCents: number }[] {
  const nameOf = new Map(round.contributions.map((c) => [c.participantId, c.participantName]));
  const byParticipant = new Map<string, number>();
  for (const c of round.contributions) byParticipant.set(c.participantId, (byParticipant.get(c.participantId) ?? 0) + c.amountCents);
  const aggregated = [...byParticipant.entries()].map(([participantId, amountCents]) => ({ participantId, amountCents: asCents(amountCents) }));
  try {
    return distributeKitty(asCents(round.balanceCents), aggregated).map((p) => ({
      participantId: p.participantId,
      participantName: nameOf.get(p.participantId) ?? '',
      amountCents: p.amountCents,
    }));
  } catch {
    return [];
  }
}

/**
 * Inline edit of one bote row: "Editar" swaps the row for its edit panel with
 * focus in the first field; closing the panel (Cancelar or a saved edit) hands
 * focus back to that row's "Editar" once the row's action has settled — its
 * buttons stay disabled while `pending`, and a disabled button takes no focus.
 */
/** A contribution: name, amount, and its own Editar/Eliminar. Editing changes
 * the amount only (fix the person by deleting and re-adding). `displayLabel`
 * numbers repeat contributors ("jose 1"), so it names the row's controls: two
 * rows never share an accessible name. */
function ContributionRow({ token, contribution, displayLabel }: { token: string; contribution: ContributionView; displayLabel: string }) {
  const router = useRouter();
  const stored = formatCents(asCents(contribution.amountCents));
  const [amount, setAmount] = useState(stored);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const edit = useInlineEdit(pending);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(() => editContribution(token, contribution.id, { participantId: contribution.participantId, amount }));
      if (result.ok) { edit.close(); router.refresh(); } else { setError(result.error); }
    });
  }

  function cancel() {
    setAmount(stored);
    setError(null);
    edit.close();
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(() => deleteContribution(token, contribution.id));
      if (result.ok) { setConfirming(false); router.refresh(); } else { setError(result.error); }
    });
  }

  if (edit.editing) {
    return (
      <div ref={edit.panel} className="panel" {...LIST_ROW}>
        <MoneyInput label={`Nuevo importe de ${displayLabel}`} value={amount} onChange={setAmount} />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row-edit-actions">
          <Button size="sm" variant="primary" disabled={pending} onClick={save}>Guardar aporte</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={cancel}>Cancelar</Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <DotLeaderRow
        listRow
        label={displayLabel}
        end={<MoneyAmount cents={asCents(contribution.amountCents)} />}
        actions={
          <>
            <Button ref={edit.editButton} size="sm" variant="ghost" disabled={pending} aria-label={`Editar aporte de ${displayLabel}`} onClick={edit.open}>Editar</Button>
            <Button size="sm" variant="danger" disabled={pending} aria-label={`Eliminar aporte de ${displayLabel}`} onClick={() => { setError(null); setConfirming(true); }}>Eliminar</Button>
          </>
        }
      />
      <ConfirmDialog
        open={confirming}
        title="¿Eliminar este aporte?"
        pending={pending}
        error={error}
        onConfirm={remove}
        onCancel={() => { setConfirming(false); setError(null); }}
      >
        <p className="muted">{displayLabel} · {formatEuros(asCents(contribution.amountCents))}</p>
      </ConfirmDialog>
    </>
  );
}

/** A spend of the bote: concept, amount, and its own Editar/Eliminar; editing
 * changes concept and amount. `displayLabel` numbers a concept bought twice
 * ("Hielo 1"), so it names the row's controls: two spends never share an
 * accessible name. */
function SpendRow({ token, spend, displayLabel }: { token: string; spend: SpendView; displayLabel: string }) {
  const router = useRouter();
  const storedAmount = formatCents(asCents(spend.amountCents));
  const [concept, setConcept] = useState(spend.concept);
  const [amount, setAmount] = useState(storedAmount);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const edit = useInlineEdit(pending);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(() => editSpend(token, spend.id, { concept, amount }));
      if (result.ok) { edit.close(); router.refresh(); } else { setError(result.error); }
    });
  }

  function cancel() {
    setConcept(spend.concept);
    setAmount(storedAmount);
    setError(null);
    edit.close();
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(() => deleteSpend(token, spend.id));
      if (result.ok) { setConfirming(false); router.refresh(); } else { setError(result.error); }
    });
  }

  if (edit.editing) {
    return (
      <div ref={edit.panel} className="panel" {...LIST_ROW}>
        <Field label={`Nuevo concepto del gasto ${displayLabel}`}>
          <input value={concept} onChange={(e) => setConcept(e.target.value)} />
        </Field>
        <MoneyInput label={`Nuevo importe del gasto ${displayLabel}`} value={amount} onChange={setAmount} />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row-edit-actions">
          <Button size="sm" variant="primary" disabled={pending} onClick={save}>Guardar gasto</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={cancel}>Cancelar</Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <DotLeaderRow
        listRow
        label={displayLabel}
        end={<MoneyAmount cents={asCents(-spend.amountCents)} signed />}
        actions={
          <>
            <Button ref={edit.editButton} size="sm" variant="ghost" disabled={pending} aria-label={`Editar gasto ${displayLabel}`} onClick={edit.open}>Editar</Button>
            <Button size="sm" variant="danger" disabled={pending} aria-label={`Eliminar gasto ${displayLabel}`} onClick={() => { setError(null); setConfirming(true); }}>Eliminar</Button>
          </>
        }
      />
      <ConfirmDialog
        open={confirming}
        title="¿Eliminar este gasto del bote?"
        pending={pending}
        error={error}
        onConfirm={remove}
        onCancel={() => { setConfirming(false); setError(null); }}
      >
        <p className="muted">{displayLabel} · {formatEuros(asCents(spend.amountCents))}</p>
      </ConfirmDialog>
    </>
  );
}

/**
 * One form's action state (T-34): every bote form owns its pending flag and
 * its error, so a failure shows next to the form that failed and never
 * disables or overwrites the others.
 */
function useFormAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(work: () => Promise<ActionResult<unknown>>, onOk: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await runClientAction(work);
      if (result.ok) onOk();
      else setError(result.error);
    });
  }
  return { pending, error, run, clearError: () => setError(null) };
}

function OpenRoundForm({ token }: { token: string }) {
  const router = useRouter();
  const { pending, error, run } = useFormAction();
  const [name, setName] = useState('');
  const [preexisting, setPreexisting] = useState('');

  function handleOpen(e: React.FormEvent) {
    e.preventDefault();
    run(
      () => openKittyRound(token, { name: name || undefined, preexisting: preexisting || undefined }),
      () => { setName(''); setPreexisting(''); router.refresh(); },
    );
  }

  return (
    <TicketCard>
      <form onSubmit={handleOpen}>
        <SectionLabel level={2}>Abrir ronda</SectionLabel>
        <Field label="Nombre de la ronda">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sábado" />
        </Field>
        <MoneyInput
          label="Sobrante de otra vez (opcional)"
          value={preexisting}
          onChange={setPreexisting}
        />
        <p className="muted" style={{ marginTop: 4 }}>
          Dinero que ya tenéis sobre la mesa de antes de esta ronda.
        </p>
        {error && <p className="error" role="alert">{error}</p>}
        <div style={{ marginTop: 10 }}>
          <Button type="submit" variant="primary" disabled={pending}>Abrir ronda</Button>
        </div>
      </form>
    </TicketCard>
  );
}

/** One inline amount per active participant, plus a quick-fill for all. */
function ContributeForm({ token, roundId, participants, primary }: {
  token: string; roundId: string; primary: boolean;
  participants: ParticipantOption[];
}) {
  const router = useRouter();
  const { pending, error, run } = useFormAction();
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [fillAmount, setFillAmount] = useState('');

  const filledContributions = participants
    .filter((p) => (amounts[p.id] ?? '').trim() !== '')
    .map((p) => ({ participantId: p.id, amount: amounts[p.id] }));

  function applyToAll() {
    setAmounts(Object.fromEntries(participants.map((p) => [p.id, fillAmount])));
  }

  function handleContribute(e: React.FormEvent) {
    e.preventDefault();
    run(
      () => addContributions(token, roundId, { contributions: filledContributions }),
      () => { setAmounts({}); setFillAmount(''); router.refresh(); },
    );
  }

  return (
    <form onSubmit={handleContribute} className="panel panel--arena">
      <SectionLabel level={3}>Añadir aportes</SectionLabel>
      <div className="quickfill" style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <MoneyInput label="Todos aportan" value={fillAmount} onChange={setFillAmount} />
        {/* It writes every row at once, bypassing each row's own check: only a readable amount is copied. */}
        <Button type="button" variant="ghost" size="sm" disabled={pending || parseAmount(fillAmount) === null} onClick={applyToAll}>
          Todos aportan lo mismo
        </Button>
      </div>
      {participants.map((p) => (
        <MoneyInput
          key={p.id}
          inline
          label={<><span className="sr-only">Aporte de </span>{p.name}</>}
          value={amounts[p.id] ?? ''}
          onChange={(v) => setAmounts((prev) => ({ ...prev, [p.id]: v }))}
        />
      ))}
      {error && <p className="error" role="alert">{error}</p>}
      <div style={{ marginTop: 10 }}>
        <Button type="submit" variant={primary ? 'primary' : 'ghost'} disabled={pending || filledContributions.length === 0}>
          Añadir aportes
        </Button>
      </div>
    </form>
  );
}

function SpendForm({ token, roundId, primary }: { token: string; roundId: string; primary: boolean }) {
  const router = useRouter();
  const { pending, error, run } = useFormAction();
  const [concept, setConcept] = useState('');
  const [amount, setAmount] = useState('');

  function handleSpend(e: React.FormEvent) {
    e.preventDefault();
    run(
      () => addSpend(token, roundId, { concept, amount }),
      () => { setConcept(''); setAmount(''); router.refresh(); },
    );
  }

  return (
    <form onSubmit={handleSpend} className="panel panel--arena">
      <SectionLabel level={3}>Añadir gasto del bote</SectionLabel>
      <Field label="Concepto">
        <input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Cañas" />
      </Field>
      <MoneyInput label="Importe del gasto" value={amount} onChange={setAmount} />
      {error && <p className="error" role="alert">{error}</p>}
      <div style={{ marginTop: 10 }}>
        <Button type="submit" variant={primary ? 'primary' : 'ghost'} disabled={pending}>Añadir gasto</Button>
      </div>
    </form>
  );
}

/**
 * T-43: closing is a choice between three outcomes, not a confirmation, so
 * it stays a plain Dialog with its own error inside (never behind the
 * backdrop) and Cancelar as the safe focus.
 */
function CloseRound({ token, round }: { token: string; round: OpenRoundView }) {
  const router = useRouter();
  const { pending, error, run, clearError } = useFormAction();
  const [closing, setClosing] = useState(false);
  const preview = payoutPreview(round);
  const canDistribute = preview.length > 0;
  const noPayoutReasonId = useId();

  function cancel() {
    setClosing(false);
    clearError();
  }

  function close(action: 'CERRAR' | 'REPARTIR') {
    // Show the round just closed, as its full record.
    run(() => closeKittyRound(token, round.id, { action }), () => { setClosing(false); router.push(`/g/${token}/bote/cerradas`); });
  }

  return (
    <>
      {/* T-42: closing is a secondary act, below the round's everyday forms. */}
      <button type="button" className="btn-dashed close-round-button" onClick={() => setClosing(true)}>
        Cerrar ronda
        <span className="muted">Quedan {formatEuros(asCents(round.balanceCents))} sin gastar</span>
      </button>

      <Dialog open={closing} title="Cerrar la ronda" onClose={cancel}>
        <p className="muted">
          <strong>Cerrar sin repartir</strong>: la ronda se cierra y el sobrante (<MoneyAmount cents={asCents(round.balanceCents)} />) queda como cifra informativa — no se guarda ni se arrastra.
          <br />
          <strong>Repartir</strong>: se reparte todo el saldo entre quienes aportaron esta ronda y el bote queda a cero.
        </p>

        {canDistribute && (
          <div style={{ marginTop: 8 }}>
            <SectionLabel level={3}>Reparto</SectionLabel>
            {preview.map((p) => (
              <DotLeaderRow key={p.participantId} label={p.participantName} end={<MoneyAmount cents={asCents(p.amountCents)} />} />
            ))}
          </div>
        )}

        {/* Same rule as the server (distributeKitty): said, not just a disabled button. */}
        {!canDistribute && (
          <p className="muted" id={noPayoutReasonId}>
            {round.contributions.length === 0 ? 'Nadie ha aportado en esta ronda: no hay nada que repartir.' : 'El bote está a 0 €: no hay nada que repartir.'}
          </p>
        )}

        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => close('CERRAR')}>Cerrar sin repartir</Button>
          <Button variant="dark" size="sm" disabled={pending || !canDistribute} aria-describedby={canDistribute ? undefined : noPayoutReasonId} onClick={() => close('REPARTIR')}>Repartir</Button>
          <Button variant="ghost" size="sm" onClick={cancel} data-autofocus>Cancelar</Button>
        </div>
      </Dialog>
    </>
  );
}

export function KittyControls({
  token,
  participants,
  openRound,
}: {
  token: string;
  participants: ParticipantOption[];
  openRound: OpenRoundView | null;
}) {
  if (!openRound) {
    return (
      <>
        <EmptyState art="gourd">
          <strong>No hay ninguna ronda abierta.</strong> Abre una cuando juntéis dinero para gastos comunes:
          cada persona aporta, los gastos salen del bote y al cerrar decidís si lo que sobra se reparte.
        </EmptyState>
        <OpenRoundForm token={token} />
      </>
    );
  }

  const contributionsSum = openRound.contributions.reduce((sum, c) => sum + c.amountCents, 0);
  const spendsSum = openRound.spends.reduce((sum, s) => sum + s.amountCents, 0);

  const hasMoney = openRound.balanceCents > 0;
  const spend = <SpendForm key="spend" token={token} roundId={openRound.id} primary={hasMoney} />;
  const contribute = (
    <ContributeForm key="contribute" token={token} roundId={openRound.id} participants={participants} primary={!hasMoney} />
  );

  return (
    <section style={{ marginTop: 8 }}>
      <RoundName token={token} roundId={openRound.id} name={openRound.name ?? 'Ronda'}>
        <SectionLabel level={2}>{openRound.name ?? 'Ronda'} · abierta</SectionLabel>
      </RoundName>

      <TicketCard className="ticket--featured ticket--shadow">
        <SectionLabel level={3}>Bote</SectionLabel>
        {openRound.carryInCents > 0 && (
          <DotLeaderRow
            label={<span className="muted">Sobrante de otra vez</span>}
            end={<MoneyAmount cents={asCents(openRound.carryInCents)} />}
          />
        )}
        <DotLeaderRow
          label={<strong>Bote</strong>}
          end={<strong><MoneyAmount cents={asCents(openRound.balanceCents)} signed /></strong>}
        />
      </TicketCard>

      {openRound.contributions.length > 0 && (
        <TicketCard>
          <div className="card-head">
            <SectionLabel level={3}>Aportes</SectionLabel>
            <span className="card-head-meta">{formatEuros(asCents(contributionsSum))} puestos</span>
          </div>
          <FoldableList label="Aportes">
            {orderContributionsWithLabels(openRound.contributions).map((c) => (
              <ContributionRow key={c.id} token={token} contribution={c} displayLabel={c.displayLabel} />
            ))}
          </FoldableList>
          <DotLeaderRow
            label={<strong>Total aportado</strong>}
            end={<strong><MoneyAmount cents={asCents(contributionsSum)} /></strong>}
          />
        </TicketCard>
      )}

      {openRound.spends.length > 0 && (
        <TicketCard>
          <div className="card-head">
            <SectionLabel level={3}>Gastos del bote</SectionLabel>
            <span className="card-head-meta">{formatEuros(asCents(spendsSum))} gastados</span>
          </div>
          <FoldableList label="Gastos del bote">
            {labelSpends(openRound.spends).map((s) => (
              <SpendRow key={s.id} token={token} spend={s} displayLabel={s.displayLabel} />
            ))}
          </FoldableList>
          <DotLeaderRow
            label={<strong>Total gastado</strong>}
            end={<strong><MoneyAmount cents={asCents(-spendsSum)} signed /></strong>}
          />
        </TicketCard>
      )}

      {/* What can be done next comes first, as the main action: with no money a
          spend would be refused, and once there is money spending is the
          frequent act (a round gets one or two contributions, many spends).
          Keyed siblings, so a reorder moves the forms without resetting them. */}
      {hasMoney ? [spend, contribute] : [contribute, spend]}
      <CloseRound token={token} round={openRound} />
    </section>
  );
}
