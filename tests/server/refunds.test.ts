import { beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../../src/server/db';
import { createExpense } from '../../src/server/actions/expenses';
import { createRefund, deleteRefund } from '../../src/server/actions/refunds';
import { getGroupOverview } from '../../src/server/queries';
import { resetDb } from './reset';

async function seedGroup() {
  return prisma.group.create({
    data: { id: nanoid(24), name: 'Viaje', participants: { create: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }, { name: 'David' }, { name: 'Eva' }] } },
    include: { participants: true },
  });
}

async function seedExpense(groupId: string, paidById: string, beneficiaryIds: string[]) {
  await createExpense(groupId, {
    title: 'Cena',
    date: '2026-07-02',
    payers: [{ participantId: paidById, amount: '300,00' }],
    items: [{
      amount: '300,00',
      splitMode: 'EQUAL' as const,
      shares: beneficiaryIds.map((id) => ({ participantId: id, shareInput: 1 })),
    }],
  });
  return prisma.expense.findFirstOrThrow();
}

describe('createRefund', () => {
  beforeEach(resetDb);

  it('validated example: 300/5 with 30 refund → P +216, others −54', async () => {
    const group = await seedGroup();
    const [ana, beto, carla, david, eva] = group.participants;
    await seedExpense(group.id, ana.id, [ana.id, beto.id, carla.id, david.id, eva.id]);
    const expense = await prisma.expense.findFirstOrThrow();

    const result = await createRefund(group.id, { expenseId: expense.id, receivedById: ana.id, amount: '30,00' });
    expect(result.ok).toBe(true);

    const overview = await getGroupOverview(group.id);
    if (!overview) throw new Error('overview is null');
    const byId = new Map(overview.balances.map((b) => [b.participantId, b.balanceCents]));
    // Original: Ana paid 30000, owes 6000 → +24000; others -6000 each.
    // Refund 3000: Ana -3000 +6000 (also beneficiary) = -24000 net → +21600.
    // Others: +6000 each → -5400.
    expect(byId.get(ana.id)).toBe(21600);
    expect(byId.get(beto.id)).toBe(-5400);
    expect(byId.get(carla.id)).toBe(-5400);
    expect(byId.get(david.id)).toBe(-5400);
    expect(byId.get(eva.id)).toBe(-5400);
    const sum = [...byId.values()].reduce((acc, v) => acc + v, 0);
    expect(sum).toBe(0); // sum-zero invariant
  });

  it('cumulative cap: rejects refund exceeding residual after prior refund', async () => {
    const group = await seedGroup();
    const [ana, beto, carla, david, eva] = group.participants;
    await seedExpense(group.id, ana.id, [ana.id, beto.id, carla.id, david.id, eva.id]);
    const expense = await prisma.expense.findFirstOrThrow();

    // First refund of 3000 (residual 30000 - 3000 = 27000)
    const first = await createRefund(group.id, { expenseId: expense.id, receivedById: ana.id, amount: '30,00' });
    expect(first.ok).toBe(true);

    // Second refund of 28000 exceeds residual 27000
    const second = await createRefund(group.id, { expenseId: expense.id, receivedById: ana.id, amount: '280,00' });
    expect(second).toMatchObject({ ok: false, error: 'El reembolso supera el importe pendiente del gasto' });

    // Second refund of 27000 = exact residual, accepted
    const exact = await createRefund(group.id, { expenseId: expense.id, receivedById: ana.id, amount: '270,00' });
    expect(exact.ok).toBe(true);

    // Third refund of 1 cent exceeds — total is now 30000 = expense total
    const over = await createRefund(group.id, { expenseId: expense.id, receivedById: ana.id, amount: '0,01' });
    expect(over).toMatchObject({ ok: false, error: 'El reembolso supera el importe pendiente del gasto' });
  });

  it('concurrent createRefund calls that jointly exceed the cap — exactly one succeeds (TOCTOU race)', async () => {
    const group = await seedGroup();
    const [ana, beto, carla, david, eva] = group.participants;
    await seedExpense(group.id, ana.id, [ana.id, beto.id, carla.id, david.id, eva.id]);
    const expense = await prisma.expense.findFirstOrThrow();

    // Expense total is 30000. Two concurrent refunds of 20000 each individually
    // pass the cap check (20000 <= 30000) but jointly exceed it (40000 > 30000).
    const [first, second] = await Promise.all([
      createRefund(group.id, { expenseId: expense.id, receivedById: ana.id, amount: '200,00' }),
      createRefund(group.id, { expenseId: expense.id, receivedById: ana.id, amount: '200,00' }),
    ]);

    const results = [first, second];
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ ok: false, error: 'El reembolso supera el importe pendiente del gasto' });

    const sum = await prisma.refund.aggregate({ _sum: { amountCents: true }, where: { expenseId: expense.id } });
    expect(sum._sum.amountCents ?? 0).toBeLessThanOrEqual(30000);
    expect(sum._sum.amountCents ?? 0).toBe(20000); // exactly the one that won the race
  });

  it('deleted-expense guard: refund on deleted expense fails', async () => {
    const group = await seedGroup();
    const [ana, beto, carla, david, eva] = group.participants;
    await seedExpense(group.id, ana.id, [ana.id, beto.id, carla.id, david.id, eva.id]);
    const expense = await prisma.expense.findFirstOrThrow();

    // Delete the expense (cascades to refunds relation)
    await prisma.expense.delete({ where: { id: expense.id } });

    const result = await createRefund(group.id, { expenseId: expense.id, receivedById: ana.id, amount: '10,00' });
    expect(result).toEqual({ ok: false, error: 'El gasto ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.' });
  });

  it('§2.1: refund on expense from another group is a scope miss', async () => {
    const group = await seedGroup();
    const [ana, beto, carla, david, eva] = group.participants;
    await seedExpense(group.id, ana.id, [ana.id, beto.id, carla.id, david.id, eva.id]);
    const expense = await prisma.expense.findFirstOrThrow();

    const other = await prisma.group.create({
      data: { id: nanoid(24), name: 'Otro', participants: { create: [{ name: 'X' }, { name: 'Y' }] } },
      include: { participants: true },
    });

    const result = await createRefund(other.id, { expenseId: expense.id, receivedById: other.participants[0].id, amount: '10,00' });
    expect(result).toEqual({ ok: false, error: 'El gasto ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.' });
  });

  it('logs the refund action', async () => {
    const group = await seedGroup();
    const [ana, beto, carla, david, eva] = group.participants;
    await seedExpense(group.id, ana.id, [ana.id, beto.id, carla.id, david.id, eva.id]);
    const expense = await prisma.expense.findFirstOrThrow();

    await createRefund(group.id, { expenseId: expense.id, receivedById: ana.id, amount: '30,00' });
    const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'refund.create' } });
    expect(log.payload).toMatchObject({ expenseId: expense.id, receivedById: ana.id, amountCents: 3000 });
  });
});

