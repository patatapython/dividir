import { beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../../src/server/db';
import { createExpense } from '../../src/server/actions/expenses';
import { getGroupOverview } from '../../src/server/queries';
import { resetDb } from './reset';

async function seedGroup() {
  return prisma.group.create({
    data: { id: nanoid(24), name: 'Viaje', participants: { create: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }] } },
    include: { participants: true },
  });
}

describe('multi-payer expense', () => {
  beforeEach(resetDb);

  it('two payers split the total; balances reflect both contributions', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;

    const result = await createExpense(group.id, {
      title: 'Cena', date: '2026-07-02',
      payers: [
        { participantId: ana.id, amount: '100,00' },
        { participantId: beto.id, amount: '200,00' },
      ],
      items: [{
        amount: '300,00', splitMode: 'EQUAL',
        shares: [ana, beto, carla].map((p) => ({ participantId: p.id, shareInput: 1 })),
      }],
    });
    expect(result.ok).toBe(true);

    const overview = await getGroupOverview(group.id);
    if (!overview) throw new Error('overview is null');
    const byId = new Map(overview.balances.map((b) => [b.participantId, b.balanceCents]));
    // Ana: paid 10000, owes 10000 → 0; Beto: paid 20000, owes 10000 → +10000;
    // Carla: owes 10000 → -10000
    expect(byId.get(ana.id)).toBe(0);
    expect(byId.get(beto.id)).toBe(10000);
    expect(byId.get(carla.id)).toBe(-10000);
    const sum = [...byId.values()].reduce((acc, v) => acc + v, 0);
    expect(sum).toBe(0);
  });

  it('rejects payer sum mismatch (payers sum != items sum)', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;

    const result = await createExpense(group.id, {
      title: 'Cena', date: '2026-07-02',
      payers: [
        { participantId: ana.id, amount: '100,00' },
        { participantId: beto.id, amount: '150,00' }, // sum=25000, items=30000
      ],
      items: [{
        amount: '300,00', splitMode: 'EQUAL',
        shares: [ana, beto, carla].map((p) => ({ participantId: p.id, shareInput: 1 })),
      }],
    });
    expect(result).toMatchObject({
      ok: false,
      error: 'La suma de los pagadores y la de los ítems deben coincidir',
    });
  });

  it('persists multiple ExpensePayer rows and multiple items', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;

    const result = await createExpense(group.id, {
      title: 'Bar', date: '2026-07-02',
      payers: [
        { participantId: ana.id, amount: '20,00' },
        { participantId: beto.id, amount: '60,00' },
      ],
      items: [
        {
          amount: '50,00', splitMode: 'SHARES',
          shares: [
            { participantId: ana.id, shareInput: 2 },
            { participantId: beto.id, shareInput: 3 },
          ],
        },
        {
          amount: '30,00', splitMode: 'EQUAL',
          shares: [
            { participantId: ana.id, shareInput: 1 },
            { participantId: beto.id, shareInput: 1 },
            { participantId: carla.id, shareInput: 1 },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);

    const expense = await prisma.expense.findFirstOrThrow({
      include: { payers: true, items: { include: { shares: true }, orderBy: { createdAt: 'asc' } } },
    });
    expect(expense.amountCents).toBe(8000);
    expect(expense.payers).toHaveLength(2);
    expect(expense.items).toHaveLength(2);
    expect(expense.items[0].shares).toHaveLength(2); // SHARES item: 2 beneficiaries
    expect(expense.items[1].shares).toHaveLength(3); // EQUAL item: 3 beneficiaries
  });
});

describe('ADJUSTMENT split mode', () => {
  beforeEach(resetDb);

  it('rejects non-zero delta sum', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;

    const result = await createExpense(group.id, {
      title: 'Cena', date: '2026-07-02',
      payers: [{ participantId: ana.id, amount: '100,00' }],
      items: [{
        amount: '100,00', splitMode: 'ADJUSTMENT',
        // deltas sum to 4000-1000-1000-1000-(-1000) = 0 ... but 3 participants
        // with deltas [4000, -1000, -1000] = 3000 ≠ 0
        shares: [
          { participantId: ana.id, shareInput: 4000 },
          { participantId: beto.id, shareInput: -1000 },
          { participantId: carla.id, shareInput: -1000 },
        ],
      }],
    });
    expect(result).toMatchObject({ ok: false, error: 'Los ajustes deben sumar cero' });
  });

  it('accepts zero-sum deltas and produces correct shares', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;

    const result = await createExpense(group.id, {
      title: 'Cena', date: '2026-07-02',
      payers: [{ participantId: ana.id, amount: '100,00' }],
      items: [{
        amount: '100,00', splitMode: 'ADJUSTMENT',
        // 10000/3 = 3333.33 → base [3334, 3333, 3333]; deltas [4000, -2000, -2000] sum 0
        // → [7334, 1333, 1333] sum = 10000
        shares: [
          { participantId: ana.id, shareInput: 4000 },
          { participantId: beto.id, shareInput: -2000 },
          { participantId: carla.id, shareInput: -2000 },
        ],
      }],
    });
    expect(result.ok).toBe(true);

    const expense = await prisma.expense.findFirstOrThrow({
      include: { items: { include: { shares: true } } },
    });
    const shares = expense.items[0].shares;
    const sum = shares.reduce((acc, s) => acc + s.amountCents, 0);
    expect(sum).toBe(10000); // sum to total
  });
});

describe('item totals = expense total', () => {
  beforeEach(resetDb);

  it('multi-item: shares per item sum to item total, combined = expense total', async () => {
    const group = await seedGroup();
    const [ana, beto] = group.participants;

    const result = await createExpense(group.id, {
      title: 'Bar', date: '2026-07-02',
      payers: [{ participantId: ana.id, amount: '80,00' }],
      items: [
        {
          amount: '50,00', splitMode: 'SHARES',
          shares: [
            { participantId: ana.id, shareInput: 2 },
            { participantId: beto.id, shareInput: 3 },
          ],
        },
        {
          amount: '30,00', splitMode: 'EQUAL',
          shares: [
            { participantId: ana.id, shareInput: 1 },
            { participantId: beto.id, shareInput: 1 },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);

    const expense = await prisma.expense.findFirstOrThrow({
      include: { items: { include: { shares: true }, orderBy: { createdAt: 'asc' } } },
    });
    expect(expense.amountCents).toBe(8000);
    // Item 1: 5000, SHARES 2:3 → 2000 + 3000
    const item1Sum = expense.items[0].shares.reduce((acc, s) => acc + s.amountCents, 0);
    expect(item1Sum).toBe(5000);
    // Item 2: 3000, EQUAL → 1500 + 1500
    const item2Sum = expense.items[1].shares.reduce((acc, s) => acc + s.amountCents, 0);
    expect(item2Sum).toBe(3000);
  });
});
