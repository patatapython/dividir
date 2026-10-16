import { Cents, MAX_AMOUNT_CENTS, asCents, formatCents, parseAmount, parseSignedAmount } from '@/domain/money';
import { computeShares, aggregateItemShares, type SplitMode, type ShareInput, type ItemShares } from '@/domain/split';
import { DomainError } from '@/domain/errors';
import { formatEuros, formatSignedEuros } from '@/app/_ui/money-format';
import type { ExpenseForEdit } from '@/server/queries';

/**
 * Sentinel payer id for the ownerless payer (spec §7.1). It
 * lives only in the form model: toExpenseInput maps it to a null participantId
 * (what the server stores) and fromExpenseForEdit maps null back to it, so the
 * rest of the payer logic treats it like any other payer with no null checks.
 */
export const OWNERLESS_PAYER = '__ownerless__';

/** The ownerless payer's one name in the interface (D-04): real money left over from before. */
export const OWNERLESS_PAYER_NAME = 'Sobrante';

export const MODE_LABELS: Record<SplitMode, string> = {
  EQUAL: 'A partes iguales',
  SHARES: 'Por partes',
  PERCENTAGE: 'Por porcentaje',
  EXACT: 'Importes exactos',
  ADJUSTMENT: 'Ajuste (+/-)',
};

/** Every split mode, in the order the forms offer them. */
export const SPLIT_MODES = Object.keys(MODE_LABELS) as SplitMode[];

export interface ShareRow {
  participantId: string;
  included: boolean;
  raw: string; // user text
}

export interface ItemRow {
  id: string;
  label: string;
  amountRaw: string;
  splitMode: SplitMode;
  shares: ShareRow[];
}

export interface PayerRow {
  participantId: string;
  amountRaw: string;
}

export interface TicketState {
  title: string;
  date: string;
  items: ItemRow[];
  payers: PayerRow[];
  /**
   * Several payers is an explicit mode (T-47). Off, a payer chip REPLACES the payer, one tap;
   * on, chips toggle and each payer says how much. One payer always pays the whole total.
   */
  multiPayer: boolean;
}

export interface ExpenseInput {
  title: string;
  date: string;
  payers: { participantId: string | null; amount: number }[];
  items: { label?: string; amount: number; splitMode: SplitMode; shares: { participantId: string; shareInput: number }[] }[];
}

function newItem(id: string, personIds: string[]): ItemRow {
  return {
    id,
    label: '',
    amountRaw: '',
    splitMode: 'EQUAL',
    shares: personIds.map((participantId) => ({ participantId, included: true, raw: '' })),
  };
}

export function initialTicket(personIds: string[], defaultPayerId: string, today: string): TicketState {
  return {
    title: '',
    date: today,
    items: [newItem('item-1', personIds)],
    payers: [{ participantId: defaultPayerId, amountRaw: '' }],
    multiPayer: false,
  };
}

/** Reconstructs the raw user text for one share from its stored shareInput. */
export function rawFromShareInput(mode: SplitMode, shareInput: number | undefined): string {
  if (shareInput === undefined) return '';
  switch (mode) {
    case 'EQUAL':
      return '';
    case 'SHARES':
      return String(shareInput);
    case 'PERCENTAGE':
    case 'EXACT':
    case 'ADJUSTMENT':
      return formatCents(asCents(shareInput)); // formatCents renders the sign for ADJUSTMENT deltas
  }
}

export function fromExpenseForEdit(e: ExpenseForEdit, personIds: string[]): TicketState {
  return {
    title: e.title,
    date: e.date,
    items: e.items.map((item, idx) => {
      const byParticipant = new Map(item.shares.map((s) => [s.participantId, s.shareInput]));
      return {
        id: `item-${idx + 1}`,
        label: item.label ?? '',
        amountRaw: formatCents(asCents(item.amountCents)),
        splitMode: item.splitMode,
        shares: personIds.map((participantId) => {
          const shareInput = byParticipant.get(participantId);
          // Every mode includes exactly the stored shares: a later joiner (or someone archived
          // before the expense) stays out, as the split was saved.
          const included = shareInput !== undefined;
          return { participantId, included, raw: rawFromShareInput(item.splitMode, shareInput) };
        }),
      };
    }),
    payers: e.payers.map((p) => ({ participantId: p.participantId ?? OWNERLESS_PAYER, amountRaw: formatCents(asCents(p.amountCents)) })),
    multiPayer: e.payers.length > 1,
  };
}

