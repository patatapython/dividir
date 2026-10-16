'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { asCents, formatCents, parseAmount } from '@/domain/money';
import { createExpense, updateExpense } from '@/server/actions/expenses';
import type { ExpenseForEdit } from '@/server/queries';
import {
  OWNERLESS_PAYER,
  OWNERLESS_PAYER_NAME,
  initialTicket,
  fromExpenseForEdit,
  ticketTotal,
  togglePayer,
  choosePayer,
  setMultiPayer,
  setPayerAmount,
  payerMismatch,
  addItem,
  removeItem,
  updateItem,
  updateShare,
  previewShares,
  expenseProblems,
  amountIssue,
  toExpenseInput,
  itemSummary,
  type TicketState,
  type ItemRow,
} from './ticket-model';
import { ShareEditor } from './share-editor';
import { ownerlessStatus } from '../ownerless-status';
import { SaveBlockers } from './save-blockers';
import { RowInput } from '@/app/_ui/row-input';
import { formatEuros } from '@/app/_ui/money-format';
import { Field } from '@/app/_ui/field';
import { MoneyInput } from '@/app/_ui/money-input';
import { Button } from '@/app/_ui/button';
import { Chip, ChipRadio } from '@/app/_ui/chip';
import { TicketCard } from '@/app/_ui/ticket-card';
import { SectionLabel } from '@/app/_ui/section-label';
import { DotLeaderRow } from '@/app/_ui/dot-leader-row';
import { MoneyAmount } from '@/app/_ui/money-amount';
import { runClientAction } from '@/app/_ui/run-client-action';
import { unreadableAmountMessage } from '@/server/amount-messages';

/** What one payer of several put in; judged on blur like every amount. */
function PayerAmount({ label, value, onChange }: { label: string; value: string; onChange: (raw: string) => void }) {
  return (
    <RowInput
      label={label}
      value={value}
      onChange={onChange}
      isInvalid={(raw) => amountIssue(raw) === 'invalid'}
      errorText={unreadableAmountMessage(value)}
      unit="€"
    />
  );
}

interface Participant {
  id: string;
  name: string;
  archivedAt: Date | null;
}

function ItemEditor({
  item,
  index,
  solo = false,
  expanded,
  onToggleExpand,
  personCount,
  nameOf,
  canRemove,
  onRemove,
  onPatch,
  onShare,
}: {
  item: ItemRow;
  index: number;
  solo?: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  personCount: number;
  nameOf: (id: string) => string;
  canRemove: boolean;
  onRemove: () => void;
  onPatch: (patch: Partial<Pick<ItemRow, 'label' | 'amountRaw' | 'splitMode'>>) => void;
  onShare: (participantId: string, patch: { included?: boolean; raw?: string }) => void;
}) {
  const amount = parseAmount(item.amountRaw);

  const editorFields = (
    <>
      {!solo && (
        <Field label="Etiqueta del ítem">
          <input value={item.label} onChange={(e) => onPatch({ label: e.target.value })} placeholder="p. ej. Vino" />
        </Field>
      )}
      <MoneyInput label="Importe (€)" hero value={item.amountRaw} onChange={(v) => onPatch({ amountRaw: v })} />
      <ShareEditor
        groupName={`mode-${item.id}`}
        splitMode={item.splitMode}
        shares={item.shares}
        nameOf={nameOf}
        onMode={(mode) => onPatch({ splitMode: mode })}
        onShare={onShare}
      />
      {canRemove && (
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          Quitar línea
        </Button>
      )}
    </>
  );

  // Single-line expense: no card chrome, no label field — just the fields inline.
  if (solo) return editorFields;

  return (
    <div className={expanded ? 'item-card item-card--open' : 'item-card'}>
      <button type="button" className="item-card-head" onClick={onToggleExpand} aria-expanded={expanded}>
        <span>{item.label.trim() || `Línea ${index + 1}`}</span>
        <span className="mono item-card-amount">{amount !== null ? formatEuros(amount) : '—'}</span>
      </button>
      {!expanded && <div className="item-summary">{itemSummary(item, nameOf, personCount)}</div>}
      {expanded && <div className="item-body">{editorFields}</div>}
    </div>
  );
}

