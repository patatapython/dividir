// Shared by both settle test files. NOT a .test.ts file: importing helpers
// from a test file would register its tests twice.
import fc from 'fast-check';
import { asCents, type Cents } from '../../src/domain/money';
import type { Transfer } from '../../src/domain/settle';

export function zeroSumBalances(values: number[]): Map<string, Cents> {
  const sum = values.reduce((a, b) => a + b, 0);
  return new Map(values.map((v, i) => [`p${i}`, asCents(i === 0 ? v - sum : v)]));
}

export const zeroSumArb = fc
  .array(fc.integer({ min: -1_000_000, max: 1_000_000 }), { minLength: 1, maxLength: 12 })
  .map(zeroSumBalances);

export function applyTransfers(balances: Map<string, Cents>, transfers: Transfer[]): Map<string, number> {
  const result = new Map<string, number>(balances);
  for (const t of transfers) {
    result.set(t.from, (result.get(t.from) ?? 0) + t.amount);
    result.set(t.to, (result.get(t.to) ?? 0) - t.amount);
  }
  return result;
}
