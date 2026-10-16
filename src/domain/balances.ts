import { Cents, asCents } from './money';
import { allocate } from './allocate';

/**
 * Sentinel key for the single synthetic ownerless bucket ("Sobrante" in the UI) inside a
 * balances map: an ExpensePayer with no participant (participantId null)
 * accrues here. A cuid never contains "_", so this never collides with a real
 * participant id.
 */
export const OWNERLESS = '__ownerless__';

export interface ExpenseForBalance {
  // participantId null = paid by nobody (the ownerless payer); accrues into the
  // OWNERLESS bucket, folded onto people by filterSettleable (spec §4/§7.1).
  payers: { participantId: string | null; amountCents: Cents }[];
  shares: { participantId: string; amountCents: Cents }[];
}

export interface PaymentForBalance {
  fromId: string;
  toId: string;
  amountCents: Cents;
}

export interface RefundForBalance {
  expenseId: string;
  receivedById: string;
  amountCents: Cents;
  shares: { participantId: string; amountCents: Cents }[];
}

/**
 * Positive balance = is owed money; negative = owes (spec §3.3).
 * Never rounds. Values always sum to 0 because expense shares sum exactly
 * to their expense total (allocate() invariant), payments are symmetric,
 * and refunds mirror the original shares (receivedById −amount,
 * beneficiaries +mirroredShare sums to +amount).
 *
 * v1.1: multi-payer (sum +amount per payer); refunds. Ownerless money: a payer
 * with no participant sums into ONE synthetic OWNERLESS bucket (spec §7.1) that
 * filterSettleable folds onto the people; the bucket keeps the vector zero-sum.
 */
export function computeBalances(
  participantIds: string[],
  expenses: ExpenseForBalance[],
  payments: PaymentForBalance[],
  refunds: RefundForBalance[] = [],
): Map<string, Cents> {
  const balances = new Map<string, number>(participantIds.map((id) => [id, 0]));
  const add = (id: string, delta: number) => balances.set(id, (balances.get(id) ?? 0) + delta);

  for (const expense of expenses) {
    for (const payer of expense.payers) {
      add(payer.participantId ?? OWNERLESS, payer.amountCents);
    }
    for (const share of expense.shares) {
      add(share.participantId, -share.amountCents);
    }
  }
  for (const refund of refunds) {
    add(refund.receivedById, -refund.amountCents);
    for (const share of refund.shares) {
      add(share.participantId, share.amountCents);
    }
  }
  for (const payment of payments) {
    add(payment.fromId, payment.amountCents);
    add(payment.toId, -payment.amountCents);
  }
  return new Map([...balances.entries()].map(([id, value]) => [id, asCents(value)]));
}

export interface PersonForSettle {
  id: string;
  isArchived: boolean;
}

/**
 * Folds the single OWNERLESS bucket (the ownerless payer) into the
 * person-to-person settlement input, via VIRTUAL REDISTRIBUTION rather than a
 * bare projection: dropping the bucket's balance on the floor would break
 * settle()'s zero-sum precondition (assertZeroSum throws UNBALANCED) whenever it
 * carries a nonzero balance.
 *
 * The bucket's balance is redistributed — equal weights, sign preserved — onto
 * the ACTIVE people (non-archived) via allocate() on its absolute value, so the
 * resulting settleable vector sums to exactly 0 BY CONSTRUCTION. If there is no
 * active person to fold onto, it falls back to every person (archived included)
 * to preserve the invariant; if there is no person at all, a nonzero bucket has
 * nowhere to go and the map is left empty (still trivially zero-sum).
 *
 * settle() stays pure — this is the only place that decides how ownerless money
 * folds into the settlement input. The balances page keeps showing the raw
 * bucket separately; only this settlement input folds it in.
 */
export function filterSettleable(
  balances: Map<string, Cents>,
  people: PersonForSettle[],
): Map<string, Cents> {
  const personIds = new Set(people.map((p) => p.id));
  const result = new Map<string, Cents>(
    [...balances.entries()].filter(([id]) => personIds.has(id)),
  );
  const bucket = balances.get(OWNERLESS) ?? asCents(0);
  if (bucket === 0 || people.length === 0) return result;

  const active = people.filter((p) => !p.isArchived).map((p) => p.id);
  const targets = active.length > 0 ? active : people.map((p) => p.id);
  const sign = bucket > 0 ? 1 : -1;
  // allocate()'s LRM tie-break (lowest index wins) gives the earliest target
  // the remainder cent — accepted deterministic behavior, not a bug.
  const parts = allocate(asCents(Math.abs(bucket)), targets.map(() => 1));
  targets.forEach((id, i) => {
    result.set(id, asCents((result.get(id) ?? 0) + sign * parts[i]));
  });
  return result;
}
