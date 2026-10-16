import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { allocate } from '../../src/domain/allocate';
import { asCents } from '../../src/domain/money';
import { DomainError } from '../../src/domain/errors';

const totalArb = fc.integer({ min: 0, max: 2_147_483_647 });
const weightsArb = fc
  .array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 40 })
  .filter((ws) => ws.some((w) => w > 0));

describe('allocate — properties', () => {
  it('parts sum exactly to total, always', () => {
    fc.assert(
      fc.property(totalArb, weightsArb, (total, weights) => {
        const parts = allocate(asCents(total), weights);
        return parts.reduce((a, b) => a + b, 0) === total;
      }),
    );
  });

  it('each part is within 1 cent of the ideal continuous share', () => {
    // Exact check in integer arithmetic via BigInt:
    // |part * weightSum - total * weight| < weightSum  ⇔  |part - ideal| < 1
    fc.assert(
      fc.property(totalArb, weightsArb, (total, weights) => {
        const parts = allocate(asCents(total), weights);
        const weightSum = BigInt(weights.reduce((a, b) => a + b, 0));
        return parts.every((part, i) => {
          const diff = BigInt(part) * weightSum - BigInt(total) * BigInt(weights[i]);
          return diff > -weightSum && diff < weightSum;
        });
      }),
    );
  });

  it('is fully deterministic: same input, same output', () => {
    fc.assert(
      fc.property(totalArb, weightsArb, (total, weights) => {
        const first = allocate(asCents(total), weights);
        const second = allocate(asCents(total), [...weights]);
        return first.length === second.length && first.every((p, i) => p === second[i]);
      }),
    );
  });
});

describe('allocate — units', () => {
  it('hands leftover cents to largest remainders, ties to lowest index', () => {
    expect(allocate(asCents(1), [1, 1, 1])).toEqual([1, 0, 0]);
    expect(allocate(asCents(101), [1, 1, 1])).toEqual([34, 34, 33]);
    expect(allocate(asCents(100), [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it('gives zero-weight participants exactly zero', () => {
    expect(allocate(asCents(100), [1, 0])).toEqual([100, 0]);
  });

  it('golden: Splitwise shares bug — weights > 1000 stay deterministic and exact', () => {
    // 333,33 € split by weights 1500/2500/1000. Frozen expected output:
    // bases 9999/16666/6666, leftover 2 goes to remainders 4500 (i0) then 3000 (i2).
    const parts = allocate(asCents(33333), [1500, 2500, 1000]);
    expect(parts).toEqual([10000, 16666, 6667]);
    expect(allocate(asCents(33333), [1500, 2500, 1000])).toEqual(parts);
  });

  it('rejects invalid input with typed codes', () => {
    expect(() => allocate(asCents(100), [])).toThrow(DomainError);
    expect(() => allocate(asCents(100), [0, 0])).toThrow(DomainError);
    expect(() => allocate(asCents(100), [-1, 2])).toThrow(DomainError);
    expect(() => allocate(asCents(100), [1.5, 2])).toThrow(DomainError);
    expect(() => allocate(asCents(-1), [1])).toThrow(DomainError);
  });
});
