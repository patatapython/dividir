import { DomainError } from './errors';
import { Cents } from './money';
import { allocate } from './allocate';

export interface RefundShareInput {
  participantId: string;
  amountCents: Cents;
}

export interface RefundShare {
  participantId: string;
  amountCents: Cents;
}

/**
 * Mirrors the original expense's shares onto a refund amount via LRM (v1.1 §4).
 * The original weights are the original shares' `amountCents`: this preserves
 * the original split mode proportions (EQUAL → equal weights; SHARES/PERCENTAGE
 * → weighted; EXACT → original amounts). allocate() is the only rounding place.
 * Result sums exactly to refundCents.
 */
export function computeRefundShares(
  originalShares: RefundShareInput[],
  refundCents: Cents,
): RefundShare[] {
  const weights = originalShares.map((s) => s.amountCents);
  const parts = allocate(refundCents, weights);
  return originalShares.map((s, i) => ({ participantId: s.participantId, amountCents: parts[i] }));
}

/**
 * Cumulative cap (D4): the sum of all refunds against an expense must never
 * exceed the expense's total. The caller re-aggregates `priorTotal` (and, for
 * updateExpense, re-reads `expenseTotal`) inside a locked transaction so this
 * check is race-free.
 */
export function assertRefundCap(priorTotal: Cents, amount: Cents, expenseTotal: Cents): void {
  if (priorTotal + amount > expenseTotal) throw new DomainError('REFUND_EXCEEDS_EXPENSE');
}
