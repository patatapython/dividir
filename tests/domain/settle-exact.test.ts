import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { settle, settleExact, settleGreedy, EXACT_LIMIT } from '../../src/domain/settle';
import { asCents, type Cents } from '../../src/domain/money';
import { applyTransfers, zeroSumBalances } from './settle-helpers';

// Smaller pool than greedy's: settleExact is O(3^m).
const zeroSumArbSmall = fc
  .array(fc.integer({ min: -100_000, max: 100_000 }), { minLength: 1, maxLength: 10 })
  .map(zeroSumBalances);

describe('settleExact — properties', () => {
  it('applying the transfers zeroes every balance', () => {
    fc.assert(
      fc.property(zeroSumArbSmall, (balances) => {
        const after = applyTransfers(balances, settleExact(balances));
        return [...after.values()].every((v) => v === 0);
      }),
    );
  });

  it('never returns more transfers than settleGreedy on the same input', () => {
    fc.assert(
      fc.property(zeroSumArbSmall, (balances) => {
        return settleExact(balances).length <= settleGreedy(balances).length;
      }),
    );
  });

  it('stays within m-1 transfers and is deterministic', () => {
    fc.assert(
      fc.property(zeroSumArbSmall, (balances) => {
        const m = [...balances.values()].filter((v) => v !== 0).length;
        const first = settleExact(balances);
        return first.length <= Math.max(0, m - 1) &&
          JSON.stringify(first) === JSON.stringify(settleExact(new Map(balances)));
      }),
    );
  });
});

describe('settleExact — golden fixtures', () => {
  it('beats greedy on the frozen regression case (3 vs 4 transfers)', () => {
    // Zero-sum subgroups: {+6, -4, -2} and {+5, -5} → optimum = 5 - 2 = 3.
    // Greedy pairs +6 with -5 first and needs 4. Frozen per spec §7.2.
    const balances = new Map<string, Cents>([
      ['a', asCents(600)],
      ['b', asCents(-400)],
      ['c', asCents(-200)],
      ['d', asCents(500)],
      ['e', asCents(-500)],
    ]);
    expect(settleGreedy(balances).length).toBe(4);
    const exact = settleExact(balances);
    expect(exact.length).toBe(3);
    const after = applyTransfers(balances, exact);
    expect([...after.values()].every((v) => v === 0)).toBe(true);
  });

  it('finds all zero-sum pairs at the m=16 worst case', { timeout: 30_000 }, () => {
    // 8 disjoint (+k, -k) pairs → g=8, optimum = 16 - 8 = 8 transfers.
    const balances = new Map<string, Cents>();
    for (let k = 1; k <= 8; k++) {
      balances.set(`c${k}`, asCents(k * 100));
      balances.set(`d${k}`, asCents(-k * 100));
    }
    const exact = settleExact(balances);
    expect(exact.length).toBe(8);
    const after = applyTransfers(balances, exact);
    expect([...after.values()].every((v) => v === 0)).toBe(true);
  });

  it('throws TOO_MANY_FOR_EXACT above the limit', () => {
    const balances = new Map<string, Cents>();
    for (let k = 1; k <= 9; k++) {
      balances.set(`c${k}`, asCents(k));
      balances.set(`d${k}`, asCents(-k));
    }
    expect([...balances.values()].filter((v) => v !== 0).length).toBe(18);
    expect(() => settleExact(balances)).toThrowError(
      expect.objectContaining({ code: 'TOO_MANY_FOR_EXACT' }),
    );
  });
});

describe('settle — selector', () => {
  it('matches settleExact when m <= 16', () => {
    fc.assert(
      fc.property(zeroSumArbSmall, (balances) => {
        return JSON.stringify(settle(balances)) === JSON.stringify(settleExact(balances));
      }),
    );
  });

  it('falls back to greedy above EXACT_LIMIT and still settles', () => {
    const balances = new Map<string, Cents>();
    for (let k = 1; k <= EXACT_LIMIT + 1; k++) {
      balances.set(`c${k}`, asCents(k));
      balances.set(`d${k}`, asCents(-k));
    }
    const transfers = settle(balances);
    const after = applyTransfers(balances, transfers);
    expect([...after.values()].every((v) => v === 0)).toBe(true);
  });
});
