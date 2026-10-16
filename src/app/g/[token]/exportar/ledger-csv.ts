import { asCents, formatCents, type Cents } from '@/domain/money';
import { computeBalances, filterSettleable, OWNERLESS } from '@/domain/balances';
import { OWNERLESS_NAME, payersDetail } from '@/server/activity-view';
import { dayKey } from '@/app/_ui/dates';
import { byCodePoint, type LedgerExport } from '@/server/queries';

type Share = { participantId: string; amountCents: number };
export type LedgerData = Omit<LedgerExport, 'groupName'>;

type Cell = { text: string } | { amount: number } | null;
type Row = Cell[];

const cents = (shares: Share[]) => shares.map((s) => ({ participantId: s.participantId, amountCents: asCents(s.amountCents) }));

/**
 * A text cell a spreadsheet would run as a formula starts with one of these
 * (OWASP "CSV injection"); a leading apostrophe makes it plain text.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function encode(cell: Cell): string {
  if (cell === null) return '';
  if ('amount' in cell) return formatCents(asCents(cell.amount));
  const text = FORMULA_START.test(cell.text) ? `'${cell.text}` : cell.text;
  return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The reparto ledger as a spreadsheet (T-53): one row per movement, oldest
 * first, and one column per person with that movement's effect on their
 * balance — computed by the domain's own computeBalances on the movement
 * alone, so every row sums to 0 and each column adds up to the "Saldo" row,
 * which is exactly what Saldos shows. Leftover money ("Sobrante") gets its own
 * column and is folded onto the people by filterSettleable, as in the app.
 * Gastos sin pagar never enter the saldo (spec §7.4): they follow in their own
 * block with their own total. Spanish spreadsheet conventions: `;` separator,
 * decimal comma, UTF-8 BOM, CRLF; dates as ISO `YYYY-MM-DD`.
 */
export function ledgerCsv(data: LedgerData): string {
  const ids = data.participants.map((p) => p.id);
  const nameOf = new Map(data.participants.map((p) => [p.id, p.name]));
  const hasOwnerless = data.expenses.some((e) => e.payers.some((p) => p.participantId === null));
  const columns = hasOwnerless ? [...ids, OWNERLESS] : ids;
  const effect = (balances: Map<string, Cents>): Cell[] => columns.map((id) => ({ amount: balances.get(id) ?? 0 }));
  const line = (date: string, kind: string, concept: string, amountCents: number | null, detail: string | null, effects: Cell[]): Row => [
    date ? { text: date } : null,
    { text: kind },
    concept ? { text: concept } : null,
    amountCents === null ? null : { amount: amountCents },
    detail ? { text: detail } : null,
    ...effects,
  ];

  const movements = [
    ...data.expenses.map((e) => ({
      id: e.id,
      date: e.date,
      at: e.createdAt,
      row: line(e.date, 'Gasto', e.title, e.amountCents, payersDetail(e.payers, nameOf),
        effect(computeBalances(ids, [{ payers: e.payers.map((p) => ({ participantId: p.participantId, amountCents: asCents(p.amountCents) })), shares: cents(e.shares) }], []))),
    })),
    ...data.payments.map((p) => {
      const from = nameOf.get(p.fromId);
      const to = nameOf.get(p.toId);
      return {
        id: p.id,
        date: p.date,
        at: p.createdAt,
        row: line(p.date, 'Pago', '', p.amountCents, from && to ? `${from} → ${to}` : null,
          effect(computeBalances(ids, [], [{ fromId: p.fromId, toId: p.toId, amountCents: asCents(p.amountCents) }]))),
      };
    }),
    ...data.refunds.map((r) => {
      const date = dayKey(r.createdAt); // a refund has no picked date: the day it was registered
      const receiver = nameOf.get(r.receivedById);
      return {
        id: r.id,
        date,
        at: r.createdAt,
        row: line(date, 'Reembolso', r.expenseTitle, r.amountCents, receiver ? `recibió ${receiver}` : null,
          effect(computeBalances(ids, [], [], [{ expenseId: '', receivedById: r.receivedById, amountCents: asCents(r.amountCents), shares: cents(r.shares) }]))),
      };
    }),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.at.getTime() - b.at.getTime() || byCodePoint(a.id, b.id));

  // The whole ledger at once, exactly as getGroupOverview computes Saldos.
  const raw = computeBalances(
    ids,
    data.expenses.map((e) => ({ payers: e.payers.map((p) => ({ participantId: p.participantId, amountCents: asCents(p.amountCents) })), shares: cents(e.shares) })),
    data.payments.map((p) => ({ fromId: p.fromId, toId: p.toId, amountCents: asCents(p.amountCents) })),
    data.refunds.map((r) => ({ expenseId: '', receivedById: r.receivedById, amountCents: asCents(r.amountCents), shares: cents(r.shares) })),
  );
  const settleable = filterSettleable(raw, data.participants.map((p) => ({ id: p.id, isArchived: p.archived })));

  const rows: Row[] = [
    [{ text: 'Fecha' }, { text: 'Tipo' }, { text: 'Concepto' }, { text: 'Importe' }, { text: 'Detalle' },
      ...data.participants.map((p) => ({ text: p.name })), ...(hasOwnerless ? [{ text: OWNERLESS_NAME }] : [])],
    ...movements.map((m) => m.row),
  ];
  if (hasOwnerless) {
    const fold = new Map<string, Cents>(ids.map((id) => [id, asCents((settleable.get(id) ?? 0) - (raw.get(id) ?? 0))]));
    fold.set(OWNERLESS, asCents(-(raw.get(OWNERLESS) ?? 0)));
    rows.push(line('', 'Reparto del sobrante', '', null, null, effect(fold)));
  }
  rows.push(line('', 'Saldo', '', null, null, effect(settleable)));

  if (data.charges.length > 0) {
    rows.push([]);
    const owed = (shares: Share[]) => new Map(shares.map((s) => [s.participantId, asCents(-s.amountCents)]));
    const charges = [...data.charges].sort(
      (a, b) => a.date.localeCompare(b.date) || a.createdAt.getTime() - b.createdAt.getTime() || byCodePoint(a.id, b.id),
    );
    for (const c of charges) rows.push(line(c.date, 'Gasto sin pagar', c.concept, c.amountCents, null, effect(owed(c.shares))));
    const total = new Map<string, Cents>();
    for (const s of charges.flatMap((c) => c.shares)) total.set(s.participantId, asCents((total.get(s.participantId) ?? 0) - s.amountCents));
    rows.push(line('', 'Total gastos sin pagar', '', null, null, effect(total)));
  }

  return `﻿${rows.map((row) => row.map(encode).join(';')).join('\r\n')}\r\n`;
}

/** `dividir-<group>-<day>.csv`, ASCII only so every browser and OS keeps it intact. */
export function ledgerFilename(groupName: string, day: string): string {
  const slug = groupName
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `dividir-${slug || 'grupo'}-${day}.csv`;
}
