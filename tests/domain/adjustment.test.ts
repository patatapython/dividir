import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeShares } from '../../src/domain/split';
import { asCents } from '../../src/domain/money';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

/**
 * Generates an integer delta vector of length n that sums to exactly 0,
 * with each delta bounded so that an equal base + delta stays non-negative
 * (computeShares rejects a negative final share). The bound is shrunk by
 * (n+1) so that even after the zero-sum correction below lands entirely on
 * index 0 — worst case, every other slot at ±bound — index 0 cannot be
 * pushed below -base.
 */
const zeroSumDeltasArb = (n: number, total: number) => {
  const base = Math.floor(total / n);
  const bound = Math.floor(base / (n + 1));
  return fc.array(fc.integer({ min: -bound, max: bound }), { minLength: n, maxLength: n }).map((arr) => {
    const sum = arr.reduce((a, b) => a + b, 0);
    const fixed = [...arr];
    fixed[0] -= sum; // restore zero-sum; still within [-base, base] by construction
    return fixed;
  });
};

describe('computeShares ADJUSTMENT — properties', () => {
  it('shares sum exactly to total when delta-sum is 0', () => {
    fc.assert(
      fc.property(
        // n is generated FIRST and total scales with n (min total = n * 1000)
        // so that base = floor(total/n) >= 1000 and bound = floor(base/(n+1))
        // is always >= 1 even at n = 20 — otherwise a small total with a
        // large n collapses bound to 0 and every generated delta vector is
        // all-zero, silently skipping the non-trivial case entirely.
        fc.integer({ min: 2, max: 20 }).chain((n) =>
          fc.integer({ min: n * 1000, max: 10_000_000 }).chain((total) =>
            zeroSumDeltasArb(n, total).map((ds) => ({ total, n, ds })),
          ),
        ),
        ({ total, n, ds }) => {
          const inputs = ids(n).map((participantId, i) => ({ participantId, shareInput: ds[i] }));
          const shares = computeShares('ADJUSTMENT', asCents(total), inputs);
          return shares.reduce((acc, s) => acc + s.amountCents, 0) === total;
        },
      ),
    );
  });

  it('validated example: total 10000, deltas [4000,-1000,-1000,-1000,-1000] → [6000,1000×4]', () => {
    const inputs = ['A', 'B', 'C', 'D', 'E'].map((participantId, i) => ({
      participantId,
      shareInput: [4000, -1000, -1000, -1000, -1000][i],
    }));
    const shares = computeShares('ADJUSTMENT', asCents(10000), inputs);
    expect(shares.map((s) => s.amountCents)).toEqual([6000, 1000, 1000, 1000, 1000]);
    expect(shares.reduce((acc, s) => acc + s.amountCents, 0)).toBe(10000);
  });
});

describe('computeShares ADJUSTMENT — validation', () => {
  it('rejects non-zero delta sum with DELTA_SUM_NONZERO', () => {
    const inputs = ids(3).map((participantId, i) => ({ participantId, shareInput: [100, -50, -40][i] }));
    expect(() => computeShares('ADJUSTMENT', asCents(1000), inputs)).toThrowError(
      expect.objectContaining({ code: 'DELTA_SUM_NONZERO' }),
    );
  });

  it('rejects a negative final share (base + delta < 0) with NEGATIVE_WEIGHT', () => {
    // total 1000 over 3 -> base ~333/333/334; a -400 delta on one participant
    // (offset by +400 on another to keep zero-sum) drives a final share negative.
    const inputs = ['A', 'B', 'C'].map((participantId, i) => ({
      participantId,
      shareInput: [-400, 400, 0][i],
    }));
    expect(() => computeShares('ADJUSTMENT', asCents(1000), inputs)).toThrowError(
      expect.objectContaining({ code: 'NEGATIVE_WEIGHT' }),
    );
  });
});