export function ticketTotal(s: TicketState): Cents | null {
  let sum = 0;
  for (const item of s.items) {
    const cents = parseAmount(item.amountRaw);
    if (cents === null) return null;
    sum += cents;
  }
  return asCents(sum);
}

/** Simple mode: the chosen payer replaces the current one. */
export function choosePayer(s: TicketState, participantId: string): TicketState {
  return { ...s, payers: [{ participantId, amountRaw: '' }] };
}

/** Several-payer mode: a chip adds or removes a payer (never the last one). */
export function togglePayer(s: TicketState, participantId: string): TicketState {
  const isPayer = s.payers.some((p) => p.participantId === participantId);
  if (isPayer) {
    if (s.payers.length <= 1) return s; // min 1
    return { ...s, multiPayer: true, payers: s.payers.filter((p) => p.participantId !== participantId) };
  }
  return { ...s, multiPayer: true, payers: [...s.payers, { participantId, amountRaw: '' }] };
}

/** Enters several-payer mode keeping the payer, or goes back to the first payer alone. */
export function setMultiPayer(s: TicketState, on: boolean): TicketState {
  if (on) return { ...s, multiPayer: true };
  return { ...s, multiPayer: false, payers: [{ participantId: s.payers[0].participantId, amountRaw: '' }] };
}

export function setPayerAmount(s: TicketState, participantId: string, raw: string): TicketState {
  return {
    ...s,
    payers: s.payers.map((p) => (p.participantId === participantId ? { ...p, amountRaw: raw } : p)),
  };
}

export function effectivePayerAmounts(s: TicketState): { participantId: string; amountCents: Cents }[] | null {
  if (s.payers.length === 1) {
    const total = ticketTotal(s);
    if (total === null) return null;
    return [{ participantId: s.payers[0].participantId, amountCents: total }];
  }
  const out: { participantId: string; amountCents: Cents }[] = [];
  for (const p of s.payers) {
    const cents = parseAmount(p.amountRaw);
    if (cents === null) return null;
    out.push({ participantId: p.participantId, amountCents: cents });
  }
  return out;
}

export function payerMismatch(s: TicketState): { payersSum: Cents; total: Cents } | null {
  const total = ticketTotal(s);
  const payers = effectivePayerAmounts(s);
  if (total === null || payers === null) return null; // incomplete, not a mismatch
  const payersSum = payers.reduce((acc, p) => acc + p.amountCents, 0);
  if (payersSum === total) return null;
  return { payersSum: asCents(payersSum), total };
}

export function addItem(s: TicketState, id: string, personIds: string[]): TicketState {
  return { ...s, items: [...s.items, newItem(id, personIds)] };
}

export function removeItem(s: TicketState, id: string): TicketState {
  if (s.items.length <= 1) return s; // min 1
  return { ...s, items: s.items.filter((i) => i.id !== id) };
}

export function updateItem(
  s: TicketState,
  id: string,
  patch: Partial<Pick<ItemRow, 'label' | 'amountRaw' | 'splitMode'>>,
): TicketState {
  return {
    ...s,
    items: s.items.map((item) => {
      if (item.id !== id) return item;
      const next: ItemRow = { ...item, ...patch };
      if (patch.splitMode !== undefined && patch.splitMode !== item.splitMode) {
        next.shares = item.shares.map((r) => ({ ...r, included: true, raw: '' }));
      }
      return next;
    }),
  };
}