describe('deleteRefund', () => {
  beforeEach(resetDb);

  it('deletes a refund and reverses the balance effect', async () => {
    const group = await seedGroup();
    const [ana, beto, carla, david, eva] = group.participants;
    await seedExpense(group.id, ana.id, [ana.id, beto.id, carla.id, david.id, eva.id]);
    const expense = await prisma.expense.findFirstOrThrow();

    const result = await createRefund(group.id, { expenseId: expense.id, receivedById: ana.id, amount: '30,00' });
    if (!result.ok) throw new Error(result.error);

    // Delete the refund — balances should return to original (Ana +24000, others -6000)
    expect((await deleteRefund(group.id, result.data.id)).ok).toBe(true);
    expect(await prisma.refund.count()).toBe(0);

    const overview = await getGroupOverview(group.id);
    if (!overview) throw new Error('overview is null');
    const byId = new Map(overview.balances.map((b) => [b.participantId, b.balanceCents]));
    expect(byId.get(ana.id)).toBe(24000);
    expect(byId.get(beto.id)).toBe(-6000);
  });

  it('§2.1: wrong group token is a scope miss', async () => {
    const group = await seedGroup();
    const [ana, beto, carla, david, eva] = group.participants;
    await seedExpense(group.id, ana.id, [ana.id, beto.id, carla.id, david.id, eva.id]);
    const expense = await prisma.expense.findFirstOrThrow();
    const refund = await createRefund(group.id, { expenseId: expense.id, receivedById: ana.id, amount: '30,00' });
    if (!refund.ok) throw new Error(refund.error);

    const other = await prisma.group.create({ data: { id: nanoid(24), name: 'Otro' } });
    expect(await deleteRefund(other.id, refund.data.id)).toEqual({ ok: false, error: 'La devolución ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.' });
    expect(await prisma.refund.count()).toBe(1);
  });
});
