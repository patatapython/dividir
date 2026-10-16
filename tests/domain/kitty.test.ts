import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { kittyBalance, distributeKitty } from '@/domain/kitty';
import { asCents } from '@/domain/money';
import { DomainError } from '@/domain/errors';

describe('kittyBalance', () => {
  it('is carryIn + sum(contributions) - sum(spends)', () => {
    expect(kittyBalance({ carryInCents: asCents(1500), contributions: [asCents(6000)], spends: [asCents(5000)] })).toBe(2500);
  });
  it('property: equals the manual sum for any inputs', () => {
    fc.assert(fc.property(
      fc.nat(100000), fc.array(fc.nat(100000)), fc.array(fc.nat(100000)),
      (carry, contribs, spends) => {
        const expected = carry + contribs.reduce((a, c) => a + c, 0) - spends.reduce((a, s) => a + s, 0);
        return kittyBalance({
          carryInCents: asCents(carry),
          contributions: contribs.map(asCents),
          spends: spends.map(asCents),
        }) === expected;
      },
    ));
  });
});

describe('distributeKitty', () => {
  it('splits proportional to contribution, summing exactly to the balance', () => {
    const out = distributeKitty(asCents(3000), [
      { participantId: 'a', amountCents: asCents(3000) },
      { participantId: 'b', amountCents: asCents(3000) },
      { participantId: 'c', amountCents: asCents(2000) },
      { participantId: 'd', amountCents: asCents(3000) },
      { participantId: 'f', amountCents: asCents(1000) },
    ]);
    expect(out.reduce((a, p) => a + p.amountCents, 0)).toBe(3000);
  });
  it('equal contributions → equal payout (25 among 5 = 5,00 each)', () => {
    const out = distributeKitty(asCents(2500), ['a', 'b', 'c', 'd', 'f'].map((id) => ({ participantId: id, amountCents: asCents(1200) })));
    expect(out.map((p) => p.amountCents)).toEqual([500, 500, 500, 500, 500]);
  });
  it('throws when there is nothing to distribute (no contributions / zero weights)', () => {
    expect(() => distributeKitty(asCents(1000), [])).toThrow(DomainError);
    expect(() => distributeKitty(asCents(1000), [{ participantId: 'a', amountCents: asCents(0) }])).toThrow(DomainError);
  });
  it('throws when the bote is at 0: a payout of zeros is not a distribution (session 12)', () => {
    expect(() => distributeKitty(asCents(0), [{ participantId: 'a', amountCents: asCents(1000) }]))
      .toThrow(expect.objectContaining({ code: 'KITTY_NOTHING_TO_DISTRIBUTE' }));
  });
  it('property: payouts are non-negative and sum to the balance', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 500000 }),
      fc.array(fc.record({ id: fc.string({ minLength: 1 }), w: fc.integer({ min: 1, max: 10000 }) }), { minLength: 1, maxLength: 12 }),
      (balance, rows) => {
        const out = distributeKitty(asCents(balance), rows.map((r, i) => ({ participantId: r.id + i, amountCents: asCents(r.w) })));
        return out.every((p) => p.amountCents >= 0) && out.reduce((a, p) => a + p.amountCents, 0) === balance;
      },
    ));
  });
});
