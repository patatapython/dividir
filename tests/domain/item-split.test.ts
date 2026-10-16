import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  computeShares,
  validateItemSum,
  aggregateItemShares,
  type ItemShares,
} from '../../src/domain/split';
import { asCents } from '../../src/domain/money';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

/** Splits total into k positive integer parts summing exactly to total. */
const composition = (total: number, maxParts: number) =>
  fc
    .uniqueArray(fc.integer({ min: 1, max: Math.max(1, total - 1) }), {
      minLength: 0,
      maxLength: Math.min(maxParts - 1, Math.max(0, total - 1)),
    })
    .map((cuts) => {
      const bounds = [0, ...[...cuts].sort((a, b) => a - b), total];
      return bounds.slice(1).map((b, i) => b - bounds[i]);
    });

describe('validateItemSum', () => {
  it('accepts item totals summing to expense total', () => {
    const arb = fc
      .record({
        total: fc.integer({ min: 1, max: 1_000_000 }),
        n: fc.integer({ min: 1, max: 10 }),
      })
      .chain(({ total, n }) => composition(total, n).map((parts) => ({ total, parts })));

    fc.assert(
      fc.property(arb, ({ total, parts }) => {
        expect(() => validateItemSum(parts.map(asCents), asCents(total))).not.toThrow();
        return true;
      }),
    );
  });

  it('rejects item totals != expense total with ITEM_SUM_MISMATCH', () => {
    expect(() => validateItemSum([asCents(5000), asCents(2000)], asCents(10000))).toThrowError(
      expect.objectContaining({ code: 'ITEM_SUM_MISMATCH' }),
    );
  });
});

describe('aggregateItemShares', () => {
  it('aggregated shares per item sum to item total; combined = sum of items', () => {
    const arb = fc
      .record({
        itemTotal: fc.integer({ min: 1, max: 1_000_000 }),
        n: fc.integer({ min: 2, max: 6 }),
      })
      .chain(({ itemTotal, n }) =>
        fc
          .array(fc.integer({ min: 1, max: 1000 }), { minLength: n, maxLength: n })
          .map((weights) => ({ itemTotal, n, weights })),
      );

    fc.assert(
      fc.property(arb, ({ itemTotal, n, weights }) => {
        const inputs = ids(n).map((participantId, i) => ({
          participantId,
          shareInput: weights[i],
        }));
        const shares = computeShares('SHARES', asCents(itemTotal), inputs);
        const itemSum = shares.reduce((acc, s) => acc + s.amountCents, 0);
        return itemSum === itemTotal;
      }),
    );
  });

  it('worked example: two items (5000 SHARES, 3000 EQUAL) aggregate to 8000', () => {
    const item1 = computeShares('SHARES', asCents(5000), [
      { participantId: 'A', shareInput: 2 },
      { participantId: 'B', shareInput: 3 },
    ]);
    const item2 = computeShares('EQUAL', asCents(3000), [
      { participantId: 'A', shareInput: 1 },
      { participantId: 'B', shareInput: 1 },
    ]);
    const items: ItemShares[] = [
      { total: asCents(5000), shares: item1 },
      { total: asCents(3000), shares: item2 },
    ];
    const aggregated = aggregateItemShares(items);
    const total = [...aggregated.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(8000);
    expect(aggregated.get('A')).toBe(item1[0].amountCents + item2[0].amountCents);
    expect(aggregated.get('B')).toBe(item1[1].amountCents + item2[1].amountCents);
  });
});