export function updateShare(
  s: TicketState,
  itemId: string,
  participantId: string,
  patch: Partial<Pick<ShareRow, 'included' | 'raw'>>,
): TicketState {
  return {
    ...s,
    items: s.items.map((item) =>
      item.id !== itemId
        ? item
        : { ...item, shares: item.shares.map((r) => (r.participantId === participantId ? { ...r, ...patch } : r)) },
    ),
  };
}

/** A row's text read in its split mode, or null when it cannot be read. EQUAL rows carry no text. */
function parseShareRaw(mode: SplitMode, raw: string): number | null {
  const text = raw.trim();
  switch (mode) {
    case 'EQUAL':
      return 1;
    case 'SHARES': // bounded like every stored value (the server refuses more)
      return /^\d+$/.test(text) && Number(text) <= MAX_AMOUNT_CENTS ? Number(text) : null;
    case 'PERCENTAGE': // hundredths of a percent
    case 'EXACT': // cents
      return parseAmount(text);
    case 'ADJUSTMENT': // a blank delta reads as 0
      return text === '' ? 0 : parseSignedAmount(text);
  }
}

/** What stops a typed value from being read: nothing typed yet, or text that is not a value. */
export type ValueIssue = 'empty' | 'invalid';

export function amountIssue(raw: string): ValueIssue | null {
  if (raw.trim() === '') return 'empty';
  return parseAmount(raw) === null ? 'invalid' : null;
}

/**
 * The issue of one share row in its mode. Rows that carry no value (EQUAL, unticked) and blank
 * adjustments (read as 0) are never an issue.
 */
export function shareRowIssue(mode: SplitMode, row: ShareRow): ValueIssue | null {
  if (mode === 'EQUAL' || !row.included) return null;
  if (mode !== 'ADJUSTMENT' && row.raw.trim() === '') return 'empty';
  return parseShareRaw(mode, row.raw) === null ? 'invalid' : null;
}

/** The inline verdict of an unreadable row, with the example the removed placeholders used to give. */
export const SHARE_ROW_ERROR: Record<Exclude<SplitMode, 'EQUAL'>, string> = {
  SHARES: 'Escribe un número entero (ejemplo: 2)',
  PERCENTAGE: 'Porcentaje no válido (ejemplo: 33,33)',
  EXACT: 'Importe no válido (ejemplo: 12,50)',
  ADJUSTMENT: 'Ajuste no válido (ejemplo: -5,00)',
};

/**
 * Why a form cannot be saved yet. Each problem is structured (who, by how much) so the form can say it
 * precisely; `line` names the expense line when the ticket has several. The same list that explains the
 * disabled "Guardar" is the one that disables it: an input exists exactly when the list is empty.
 */
export type SplitProblem =
  | { kind: 'amount-missing' }
  | { kind: 'amount-invalid' }
  | { kind: 'nobody' }
  | { kind: 'shares-missing'; participantIds: string[] }
  | { kind: 'shares-invalid'; participantIds: string[] }
  | { kind: 'percent-sum'; sum: number }
  | { kind: 'exact-sum'; sum: number; total: number }
  | { kind: 'adjustment-sum'; sum: number }
  | { kind: 'adjustment-negative' }
  | { kind: 'shares-zero' }
  | { kind: 'split-invalid' };

export type FormProblem = (
  | SplitProblem
  | { kind: 'title-missing' }
  | { kind: 'date-missing' }
  | { kind: 'payers-missing'; participantIds: string[] }
  | { kind: 'payers-invalid'; participantIds: string[] }
  | { kind: 'payers-mismatch'; payersSum: number; total: number }
  | { kind: 'total-too-large' }
) & { line?: string };

export type ItemCheck =
  | { ok: true; total: Cents; inputs: ShareInput[]; shares: ReturnType<typeof computeShares> }
  | { ok: false; problems: SplitProblem[] };

