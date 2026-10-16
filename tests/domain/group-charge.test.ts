import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { externalChargesByParticipant, finalAccount } from '../../src/domain/group-charge';
import { computeBalances, filterSettleable, type PersonForSettle } from '../../src/domain/balances';
import { asCents } from '../../src/domain/money';
import { computeShares } from '../../src/domain/split';
import { settle } from '../../src/domain/settle';

describe('externalChargesByParticipant', () => {
  it('sums a single charge share per participant', () => {
    const charges = [
      {
        shares: [
          { participantId: 'a', amountCents: asCents(10000) },
          { participantId: 'b', amountCents: asCents(10000) },
        ],
      },
    ];
    const totals = externalChargesByParticipant(charges);
    expect(totals.get('a')).toBe(10000);
    expect(totals.get('b')).toBe(10000);
  });

  it('accumulates several charges per participant', () => {
    const charges = [
      { shares: [{ participantId: 'a', amountCents: asCents(1000) }, { participantId: 'b', amountCents: asCents(2000) }] },
      { shares: [{ participantId: 'a', amountCents: asCents(500) }] },
    ];
    const totals = externalChargesByParticipant(charges);
    expect(totals.get('a')).toBe(1500);
    expect(totals.get('b')).toBe(2000);
  });

  it('returns an empty map for no charges', () => {
    expect([...externalChargesByParticipant([]).entries()]).toEqual([]);
  });
});

// §6 Case A: Casa rural 400 (no payer) equal → 100 each OUTSIDE; Comida 80 paid
// by Ana equal → Beto/Carla/Dani owe Ana 20 INSIDE. The two layers never mix.
describe('§6 Case A — unpaid group charge vs internal settle', () => {
  const people: PersonForSettle[] = [
    { id: 'Ana', isArchived: false },
    { id: 'Beto', isArchived: false },
    { id: 'Carla', isArchived: false },
    { id: 'Dani', isArchived: false },
  ];
  const ids = people.map((p) => p.id);
  const inputs = ids.map((id) => ({ participantId: id, shareInput: 1 }));

  it('external charges: each person owes 100,00 outside', () => {
    const casaShares = computeShares('EQUAL', asCents(40000), inputs);
    const totals = externalChargesByParticipant([{ shares: casaShares }]);
    expect(totals.get('Ana')).toBe(10000);
    expect(totals.get('Beto')).toBe(10000);
    expect(totals.get('Carla')).toBe(10000);
    expect(totals.get('Dani')).toBe(10000);
  });

  it('internal settle sees only the comida: Beto/Carla/Dani → Ana 20,00', () => {
    const comidaShares = computeShares('EQUAL', asCents(8000), inputs);
    const balances = computeBalances(
      ids,
      [{ payers: [{ participantId: 'Ana', amountCents: asCents(8000) }], shares: comidaShares }],
      [],
    );
    const settleable = filterSettleable(balances, people);
    const transfers = settle(settleable);
    expect(transfers).toContainEqual({ from: 'Beto', to: 'Ana', amount: 2000 });
    expect(transfers).toContainEqual({ from: 'Carla', to: 'Ana', amount: 2000 });
    expect(transfers).toContainEqual({ from: 'Dani', to: 'Ana', amount: 2000 });
    expect(transfers).toHaveLength(3);
  });
});

// Owner review (session 10): while a charge is unpaid each person answers two
// accounts at once — the internal settlement and their share paid outside —
// and neither may hide the other in one netted number.
describe('finalAccount', () => {
  it('a debtor puts in both debts', () => {
    expect(finalAccount(asCents(-934), asCents(6667))).toEqual({ paysInside: 934, paysOutside: 6667, receives: 0, totalToPay: 7601 });
  });

  it('a creditor still pays their share outside and receives from the group', () => {
    expect(finalAccount(asCents(3067), asCents(6666))).toEqual({ paysInside: 0, paysOutside: 6666, receives: 3067, totalToPay: 6666 });
  });

  it('with no unpaid charges it is the internal balance alone', () => {
    expect(finalAccount(asCents(-500), asCents(0))).toEqual({ paysInside: 500, paysOutside: 0, receives: 0, totalToPay: 500 });
    expect(finalAccount(asCents(0), asCents(0))).toEqual({ paysInside: 0, paysOutside: 0, receives: 0, totalToPay: 0 });
  });

  it('never nets one account against the other', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.integer({ min: 0, max: 1_000_000 }), (net, outside) => {
        const a = finalAccount(asCents(net), asCents(outside));
        expect(a.paysOutside).toBe(outside);
        expect(a.receives - a.paysInside).toBe(net);
        expect(Math.min(a.receives, a.paysInside)).toBe(0);
        expect(a.totalToPay).toBe(a.paysInside + a.paysOutside);
      }),
    );
  });
});