export function ExpenseForm({
  token,
  participants,
  claimedId,
  expense,
  expenseId,
  ownerlessRemainingCents,
  today,
}: {
  token: string;
  participants: Participant[];
  claimedId: string | null;
  expense?: ExpenseForEdit;
  expenseId?: string;
  ownerlessRemainingCents?: number;
  /** Default date of a new one: today, taken once on the server so render and hydration agree. */
  today: string;
}) {
  const router = useRouter();
  const personIds = participants.map((p) => p.id);
  const nameOf = (id: string) => participants.find((p) => p.id === id)?.name ?? '';

  const [state, setState] = useState<TicketState>(() =>
    expense
      ? fromExpenseForEdit(expense, personIds)
      : initialTicket(personIds, claimedId && personIds.includes(claimedId) ? claimedId : personIds[0] ?? '', today),
  );
  const [expandedId, setExpandedId] = useState<string | null>(state.items[0]?.id ?? null);
  const [itemSeq, setItemSeq] = useState(state.items.length);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const payerIds = new Set(state.payers.map((p) => p.participantId));
  const total = ticketTotal(state);
  const mismatch = payerMismatch(state);
  const preview = previewShares(state);
  const problems = expenseProblems(state);
  const input = toExpenseInput(state);
  const blockersId = useId();
  const payerGroup = useId();

  function handleAddItem() {
    const id = `item-${itemSeq + 1}`;
    setItemSeq((n) => n + 1);
    setState((s) => addItem(s, id, personIds));
    setExpandedId(id);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!input) return;
    // The model emits amounts as integer cents; the server's expenseSchema parses
    // decimal-comma strings (amountSchema). Convert at the boundary — shareInputs stay numeric.
    const serverInput = {
      title: input.title,
      date: input.date,
      payers: input.payers.map((p) => ({ participantId: p.participantId, amount: formatCents(asCents(p.amount)) })),
      items: input.items.map((it) => ({
        ...(it.label !== undefined ? { label: it.label } : {}),
        amount: formatCents(asCents(it.amount)),
        splitMode: it.splitMode,
        shares: it.shares,
      })),
    };
    startTransition(async () => {
      const result = await runClientAction(async () =>
        expenseId ? updateExpense(token, expenseId, serverInput) : createExpense(token, serverInput),
      );
      // Saved — created or edited — the ledger is where the result shows.
      if (result.ok) {
        router.push(`/g/${token}`);
      } else {
        setError(result.error);
      }
    });
  }

  // Archived people only stay as payers of an expense they already paid; the Sobrante is always there.
  const payerOptions = [
    ...participants.filter((p) => !p.archivedAt || payerIds.has(p.id)).map((p) => ({ id: p.id, name: p.name })),
    { id: OWNERLESS_PAYER, name: OWNERLESS_PAYER_NAME },
  ];

  return (
    <>
      <h2 className="screen-title">{expenseId ? 'Editar gasto' : 'Nuevo gasto'}</h2>
      <form onSubmit={handleSubmit}>
        <TicketCard className="ticket--featured ticket--lima-shadow">
          <Field label="Concepto">
            <input
              value={state.title}
              onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))}
              placeholder="Cena, hotel, taxi…"
              required
            />
          </Field>
          <Field label="Fecha">
            <input type="date" value={state.date} onChange={(e) => setState((s) => ({ ...s, date: e.target.value }))} required />
          </Field>

          {state.items.length === 1 ? (
            <>
              <ItemEditor
                key={state.items[0].id}
                item={state.items[0]}
                index={0}
                solo
                expanded
                onToggleExpand={() => {}}
                personCount={participants.length}
                nameOf={nameOf}
                canRemove={false}
                onRemove={() => {}}
                onPatch={(patch) => setState((s) => updateItem(s, state.items[0].id, patch))}
                onShare={(pid, patch) => setState((s) => updateShare(s, state.items[0].id, pid, patch))}
              />
              <button type="button" className="btn-dashed" style={{ marginTop: 10 }} onClick={handleAddItem}>
                Trocear en líneas
                <span className="muted">p. ej. la cerveza solo de dos</span>
              </button>
            </>
          ) : (
            <>
              <SectionLabel level={3}>Líneas</SectionLabel>
              {state.items.map((item, idx) => (
                <ItemEditor
                  key={item.id}
                  item={item}
                  index={idx}
                  expanded={expandedId === item.id}
                  onToggleExpand={() => setExpandedId((cur) => (cur === item.id ? null : item.id))}
                  personCount={participants.length}
                  nameOf={nameOf}
                  canRemove
                  onRemove={() => setState((s) => removeItem(s, item.id))}
                  onPatch={(patch) => setState((s) => updateItem(s, item.id, patch))}
                  onShare={(pid, patch) => setState((s) => updateShare(s, item.id, pid, patch))}
                />
              ))}
              <button type="button" className="btn-dashed" style={{ marginTop: 2 }} onClick={handleAddItem}>
                + Añadir otra línea
              </button>
            </>
          )}

          <div style={{ borderTop: '2px dashed var(--divider)', marginTop: 14, paddingTop: 12 }}>
            <SectionLabel level={3}>Pagado por</SectionLabel>
            <div className="payer-row" role={state.multiPayer ? 'group' : 'radiogroup'} aria-label="Pagado por">
              {payerOptions.map((p) => {
                const isPayer = payerIds.has(p.id);
                const chipClass = p.id === OWNERLESS_PAYER ? 'chip--nadie' : undefined;
                return (
                  <div key={p.id} className="payer-cell">
                    {state.multiPayer ? (
                      <Chip className={chipClass} on={isPayer} onToggle={() => setState((s) => togglePayer(s, p.id))}>
                        {p.name}
                      </Chip>
                    ) : (
                      <ChipRadio name={payerGroup} className={chipClass} checked={isPayer} onChange={() => setState((s) => choosePayer(s, p.id))}>
                        {p.name}
                      </ChipRadio>
                    )}
                    {isPayer && state.payers.length > 1 && (
                      <PayerAmount
                        label={`Pago de ${p.name}`}
                        value={state.payers.find((pp) => pp.participantId === p.id)?.amountRaw ?? ''}
                        onChange={(raw) => setState((s) => setPayerAmount(s, p.id, raw))}
                      />
                    )}
                    {/* Declared only in Ajustes (D-04); no link here, so the draft is never lost. */}
                    {p.id === OWNERLESS_PAYER &&
                      (ownerlessRemainingCents !== undefined ? (
                        <span className="payer-hint">{ownerlessStatus(ownerlessRemainingCents)}</span>
                      ) : (
                        isPayer && <span className="payer-hint">Para llevar la cuenta, decláralo en Ajustes</span>
                      ))}
                  </div>
                );
              })}
            </div>
            {state.multiPayer ? (
              <div className="payer-mode">
                <span className="muted">Marca quién pagó e indica cuánto puso cada uno.</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setState((s) => setMultiPayer(s, false))}>
                  Un solo pagador
                </Button>
              </div>
            ) : (
              <button type="button" className="btn-dashed" style={{ marginTop: 10 }} onClick={() => setState((s) => setMultiPayer(s, true))}>
                Varios pagadores
                <span className="muted">p. ej. pagasteis a medias</span>
              </button>
            )}
            {mismatch && (
              <p className="error" role="alert">
                Los pagos no cuadran con el total.
              </p>
            )}
          </div>

          <div style={{ borderTop: '2px dashed var(--divider)', marginTop: 12, paddingTop: 10 }}>
            <DotLeaderRow
              label={<strong>TOTAL</strong>}
              end={
                <strong>
                  <MoneyAmount cents={total ?? asCents(0)} />
                </strong>
              }
            />
          </div>
        </TicketCard>

        {preview && (
          <div className="panel" style={{ marginTop: 14 }}>
            <SectionLabel level={3}>Vista previa del reparto</SectionLabel>
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
            Guardar gasto
          </Button>
          <Link className="btn btn--ghost" href={`/g/${token}`}>
            Cancelar
          </Link>
        </div>
      </form>
    </>
  );
}
