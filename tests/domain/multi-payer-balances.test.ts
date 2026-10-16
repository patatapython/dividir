import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeBalances } from '../../src/domain/balances';
import { computeShares, validatePayerSum } from '../../src/domain/split';
import { computeRefundShares } from '../../src/domain/refund';
import { asCents } from '../../src/domain/money';

const POOL = ['p0', 'p1', 'p2', 'p3', 'p4'];

/** Splits total into n non-negative integer parts summing exactly to total. */
const composition = (total: number, n: number) =>
  fc
    .uniqueArray(fc.integer({ min: 1, max: Math.max(1, total - 1) }), {
      minLength: 0,
      maxLength: Math.min(n - 1, Math.max(0, total - 1)),
    })
    .map((cuts) => {
      const bounds = [0, ...[...cuts].sort((a, b) => a - b), total];
      return bounds.slice(1).map((b, i) => b - bounds[i]);
    })
    .map((parts) => {
      while (parts.length < n) parts.push(0);
      return parts.slice(0, n);
    });

describe('validatePayerSum', () => {
  it('accepts payer amounts summing to total', () => {
    const arb = fc
      .record({
        total: fc.integer({ min: 1, max: 1_000_000 }),
        n: fc.integer({ min: 1, max: 5 }),
      })
      .chain(({ total, n }) => composition(total, n).map((parts) => ({ total, n, parts })));

    fc.assert(
      fc.property(arb, ({ total, n, parts }) => {
        const payers = POOL.slice(0, n).map((participantId, i) => ({
          participantId,
          amountCents: asCents(parts[i]),
        }));
        expect(() => validatePayerSum(payers, asCents(total))).not.toThrow();
        return true;
      }),
    );
  });

  it('rejects payer sums != total with PAYER_SUM_MISMATCH', () => {
    const payers = [
      { participantId: 'p0', amountCents: asCents(10000) },
      { participantId: 'p1', amountCents: asCents(15000) },
    ];
    expect(() => validatePayerSum(payers, asCents(30000))).toThrowError(
      expect.objectContaining({ code: 'PAYER_SUM_MISMATCH' }),
    );
  });
});

describe('computeBalances — multi-payer', () => {
  it('balances sum to exactly 0 (property)', () => {
    const arb = fc
      .record({
        total: fc.integer({ min: 1, max: 1_000_000 }),
        payerCount: fc.integer({ min: 1, max: POOL.length }),
        beneficiaries: fc.uniqueArray(fc.integer({ min: 0, max: POOL.length - 1 }), { minLength: 1 }),
      })
      .chain(({ total, payerCount, beneficiaries }) =>
        composition(total, payerCount).map((parts) => ({ total, payerCount, beneficiaries, parts })),
      );

    fc.assert(
      fc.property(fc.array(arb, { maxLength: 20 }), (records) => {
        const expenses = records.map(({ total, payerCount, beneficiaries, parts }) => {
          const inputs = beneficiaries.map((i) => ({ participantId: POOL[i], shareInput: 1 }));
          const shares = computeShares('EQUAL', asCents(total), inputs);
          const payers = POOL.slice(0, payerCount).map((participantId, i) => ({
            participantId,
            amountCents: asCents(parts[i]),
          }));
          return { payers, shares };
        });
        const balances = computeBalances(POOL, expenses, []);
        return [...balances.values()].reduce((a, b) => a + b, 0) === 0;
      }),
    );
  });

  it('worked example: two payers 10000+20000 on 30000 split EQUAL among 3', () => {
    const shares = computeShares('EQUAL', asCents(30000), [
      { participantId: 'p0', shareInput: 1 },
      { participantId: 'p1', shareInput: 1 },
      { participantId: 'p2', shareInput: 1 },
    ]);
    const balances = computeBalances(
      ['p0', 'p1', 'p2'],
      [{ payers: [{ participantId: 'p0', amountCents: asCents(10000) }, { participantId: 'p1', amountCents: asCents(20000) }], shares }],
      [],
    );
    expect(balances.get('p0')).toBe(0); // +10000 -10000
    expect(balances.get('p1')).toBe(10000); // +20000 -10000
    expect(balances.get('p2')).toBe(-10000);
  });

  it('refund mirror preserves sum-zero (property)', () => {
    const arb = fc
      .record({
        total: fc.integer({ min: 1, max: 1_000_000 }),
        n: fc.integer({ min: 2, max: POOL.length }),
      })
      .chain(({ total, n }) =>
        fc.integer({ min: 1, max: total }).map((refund) => ({ total, n, refund })),
      );

    fc.assert(
      fc.property(arb, ({ total, n, refund }) => {
        const participants = POOL.slice(0, n);
        const inputs = participants.map((participantId) => ({ participantId, shareInput: 1 }));
        const original = computeShares('EQUAL', asCents(total), inputs);
        const refundShares = computeRefundShares(original, asCents(refund));
        const balances = computeBalances(
          participants,
          [{ payers: [{ participantId: participants[0], amountCents: asCents(total) }], shares: original }],
          [],
          [{ expenseId: 'e', receivedById: participants[0], amountCents: asCents(refund), shares: refundShares }],
        );
        return [...balances.values()].reduce((a, b) => a + b, 0) === 0;
      }),
    );
  });
});
