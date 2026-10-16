import { DomainError } from './errors';
import { Cents, asCents } from './money';
import { allocate } from './allocate';

export type SplitMode = 'EQUAL' | 'EXACT' | 'PERCENTAGE' | 'SHARES' | 'ADJUSTMENT';

export interface ShareInput {
  participantId: string;
  shareInput: number;
}

export interface ComputedShare {
  participantId: string;
  shareInput: number;
  amountCents: Cents;
}

export interface MultiPayerInput {
  participantId: string | null; // null = ownerless payer ("Sobrante" in the UI, spec §7.1)
  amountCents: Cents;
}

export interface ItemShares {
  total: Cents;
  shares: ComputedShare[];
}

/** Percentages travel as integer hundredths: 33.33% → 3333. Must sum to this. */
export const PERCENT_TOTAL = 10_000;

/**
 * Facade over allocate() for EQUAL/SHARES/PERCENTAGE; EXACT bypasses
 * allocation entirely and only validates (spec §3.2). ADJUSTMENT applies
 * a zero-sum integer delta over an equal base (v1.1 §3).
 */
export function computeShares(mode: SplitMode, total: Cents, inputs: ShareInput[]): ComputedShare[] {
  if (inputs.length === 0) throw new DomainError('NO_BENEFICIARIES');
  assertNoDuplicateParticipants(inputs.map((s) => s.participantId));
  switch (mode) {
    case 'EQUAL': {
      const parts = allocate(total, inputs.map(() => 1));
      return inputs.map((input, i) => ({ participantId: input.participantId, shareInput: 1, amountCents: parts[i] }));
    }
    case 'SHARES': {
      const parts = allocate(total, inputs.map((s) => s.shareInput));
      return inputs.map((input, i) => ({ ...input, amountCents: parts[i] }));
    }
    case 'PERCENTAGE': {
      const sum = inputs.reduce((acc, s) => acc + s.shareInput, 0);
      if (sum !== PERCENT_TOTAL) throw new DomainError('PERCENT_SUM_MISMATCH');
      const parts = allocate(total, inputs.map((s) => s.shareInput));
      return inputs.map((input, i) => ({ ...input, amountCents: parts[i] }));
    }
    case 'EXACT': {
      if (inputs.some((s) => !Number.isSafeInteger(s.shareInput) || s.shareInput < 0)) {
        throw new DomainError('NEGATIVE_WEIGHT');
      }
      const sum = inputs.reduce((acc, s) => acc + s.shareInput, 0);
      if (sum !== total) throw new DomainError('EXACT_SUM_MISMATCH');
      return inputs.map((input) => ({ ...input, amountCents: asCents(input.shareInput) }));
    }
    case 'ADJUSTMENT': {
      if (inputs.some((s) => !Number.isSafeInteger(s.shareInput))) {
        throw new DomainError('NEGATIVE_WEIGHT');
      }
      const deltaSum = inputs.reduce((acc, s) => acc + s.shareInput, 0);
      if (deltaSum !== 0) throw new DomainError('DELTA_SUM_NONZERO');
      const base = allocate(total, inputs.map(() => 1));
      const finalAmounts = inputs.map((input, i) => base[i] + input.shareInput);
      // A final share (base + delta) below zero is not a valid expense
      // share — same error class EXACT uses for negative inputs.
      if (finalAmounts.some((amount) => amount < 0)) throw new DomainError('NEGATIVE_WEIGHT');
      return inputs.map((input, i) => ({
        participantId: input.participantId,
        shareInput: input.shareInput,
        amountCents: asCents(finalAmounts[i]),
      }));
    }
  }
}

/**
 * Rejects a duplicate participantId within the same list (FIX-8): the
 * caller would otherwise hit a P2002 unique-constraint violation (a raw 500)
 * on insert instead of a typed, user-facing message.
 */
function assertNoDuplicateParticipants(participantIds: (string | null)[]): void {
  const seen = new Set<string | null>();
  for (const id of participantIds) {
    if (seen.has(id)) throw new DomainError('DUPLICATE_PARTICIPANT');
    seen.add(id);
  }
}

/**
 * Asserts that payer amounts sum exactly to the expense total (v1.1 §2).
 * Each payer amount must be a non-negative safe integer of cents.
 */
export function validatePayerSum(payers: MultiPayerInput[], total: Cents): void {
  if (payers.length === 0) throw new DomainError('NO_BENEFICIARIES');
  assertNoDuplicateParticipants(payers.map((p) => p.participantId));
  for (const p of payers) {
    if (!Number.isSafeInteger(p.amountCents) || p.amountCents < 0) {
      throw new DomainError('NEGATIVE_WEIGHT');
    }
  }
  const sum = payers.reduce((acc, p) => acc + p.amountCents, 0);
  if (sum !== total) throw new DomainError('PAYER_SUM_MISMATCH');
}

/**
 * Asserts that item totals sum exactly to the expense total (v1.1 §7).
 */
export function validateItemSum(itemTotals: Cents[], expenseTotal: Cents): void {
  if (itemTotals.length === 0) throw new DomainError('NO_BENEFICIARIES');
  const sum = itemTotals.reduce((acc, t) => acc + t, 0);
  if (sum !== expenseTotal) throw new DomainError('ITEM_SUM_MISMATCH');
}

/**
 * Aggregates per-item ComputedShare[] into per-participant totals (v1.1 §7).
 * computeShares stays per-item; this sums the results across items for the
 * same participant. The caller validates item totals = expense total.
 */
export function aggregateItemShares(items: ItemShares[]): Map<string, Cents> {
  const totals = new Map<string, number>();
  for (const item of items) {
    for (const share of item.shares) {
      totals.set(share.participantId, (totals.get(share.participantId) ?? 0) + share.amountCents);
    }
  }
  return new Map([...totals.entries()].map(([id, value]) => [id, asCents(value)]));
}
