import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  computeBalances,
  filterSettleable,
  OWNERLESS,
  type PersonForSettle,
} from '../../src/domain/balances';
import { asCents, type Cents } from '../../src/domain/money';
import { computeShares } from '../../src/domain/split';
import { settle } from '../../src/domain/settle';

const POOL = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'];

const expenseArb = fc
  .record({
    payer: fc.integer({ min: 0, max: POOL.length - 1 }),
    total: fc.integer({ min: 1, max: 1_000_000 }),
    beneficiaries: fc.uniqueArray(fc.integer({ min: 0, max: POOL.length - 1 }), { minLength: 1 }),
  })
  .map(({ payer, total, beneficiaries }) => {
    const inputs = beneficiaries.map((i) => ({ participantId: POOL[i], shareInput: 1 }));
    const shares = computeShares('EQUAL', asCents(total), inputs);
    return { payers: [{ participantId: POOL[payer], amountCents: asCents(total) }], shares };
  });

// Like expenseArb, but part of the total is paid by "nadie" (participantId null).
const ownerlessExpenseArb = fc
  .record({
    person: fc.integer({ min: 0, max: POOL.length - 1 }),
    total: fc.integer({ min: 1, max: 1_000_000 }),
    ownerlessCut: fc.integer({ min: 0, max: 1_000_000 }),
    beneficiaries: fc.uniqueArray(fc.integer({ min: 0, max: POOL.length - 1 }), { minLength: 1 }),
  })
  .map(({ person, total, ownerlessCut, beneficiaries }) => {
    const nadie = Math.min(ownerlessCut, total);
    const inputs = beneficiaries.map((i) => ({ participantId: POOL[i], shareInput: 1 }));
    const shares = computeShares('EQUAL', asCents(total), inputs);
    return {
      payers: [
        { participantId: null, amountCents: asCents(nadie) },
        { participantId: POOL[person], amountCents: asCents(total - nadie) },
      ],
      shares,
    };
  });

const paymentArb = fc
  .record({
    from: fc.integer({ min: 0, max: POOL.length - 1 }),
    to: fc.integer({ min: 0, max: POOL.length - 1 }),
    amount: fc.integer({ min: 1, max: 1_000_000 }),
  })
  .filter(({ from, to }) => from !== to)
  .map(({ from, to, amount }) => ({ fromId: POOL[from], toId: POOL[to], amountCents: asCents(amount) }));

