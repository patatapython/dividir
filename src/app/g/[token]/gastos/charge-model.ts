import { asCents, formatCents, type Cents } from '@/domain/money';
import type { SplitMode } from '@/domain/split';
import { type ShareRow, type ItemRow, type FormProblem, checkItem, rawFromShareInput } from './ticket-model';

/** Read model for editing an existing charge (mirrors ChargeForEdit from the server). */
export interface ChargeForEditModel {
  id: string;
  concept: string;
  amountCents: number;
  date: string;
  splitMode: SplitMode;
  shares: { participantId: string; shareInput: number }[];
}

export interface ChargeState {
  concept: string;
  date: string;
  amountRaw: string;
  splitMode: SplitMode;
  shares: ShareRow[];
}

export interface ChargeInput {
  concept: string;
  date: string;
  amount: number; // cents
  splitMode: SplitMode;
  shares: { participantId: string; shareInput: number }[];
}

export function initialCharge(personIds: string[], today: string): ChargeState {
  return {
    concept: '',
    date: today,
    amountRaw: '',
    splitMode: 'EQUAL',
    shares: personIds.map((participantId) => ({ participantId, included: true, raw: '' })),
  };
}

export function fromChargeForEdit(c: ChargeForEditModel, personIds: string[]): ChargeState {
  const byId = new Map(c.shares.map((s) => [s.participantId, s.shareInput]));
  return {
    concept: c.concept,
    date: c.date,
    amountRaw: formatCents(asCents(c.amountCents)),
    splitMode: c.splitMode,
    shares: personIds.map((participantId) => {
      const shareInput = byId.get(participantId);
      // Only the stored shares, in every mode (see fromExpenseForEdit).
      const included = shareInput !== undefined;
      return { participantId, included, raw: rawFromShareInput(c.splitMode, shareInput) };
    }),
  };
}

/** A charge splits like a single expense item; reuse the item share machinery. */
function asItemRow(s: ChargeState): ItemRow {
  return { id: 'charge', label: '', amountRaw: s.amountRaw, splitMode: s.splitMode, shares: s.shares };
}

export function setSplitMode(s: ChargeState, splitMode: SplitMode): ChargeState {
  if (splitMode === s.splitMode) return s;
  return { ...s, splitMode, shares: s.shares.map((r) => ({ ...r, included: true, raw: '' })) };
}

export function updateChargeShare(
  s: ChargeState,
  participantId: string,
  patch: Partial<Pick<ShareRow, 'included' | 'raw'>>,
): ChargeState {
  return { ...s, shares: s.shares.map((r) => (r.participantId === participantId ? { ...r, ...patch } : r)) };
}

export function chargeProblems(s: ChargeState): FormProblem[] {
  const problems: FormProblem[] = [];
  if (s.concept.trim() === '') problems.push({ kind: 'title-missing' });
  if (s.date === '') problems.push({ kind: 'date-missing' });
  const check = checkItem(asItemRow(s));
  if (!check.ok) problems.push(...check.problems);
  return problems;
}

/** Who owes what outside, once the split reads; null until then (chargeProblems says why). */
export function chargePreview(s: ChargeState): { rows: { participantId: string; amountCents: Cents }[] } | null {
  const check = checkItem(asItemRow(s));
  if (!check.ok) return null;
  return { rows: check.shares.map((sh) => ({ participantId: sh.participantId, amountCents: sh.amountCents })) };
}

export function toChargeInput(s: ChargeState): ChargeInput | null {
  const check = checkItem(asItemRow(s));
  if (chargeProblems(s).length > 0 || !check.ok) return null;
  return {
    concept: s.concept.trim(),
    date: s.date,
    amount: check.total,
    splitMode: s.splitMode,
    shares: check.inputs.map((si) => ({ participantId: si.participantId, shareInput: si.shareInput })),
  };
}