/** Reads one amount and its split. Also used for an unpaid charge, which splits like a single line. */
export function checkItem(item: ItemRow): ItemCheck {
  const problems: SplitProblem[] = [];
  const total = parseAmount(item.amountRaw);
  const amount = amountIssue(item.amountRaw);
  if (amount) problems.push({ kind: amount === 'empty' ? 'amount-missing' : 'amount-invalid' });

  if (!item.shares.some((r) => r.included)) {
    problems.push({ kind: 'nobody' });
  }
  const withIssue = (issue: ValueIssue) =>
    item.shares.filter((r) => shareRowIssue(item.splitMode, r) === issue).map((r) => r.participantId);
  const missing = withIssue('empty');
  const invalid = withIssue('invalid');
  if (missing.length > 0) problems.push({ kind: 'shares-missing', participantIds: missing });
  if (invalid.length > 0) problems.push({ kind: 'shares-invalid', participantIds: invalid });
  if (total === null || problems.length > 0) return { ok: false, problems };

  const inputs: ShareInput[] = item.shares
    .filter((r) => r.included)
    .map((r) => ({ participantId: r.participantId, shareInput: parseShareRaw(item.splitMode, r.raw) as number }));
  const sum = inputs.reduce((acc, i) => acc + i.shareInput, 0);
  try {
    return { ok: true, total, inputs, shares: computeShares(item.splitMode, total, inputs) };
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    return { ok: false, problems: [splitMissProblem(err, sum, total)] };
  }
}

/** Every DomainError computeShares can raise on readable rows, as the figure the user has to fix. */
function splitMissProblem(err: DomainError, sum: number, total: Cents): SplitProblem {
  switch (err.code) {
    case 'PERCENT_SUM_MISMATCH':
      return { kind: 'percent-sum', sum };
    case 'EXACT_SUM_MISMATCH':
      return { kind: 'exact-sum', sum, total };
    case 'DELTA_SUM_NONZERO':
      return { kind: 'adjustment-sum', sum };
    case 'NEGATIVE_WEIGHT': // readable rows are never negative, so only an adjustment below zero lands here
      return { kind: 'adjustment-negative' };
    case 'ZERO_WEIGHT_SUM':
      return { kind: 'shares-zero' };
    default:
      return { kind: 'split-invalid' }; // e.g. an amount too large to be exact: user input never crashes the form
  }
}

function lineName(item: ItemRow, index: number): string {
  return item.label.trim() || `Línea ${index + 1}`;
}

