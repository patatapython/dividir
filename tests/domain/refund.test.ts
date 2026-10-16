import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeRefundShares, assertRefundCap } from '../../src/domain/refund';
import { computeShares } from '../../src/domain/split';
import { computeBalances } from '../../src/domain/balances';
import { asCents } from '../../src/domain/money';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

describe('computeRefundShares — properties', () => {
  it('refund shares sum exactly to refundAmount (EQUAL original)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 2, max: 20 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        (total, n, refund) => {
          const inputs = ids(n).map((participantId) => ({ participantId, shareInput: 1 }));
          const original = computeShares('EQUAL', asCents(total), inputs);
          const refundShares = computeRefundShares(original, asCents(Math.min(refund, total)));
          return refundShares.reduce((acc, s) => acc + s.amountCents, 0) === Math.min(refund, total);
        },
      ),
    );
  });

  it('refund shares proportional to original amounts (SHARES original)', () => {
    const weightsArb = fc
      .array(fc.integer({ min: 1, max: 100 }), { minLength: 2, maxLength: 10 });
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1_000_000 }),
        weightsArb,
        fc.integer({ min: 1, max: 10_000 }),
        (total, weights, refund) => {
          const inputs = weights.map((shareInput, i) => ({ participantId: `p${i}`, shareInput }));
          const original = computeShares('SHARES', asCents(total), inputs);
          const refundShares = computeRefundShares(original, asCents(refund));
          const sum = refundShares.reduce((acc, s) => acc + s.amountCents, 0);
          if (sum !== refund) return false;
          return refundShares.every((s, i) => s.participantId === original[i].participantId);
        },
      ),
    );
  });
});

describe('computeRefundShares — validated example (300/5, refund 30)', () => {
  it('mirrors: P +21600 net, others -5400 net after applying refund to balances', () => {
    const participants = ['P', 'a', 'b', 'c', 'd'];
    const original = computeShares('EQUAL', asCents(30000), participants.map((participantId) => ({ participantId, shareInput: 1 })));
    const refundCents = asCents(3000);
    const refundShares = computeRefundShares(original, refundCents);

    const balances = computeBalances(
      participants,
      [{ payers: [{ participantId: 'P', amountCents: asCents(30000) }], shares: original }],
      [],
      [{ expenseId: 'e1', receivedById: 'P', amountCents: refundCents, shares: refundShares }],
    );

    expect(balances.get('P')).toBe(21600);
    for (const other of ['a', 'b', 'c', 'd']) {
      expect(balances.get(other)).toBe(-5400);
    }
    expect([...balances.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('assertRefundCap — cumulative cap', () => {
  it('accepts when priorTotal + amount <= expenseTotal', () => {
    expect(() => assertRefundCap(asCents(2000), asCents(1000), asCents(3000))).not.toThrow();
    expect(() => assertRefundCap(asCents(0), asCents(3000), asCents(3000))).not.toThrow();
  });

  it('rejects when priorTotal + amount > expenseTotal with REFUND_EXCEEDS_EXPENSE', () => {
    expect(() => assertRefundCap(asCents(2000), asCents(1001), asCents(3000))).toThrowError(
      expect.objectContaining({ code: 'REFUND_EXCEEDS_EXPENSE' }),
    );
  });

  it('never accepts beyond the cap regardless of prior total (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (priorTotal, amount, expenseTotal) => {
          const shouldThrow = priorTotal + amount > expenseTotal;
          if (shouldThrow) {
            expect(() => assertRefundCap(asCents(priorTotal), asCents(amount), asCents(expenseTotal))).toThrow();
          } else {
            expect(() => assertRefundCap(asCents(priorTotal), asCents(amount), asCents(expenseTotal))).not.toThrow();
          }
        },
      ),
    );
  });
});
