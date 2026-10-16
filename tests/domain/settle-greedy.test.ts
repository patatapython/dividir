import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { settleGreedy } from '../../src/domain/settle';
import { asCents } from '../../src/domain/money';
import { applyTransfers, zeroSumArb } from './settle-helpers';

describe('settleGreedy — properties', () => {
  it('applying the transfers zeroes every balance', () => {
    fc.assert(
      fc.property(zeroSumArb, (balances) => {
        const after = applyTransfers(balances, settleGreedy(balances));
        return [...after.values()].every((v) => v === 0);
      }),
    );
  });

  it('uses at most m-1 transfers (m = non-zero balances) with positive amounts', () => {
    fc.assert(
      fc.property(zeroSumArb, (balances) => {
        const m = [...balances.values()].filter((v) => v !== 0).length;
        const transfers = settleGreedy(balances);
        return transfers.length <= Math.max(0, m - 1) && transfers.every((t) => t.amount > 0);
      }),
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(zeroSumArb, (balances) => {
        return JSON.stringify(settleGreedy(balances)) === JSON.stringify(settleGreedy(new Map(balances)));
      }),
    );
  });
});

describe('settleGreedy — units', () => {
  it('settles a single debtor-creditor pair with one transfer', () => {
    const transfers = settleGreedy(new Map([['a', asCents(500)], ['b', asCents(-500)]]));
    expect(transfers).toEqual([{ from: 'b', to: 'a', amount: 500 }]);
  });

  it('returns [] when everyone is settled', () => {
    expect(settleGreedy(new Map([['a', asCents(0)]]))).toEqual([]);
    expect(settleGreedy(new Map())).toEqual([]);
  });

  it('throws UNBALANCED when balances do not sum to zero', () => {
    expect(() => settleGreedy(new Map([['a', asCents(1)]]))).toThrowError(
      expect.objectContaining({ code: 'UNBALANCED' }),
    );
  });
});
