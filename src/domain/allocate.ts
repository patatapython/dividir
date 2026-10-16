import { DomainError } from './errors';
import { Cents, asCents } from './money';

/**
 * Largest Remainder Method — the ONLY place in the entire system where
 * rounding happens (spec §3.2).
 *
 * Integer base share per participant, then leftover cents handed out in
 * descending fractional-remainder order, ties broken by lowest index.
 * Guarantees: sum(parts) === total exactly; each part within 1 cent of the
 * continuous ideal; fully deterministic.
 */
export function allocate(total: Cents, weights: number[]): Cents[] {
  if (weights.length === 0) throw new DomainError('NO_BENEFICIARIES');
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) {
    throw new DomainError('NEGATIVE_WEIGHT');
  }
  if (total < 0) throw new DomainError('NEGATIVE_TOTAL');
  const weightSum = weights.reduce((acc, w) => acc + w, 0);
  if (weightSum === 0) throw new DomainError('ZERO_WEIGHT_SUM');

  const parts = weights.map((w) => {
    const product = total * w;
    if (!Number.isSafeInteger(product)) throw new DomainError('UNSAFE_INTEGER');
    return Math.floor(product / weightSum);
  });

  let leftover = total - parts.reduce((acc, p) => acc + p, 0);
  const byRemainder = weights
    .map((w, index) => ({ index, remainder: (total * w) % weightSum }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; leftover > 0; i++, leftover--) {
    parts[byRemainder[i].index] += 1;
  }
  return parts.map(asCents);
}