export function expenseProblems(s: TicketState): FormProblem[] {
  const problems: FormProblem[] = [];
  if (s.title.trim() === '') problems.push({ kind: 'title-missing' });
  if (s.date === '') problems.push({ kind: 'date-missing' });
  const several = s.items.length > 1;
  s.items.forEach((item, index) => {
    const check = checkItem(item);
    if (check.ok) return;
    for (const p of check.problems) problems.push(several ? { ...p, line: lineName(item, index) } : p);
  });
  // Each line is within the ceiling by itself; together they must be too (the server refuses more).
  const lineTotals = s.items.map((item) => parseAmount(item.amountRaw));
  if (lineTotals.every((t) => t !== null) && lineTotals.reduce((a, t) => a + (t as number), 0) > MAX_AMOUNT_CENTS) {
    problems.push({ kind: 'total-too-large' });
  }

  if (s.payers.length > 1) {
    const payersWith = (issue: ValueIssue) =>
      s.payers.filter((p) => amountIssue(p.amountRaw) === issue).map((p) => p.participantId);
    const missing = payersWith('empty');
    const invalid = payersWith('invalid');
    if (missing.length > 0) problems.push({ kind: 'payers-missing', participantIds: missing });
    if (invalid.length > 0) problems.push({ kind: 'payers-invalid', participantIds: invalid });
  }
  const mismatch = payerMismatch(s);
  if (mismatch) problems.push({ kind: 'payers-mismatch', ...mismatch });
  return problems;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** Hundredths of a percent as the user writes them: 6000 → "60", 3333 → "33,33". */
function formatPercent(hundredths: number): string {
  return formatCents(asCents(hundredths)).replace(/,00$/, '');
}

/**
 * One problem as a sentence. What is still missing is said as missing; an unreadable value asks to be
 * completed OR corrected, because this list is live and "12," may just be a value still being typed.
 */
export function describeProblem(p: FormProblem, nameOf: (id: string) => string): string {
  const names = (ids: string[]) => joinNames(ids.map((id) => (id === OWNERLESS_PAYER ? OWNERLESS_PAYER_NAME : nameOf(id))));
  const text = ((): string => {
    switch (p.kind) {
      case 'title-missing':
        return 'Falta el concepto.';
      case 'date-missing':
        return 'Falta la fecha.';
      case 'amount-missing':
        return 'Falta el importe.';
      case 'amount-invalid':
        return 'Completa o corrige el importe.';
      case 'nobody':
        return 'Marca al menos a una persona.';
      case 'shares-missing':
        return `Falta la parte de ${names(p.participantIds)}.`;
      case 'shares-invalid':
        return `Completa o corrige la parte de ${names(p.participantIds)}.`;
      case 'percent-sum':
        return `Los porcentajes suman ${formatPercent(p.sum)} %; deben sumar 100 %.`;
      case 'exact-sum':
        return `Las partes suman ${formatEuros(asCents(p.sum))} y el importe es ${formatEuros(asCents(p.total))}.`;
      case 'adjustment-sum':
        return `Los ajustes suman ${formatSignedEuros(asCents(p.sum))}; deben sumar 0.`;
      case 'adjustment-negative':
        return 'Un ajuste deja a alguien por debajo de 0 €.';
      case 'shares-zero':
        return 'Las partes suman 0; al menos una debe ser mayor.';
      case 'split-invalid':
        return 'Este reparto no se puede calcular; revisa los importes.';
      case 'payers-missing':
        return `Falta cuánto pagó cada uno: ${names(p.participantIds)}.`;
      case 'payers-invalid':
        return `Completa o corrige cuánto pagó ${names(p.participantIds)}.`;
      case 'total-too-large':
        return 'El total pasa del máximo de 1.000.000 €.';
      case 'payers-mismatch':
        return `Los pagos suman ${formatEuros(asCents(p.payersSum))} y el total es ${formatEuros(asCents(p.total))}.`;
    }
  })();
  return p.line ? `${p.line}: ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

/** The split of the whole ticket, once every line reads; null until then (expenseProblems says why). */
export function previewShares(s: TicketState): { rows: { participantId: string; amountCents: Cents }[] } | null {
  const items: ItemShares[] = [];
  for (const item of s.items) {
    const check = checkItem(item);
    if (!check.ok) return null;
    items.push({ total: check.total, shares: check.shares });
  }
  const aggregated = aggregateItemShares(items);
  return { rows: [...aggregated.entries()].map(([participantId, amountCents]) => ({ participantId, amountCents })) };
}

export function toExpenseInput(s: TicketState): ExpenseInput | null {
  if (expenseProblems(s).length > 0) return null;
  const payers = effectivePayerAmounts(s) ?? [];
  const items: ExpenseInput['items'] = s.items.map((item) => {
    const check = checkItem(item);
    if (!check.ok) throw new Error('unreachable: expenseProblems found no problem');
    const label = item.label.trim();
    return {
      ...(label !== '' ? { label } : {}),
      amount: check.total,
      splitMode: item.splitMode,
      shares: check.inputs.map((si) => ({ participantId: si.participantId, shareInput: si.shareInput })),
    };
  });

  return {
    title: s.title.trim(),
    date: s.date,
    payers: payers.map((p) => ({
      participantId: p.participantId === OWNERLESS_PAYER ? null : p.participantId,
      amount: p.amountCents,
    })),
    items,
  };
}

export function itemSummary(item: ItemRow, nameOf: (id: string) => string, personCount: number): string {
  if (item.splitMode !== 'EQUAL') return MODE_LABELS[item.splitMode];
  const included = item.shares.filter((r) => r.included);
  if (included.length === personCount) return 'todos · partes iguales';
  if (included.length === personCount - 1) {
    const excluded = item.shares.find((r) => !r.included);
    return `todos menos ${excluded ? nameOf(excluded.participantId) : ''}`;
  }
  return joinNames(included.map((r) => nameOf(r.participantId)));
}