describe('computeBalances', () => {
  it('balances always sum to exactly 0 (property)', () => {
    fc.assert(
      fc.property(fc.array(expenseArb, { maxLength: 25 }), fc.array(paymentArb, { maxLength: 25 }), (expenses, payments) => {
        const balances = computeBalances(POOL, expenses, payments);
        return [...balances.values()].reduce((a, b) => a + b, 0) === 0;
      }),
    );
  });

  it('balances still sum to 0 when part of an expense is paid by nadie (property)', () => {
    fc.assert(
      fc.property(fc.array(ownerlessExpenseArb, { maxLength: 25 }), (expenses) => {
        const balances = computeBalances(POOL, expenses, []);
        return [...balances.values()].reduce((a, b) => a + b, 0) === 0;
      }),
    );
  });

  it('worked example: 30,00 paid by A split equally among 3', () => {
    const shares = computeShares('EQUAL', asCents(3000), [
      { participantId: 'A', shareInput: 1 },
      { participantId: 'B', shareInput: 1 },
      { participantId: 'C', shareInput: 1 },
    ]);
    const balances = computeBalances(['A', 'B', 'C'], [{ payers: [{ participantId: 'A', amountCents: asCents(3000) }], shares }], []);
    expect(balances.get('A')).toBe(2000);
    expect(balances.get('B')).toBe(-1000);
    expect(balances.get('C')).toBe(-1000);
  });

  it('a settlement payment moves balances toward zero', () => {
    const balances = computeBalances(
      ['A', 'B'],
      [{ payers: [{ participantId: 'A', amountCents: asCents(1000) }], shares: [{ participantId: 'A', amountCents: asCents(500) }, { participantId: 'B', amountCents: asCents(500) }] }],
      [{ fromId: 'B', toId: 'A', amountCents: asCents(500) }],
    );
    expect(balances.get('A')).toBe(0);
    expect(balances.get('B')).toBe(0);
  });

  it('participants without movements appear with balance 0', () => {
    const balances = computeBalances(['A', 'B'], [], []);
    expect([...balances.entries()]).toEqual([['A', 0], ['B', 0]]);
  });

  // §6 Case B: Comida 200 paid by Bote(nadie) 100 + Ana 100, equal split → 50 each.
  it('§6 Case B: an ownerless payer accrues into the OWNERLESS bucket', () => {
    const shares = computeShares('EQUAL', asCents(20000), [
      { participantId: 'Ana', shareInput: 1 },
      { participantId: 'Beto', shareInput: 1 },
      { participantId: 'Carla', shareInput: 1 },
      { participantId: 'Dani', shareInput: 1 },
    ]);
    const balances = computeBalances(
      ['Ana', 'Beto', 'Carla', 'Dani'],
      [
        {
          payers: [
            { participantId: null, amountCents: asCents(10000) },
            { participantId: 'Ana', amountCents: asCents(10000) },
          ],
          shares,
        },
      ],
      [],
    );
    expect(balances.get('Ana')).toBe(5000);
    expect(balances.get('Beto')).toBe(-5000);
    expect(balances.get('Carla')).toBe(-5000);
    expect(balances.get('Dani')).toBe(-5000);
    expect(balances.get(OWNERLESS)).toBe(10000);
    expect([...balances.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('filterSettleable — ownerless bucket fold', () => {
  // Any zero-sum mix of active/archived people plus one ownerless bucket: the
  // settleable vector (bucket folded onto active people, sign preserved) must
  // sum to exactly 0 BY CONSTRUCTION, and settle() must never throw UNBALANCED.
  const scenarioArb = fc
    .record({
      activeCount: fc.integer({ min: 0, max: 8 }),
      archivedCount: fc.integer({ min: 0, max: 4 }),
      ownerlessBalance: fc.integer({ min: -1_000_000, max: 1_000_000 }),
    });

  it('settleable vector sums to exactly 0 and settle() never throws (property)', () => {
    fc.assert(
      fc.property(scenarioArb, ({ activeCount, archivedCount, ownerlessBalance }) => {
        const activeIds = Array.from({ length: activeCount }, (_, i) => `active${i}`);
        const archivedIds = Array.from({ length: archivedCount }, (_, i) => `archived${i}`);

        // Nowhere to fold a nonzero ownerless balance onto — degenerate, skip.
        if (activeIds.length === 0 && archivedIds.length === 0 && ownerlessBalance !== 0) return true;

        const balances = new Map<string, Cents>();
        for (const id of activeIds) balances.set(id, asCents(0));
        for (const id of archivedIds) balances.set(id, asCents(0));
        balances.set(OWNERLESS, asCents(ownerlessBalance));
        // Restore the overall zero-sum invariant by parking the offset on the
        // first person (spec: computeBalances always sums to 0).
        const sink = activeIds[0] ?? archivedIds[0];
        if (sink !== undefined) balances.set(sink, asCents((balances.get(sink) ?? 0) - ownerlessBalance));

        const people: PersonForSettle[] = [
          ...activeIds.map((id) => ({ id, isArchived: false })),
          ...archivedIds.map((id) => ({ id, isArchived: true })),
        ];

        const settleable = filterSettleable(balances, people);
        expect(settleable.has(OWNERLESS)).toBe(false);
        const sum = [...settleable.values()].reduce((a, b) => a + b, 0);
        expect(sum).toBe(0);
        expect(() => settle(settleable)).not.toThrow();
        return true;
      }),
    );
  });

  // §6 Case B: bucket +100 folds +25 onto each of the 4 active people.
  it('§6 Case B: bucket +100,00 folds +25,00 onto each active person', () => {
    const balances = new Map<string, Cents>([
      ['Ana', asCents(5000)],
      ['Beto', asCents(-5000)],
      ['Carla', asCents(-5000)],
      ['Dani', asCents(-5000)],
      [OWNERLESS, asCents(10000)],
    ]);
    const people: PersonForSettle[] = [
      { id: 'Ana', isArchived: false },
      { id: 'Beto', isArchived: false },
      { id: 'Carla', isArchived: false },
      { id: 'Dani', isArchived: false },
    ];
    const settleable = filterSettleable(balances, people);
    expect(settleable.has(OWNERLESS)).toBe(false);
    expect(settleable.get('Ana')).toBe(7500);
    expect(settleable.get('Beto')).toBe(-2500);
    expect(settleable.get('Carla')).toBe(-2500);
    expect(settleable.get('Dani')).toBe(-2500);
    expect([...settleable.values()].reduce((a, b) => a + b, 0)).toBe(0);

    const transfers = settle(settleable);
    expect(transfers).toContainEqual({ from: 'Beto', to: 'Ana', amount: 2500 });
    expect(transfers).toContainEqual({ from: 'Carla', to: 'Ana', amount: 2500 });
    expect(transfers).toContainEqual({ from: 'Dani', to: 'Ana', amount: 2500 });
    expect(transfers).toHaveLength(3);
  });

  it('a negative (deficit) bucket subtracts equally from active people', () => {
    const balances = new Map<string, Cents>([
      ['a', asCents(50)],
      ['b', asCents(50)],
      [OWNERLESS, asCents(-100)],
    ]);
    const people: PersonForSettle[] = [
      { id: 'a', isArchived: false },
      { id: 'b', isArchived: false },
    ];
    const settleable = filterSettleable(balances, people);
    expect(settleable.get('a')).toBe(0);
    expect(settleable.get('b')).toBe(0);
  });

  it('with no active people the bucket folds onto archived people (zero-sum preserved)', () => {
    const balances = new Map<string, Cents>([
      ['a', asCents(-30)],
      ['b', asCents(-30)],
      ['c', asCents(-30)],
      [OWNERLESS, asCents(90)],
    ]);
    const people: PersonForSettle[] = [
      { id: 'a', isArchived: true },
      { id: 'b', isArchived: true },
      { id: 'c', isArchived: true },
    ];
    const settleable = filterSettleable(balances, people);
    expect(settleable.get('a')).toBe(0);
    expect(settleable.get('b')).toBe(0);
    expect(settleable.get('c')).toBe(0);
    expect([...settleable.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('a zero bucket leaves people untouched and is dropped', () => {
    const balances = new Map<string, Cents>([
      ['a', asCents(100)],
      ['b', asCents(-100)],
      [OWNERLESS, asCents(0)],
    ]);
    const people: PersonForSettle[] = [
      { id: 'a', isArchived: false },
      { id: 'b', isArchived: false },
    ];
    const settleable = filterSettleable(balances, people);
    expect(settleable.has(OWNERLESS)).toBe(false);
    expect(settleable.get('a')).toBe(100);
    expect(settleable.get('b')).toBe(-100);
  });

  it('with no ownerless bucket at all it is a pass-through of the people balances', () => {
    const balances = new Map<string, Cents>([
      ['a', asCents(100)],
      ['b', asCents(-100)],
    ]);
    const people: PersonForSettle[] = [
      { id: 'a', isArchived: false },
      { id: 'b', isArchived: false },
    ];
    const settleable = filterSettleable(balances, people);
    expect(settleable.get('a')).toBe(100);
    expect(settleable.get('b')).toBe(-100);
  });
});
