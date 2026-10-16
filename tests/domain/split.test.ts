import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeShares, validatePayerSum, PERCENT_TOTAL } from '../../src/domain/split';
import { asCents } from '../../src/domain/money';
import { DomainError } from '../../src/domain/errors';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const totalArb = fc.integer({ min: 1, max: 2_147_483_647 });

/** Composition of `total` into k non-negative parts summing exactly to total. */
const compositionArb = (total: number, maxParts: number) =>
  fc
    .uniqueArray(fc.integer({ min: 1, max: Math.max(1, total - 1) }), {
      minLength: 0,
      maxLength: Math.min(maxParts - 1, Math.max(0, total - 1)),
    })
    .map((cuts) => {
      const bounds = [0, ...[...cuts].sort((a, b) => a - b), total];
      return bounds.slice(1).map((b, i) => b - bounds[i]);
    });

describe('computeShares — properties', () => {
  it('EQUAL: shares sum exactly to total', () => {
    fc.assert(
      fc.property(totalArb, fc.integer({ min: 1, max: 30 }), (total, n) => {
        const shares = computeShares('EQUAL', asCents(total), ids(n).map((participantId) => ({ participantId, shareInput: 1 })));
        return shares.reduce((acc, s) => acc + s.amountCents, 0) === total && shares.every((s) => s.shareInput === 1);
      }),
    );
  });

  it('SHARES: shares sum exactly to total for arbitrary weights', () => {
    const weightsArb = fc
      .array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 30 })
      .filter((ws) => ws.some((w) => w > 0));
    fc.assert(
      fc.property(totalArb, weightsArb, (total, weights) => {
        const inputs = weights.map((shareInput, i) => ({ participantId: `p${i}`, shareInput }));
        const shares = computeShares('SHARES', asCents(total), inputs);
        return shares.reduce((acc, s) => acc + s.amountCents, 0) === total;
      }),
    );
  });

  it('PERCENTAGE: shares sum exactly to total when hundredths sum to 10000', () => {
    fc.assert(
      fc.property(totalArb, compositionArb(PERCENT_TOTAL, 15), (total, percents) => {
        const inputs = percents.map((shareInput, i) => ({ participantId: `p${i}`, shareInput }));
        const shares = computeShares('PERCENTAGE', asCents(total), inputs);
        return shares.reduce((acc, s) => acc + s.amountCents, 0) === total;
      }),
    );
  });

  it('EXACT: passes through amounts that sum to total, never rounds', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 2_000_000 }).chain((total) => fc.tuple(fc.constant(total), compositionArb(total, 10))), ([total, amounts]) => {
        const inputs = amounts.map((shareInput, i) => ({ participantId: `p${i}`, shareInput }));
        const shares = computeShares('EXACT', asCents(total), inputs);
        return shares.every((s, i) => s.amountCents === amounts[i]);
      }),
    );
  });
});

describe('computeShares — validation', () => {
  const two = [{ participantId: 'a', shareInput: 5000 }, { participantId: 'b', shareInput: 4999 }];

  it('PERCENTAGE must sum exactly 10000 hundredths', () => {
    expect(() => computeShares('PERCENTAGE', asCents(1000), two)).toThrowError(
      expect.objectContaining({ code: 'PERCENT_SUM_MISMATCH' }),
    );
  });

  it('EXACT must sum exactly to total', () => {
    expect(() => computeShares('EXACT', asCents(10000), two)).toThrowError(
      expect.objectContaining({ code: 'EXACT_SUM_MISMATCH' }),
    );
  });

  it('rejects empty beneficiary list', () => {
    expect(() => computeShares('EQUAL', asCents(1000), [])).toThrow(DomainError);
  });

  it('rejects a duplicate participantId with DUPLICATE_PARTICIPANT (FIX-8, mirrors validatePayerSum)', () => {
    const dup = [
      { participantId: 'a', shareInput: 1 },
      { participantId: 'a', shareInput: 1 },
    ];
    expect(() => computeShares('EQUAL', asCents(1000), dup)).toThrowError(
      expect.objectContaining({ code: 'DUPLICATE_PARTICIPANT' }),
    );
  });
});

describe('validatePayerSum — validation (FIX-8)', () => {
  it('accepts distinct payers summing to the total', () => {
    expect(() =>
      validatePayerSum(
        [{ participantId: 'a', amountCents: asCents(500) }, { participantId: 'b', amountCents: asCents(500) }],
        asCents(1000),
      ),
    ).not.toThrow();
  });

  it('rejects a duplicate payer participantId with DUPLICATE_PARTICIPANT, not a P2002 500', () => {
    expect(() =>
      validatePayerSum(
        [{ participantId: 'a', amountCents: asCents(500) }, { participantId: 'a', amountCents: asCents(500) }],
        asCents(1000),
      ),
    ).toThrowError(expect.objectContaining({ code: 'DUPLICATE_PARTICIPANT' }));
  });
});
