import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../../src/server/db';
import { createExpense, deleteExpense, updateExpense } from '../../src/server/actions/expenses';
import { createRefund } from '../../src/server/actions/refunds';
import { archiveParticipant } from '../../src/server/actions/participants';
import { getGroupOverview } from '../../src/server/queries';
import { resetDb } from './reset';

async function seedGroup() {
  return prisma.group.create({
    data: { id: nanoid(24), name: 'Viaje', participants: { create: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }] } },
    include: { participants: true },
  });
}

const baseInput = (paidById: string, ids: string[]) => ({
  title: 'Cena',
  date: '2026-07-02',
  payers: [{ participantId: paidById, amount: '30,00' }],
  items: [{
    amount: '30,00',
    splitMode: 'EQUAL' as const,
    shares: ids.map((participantId) => ({ participantId, shareInput: 1 })),
  }],
});

describe('createExpense', () => {
  beforeEach(resetDb);

  it('EQUAL: persists shares that sum exactly to the total', async () => {
    const group = await seedGroup();
    const ids = group.participants.map((p) => p.id);
    const result = await createExpense(group.id, baseInput(ids[0], ids));
    if (!result.ok) throw new Error(result.error);
    const expense = await prisma.expense.findFirstOrThrow({ include: { payers: true, items: { include: { shares: true } } } });
    expect(expense.amountCents).toBe(3000);
    expect(expense.items[0].shares.map((s) => s.amountCents).sort()).toEqual([1000, 1000, 1000]);
    const sum = await prisma.expenseShare.aggregate({ _sum: { amountCents: true }, where: { item: { expenseId: expense.id } } });
    expect(sum._sum.amountCents ?? 0).toBe(expense.amountCents); // §6 transaction integrity
  });

  it('PERCENTAGE: rejects hundredths not summing 10000; accepts exact split', async () => {
    const group = await seedGroup();
    const [a, b] = group.participants.map((p) => p.id);
    const bad = await createExpense(group.id, {
      ...baseInput(a, []), items: [{
        amount: '30,00', splitMode: 'PERCENTAGE',
        shares: [{ participantId: a, shareInput: 5000 }, { participantId: b, shareInput: 4999 }],
      }],
    });
    expect(bad).toMatchObject({ ok: false, error: 'Los porcentajes deben sumar exactamente 100 %' });
    const good = await createExpense(group.id, {
      ...baseInput(a, []), items: [{
        amount: '30,00', splitMode: 'PERCENTAGE',
        shares: [{ participantId: a, shareInput: 3333 }, { participantId: b, shareInput: 6667 }],
      }],
    });
    expect(good.ok).toBe(true);
  });

  it('EXACT: rejects amounts not summing to total', async () => {
    const group = await seedGroup();
    const [a, b] = group.participants.map((p) => p.id);
    const bad = await createExpense(group.id, {
      ...baseInput(a, []), items: [{
        amount: '30,00', splitMode: 'EXACT',
        shares: [{ participantId: a, shareInput: 1000 }, { participantId: b, shareInput: 1000 }],
      }],
    });
    expect(bad).toMatchObject({ ok: false, error: 'Los importes deben sumar exactamente el total' });
  });

  it('rejects an invalid amount string with the Spanish parse error', async () => {
    const group = await seedGroup();
    const ids = group.participants.map((p) => p.id);
    const result = await createExpense(group.id, {
      ...baseInput(ids[0], ids),
      payers: [{ participantId: ids[0], amount: '12,345' }],
      items: [{ amount: '12,345', splitMode: 'EQUAL', shares: ids.map((id) => ({ participantId: id, shareInput: 1 })) }],
    });
    expect(result).toMatchObject({ ok: false, error: 'Importe no válido (ejemplo: 12,50)' });
  });

  it('§2.1: rejects a beneficiary from ANOTHER group as a scope miss', async () => {
    const group = await seedGroup();
    const other = await prisma.group.create({
      data: { id: nanoid(24), name: 'Otro', participants: { create: [{ name: 'X' }, { name: 'Y' }] } },
      include: { participants: true },
    });
    const ids = group.participants.map((p) => p.id);
    const result = await createExpense(group.id, {
      ...baseInput(ids[0], []),
      items: [{
        amount: '30,00', splitMode: 'EQUAL',
        shares: [{ participantId: ids[0], shareInput: 1 }, { participantId: other.participants[0].id, shareInput: 1 }],
      }],
    });
    expect(result).toEqual({ ok: false, error: 'El participante ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.' });
  });

  it('stores the calendar date without timezone shift and logs created snapshot', async () => {
    const group = await seedGroup();
    const ids = group.participants.map((p) => p.id);
    await createExpense(group.id, baseInput(ids[0], ids));
    const expense = await prisma.expense.findFirstOrThrow();
    expect(expense.date.toISOString()).toBe('2026-07-02T00:00:00.000Z');
    const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'expense.create' } });
    expect(log.payload).toMatchObject({ title: 'Cena', amountCents: 3000, date: '2026-07-02', splitMode: 'EQUAL' });
  });
});

describe('item labels', () => {
  beforeEach(resetDb);

  const itemized = (payerId: string, ids: string[], labels: [string | undefined, string | undefined]) => ({
    title: 'Compra',
    date: '2026-07-02',
    payers: [{ participantId: payerId, amount: '30,00' }],
    items: [
      { ...(labels[0] ? { label: labels[0] } : {}), amount: '20,00', splitMode: 'EQUAL' as const, shares: ids.map((participantId) => ({ participantId, shareInput: 1 })) },
      { ...(labels[1] ? { label: labels[1] } : {}), amount: '10,00', splitMode: 'EQUAL' as const, shares: ids.map((participantId) => ({ participantId, shareInput: 1 })) },
    ],
  });
  const storedLabels = async (expenseId: string) =>
    (await prisma.expenseItem.findMany({ where: { expenseId }, orderBy: { amountCents: 'desc' } })).map((i) => i.label);

  it('createExpense stores each line label, and none for a line without one', async () => {
    const group = await seedGroup();
    const ids = group.participants.map((p) => p.id);
    const result = await createExpense(group.id, itemized(ids[0], ids, ['Comida', undefined]));
    if (!result.ok) throw new Error(result.error);
    expect(await storedLabels(result.data.id)).toEqual(['Comida', null]);
  });

  it('updateExpense stores the new labels', async () => {
    const group = await seedGroup();
    const ids = group.participants.map((p) => p.id);
    const created = await createExpense(group.id, itemized(ids[0], ids, ['Comida', 'Vino']));
    if (!created.ok) throw new Error(created.error);
    const result = await updateExpense(group.id, created.data.id, itemized(ids[0], ids, ['Carne', undefined]));
    expect(result.ok).toBe(true);
    expect(await storedLabels(created.data.id)).toEqual(['Carne', null]);
  });
});

describe('updateExpense / deleteExpense', () => {
  beforeEach(resetDb);

  it('update rewrites shares atomically and logs {previous,next} snapshots', async () => {
    const group = await seedGroup();
    const ids = group.participants.map((p) => p.id);
    await createExpense(group.id, baseInput(ids[0], ids));
    const expense = await prisma.expense.findFirstOrThrow();
    const result = await updateExpense(group.id, expense.id, {
      title: 'Cena corregida',
      date: '2026-07-02',
      payers: [{ participantId: ids[1], amount: '40,00' }],
      items: [{
        amount: '40,00', splitMode: 'EQUAL',
        shares: [{ participantId: ids[0], shareInput: 1 }, { participantId: ids[1], shareInput: 1 }],
      }],
    });
    expect(result.ok).toBe(true);
    const updated = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id }, include: { payers: true, items: { include: { shares: true } } } });
    expect(updated.title).toBe('Cena corregida');
    expect(updated.amountCents).toBe(4000);
    expect(updated.items[0].shares).toHaveLength(2);
    const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'expense.update' } });
    expect(log.payload).toMatchObject({ previous: { title: 'Cena', amountCents: 3000 }, next: { title: 'Cena corregida', amountCents: 4000 } });
  });

  it('editing an expense after a refund keeps the original refund attribution (frozen snapshot)', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;
    await createExpense(group.id, baseInput(ana.id, [ana.id, beto.id, carla.id]));
    const expense = await prisma.expense.findFirstOrThrow();

    const refund = await createRefund(group.id, { expenseId: expense.id, receivedById: ana.id, amount: '3,00' });
    if (!refund.ok) throw new Error(refund.error);
    const beforeSnapshot = await prisma.refund.findUniqueOrThrow({ where: { id: refund.data.id } });
    expect(beforeSnapshot.sharesSnapshot).toEqual([
      { participantId: ana.id, amountCents: 100 },
      { participantId: beto.id, amountCents: 100 },
      { participantId: carla.id, amountCents: 100 },
    ]);

    // Edit the expense to drop Carla as a beneficiary entirely (same total,
    // so the refund cap re-validation trivially passes).
    const result = await updateExpense(group.id, expense.id, {
      title: 'Cena', date: '2026-07-02',
      payers: [{ participantId: ana.id, amount: '30,00' }],
      items: [{ amount: '30,00', splitMode: 'EQUAL', shares: [{ participantId: ana.id, shareInput: 1 }, { participantId: beto.id, shareInput: 1 }] }],
    });
    expect(result.ok).toBe(true);

    // The refund's snapshot is UNCHANGED — Carla still gets credited for a
    // refund on an expense she is no longer a beneficiary of.
    const afterSnapshot = await prisma.refund.findUniqueOrThrow({ where: { id: refund.data.id } });
    expect(afterSnapshot.sharesSnapshot).toEqual(beforeSnapshot.sharesSnapshot);

    const overview = await getGroupOverview(group.id);
    if (!overview) throw new Error('overview is null');
    const byId = new Map(overview.balances.map((b) => [b.participantId, b.balanceCents]));
    // ana: paid 3000, owes 1500 (edited share), refund -300 (received), +100 (own mirrored share) = 1300
    // beto: owes 1500 (edited share), +100 (mirrored share) = -1400
    // carla: no longer a beneficiary of the expense, but still +100 from the frozen refund snapshot
    expect(byId.get(ana.id)).toBe(1300);
    expect(byId.get(beto.id)).toBe(-1400);
    expect(byId.get(carla.id)).toBe(100);
    expect(overview.balances.reduce((acc, b) => acc + b.balanceCents, 0)).toBe(0);
  });

  it('rejects shrinking the total below the sum of existing refunds', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;
    await createExpense(group.id, baseInput(ana.id, [ana.id, beto.id, carla.id]));
    const expense = await prisma.expense.findFirstOrThrow();

    const refund = await createRefund(group.id, { expenseId: expense.id, receivedById: ana.id, amount: '20,00' });
    expect(refund.ok).toBe(true);

    // New total (10,00 = 1000 cents) is below the 2000 already refunded.
    const result = await updateExpense(group.id, expense.id, {
      title: 'Cena', date: '2026-07-02',
      payers: [{ participantId: ana.id, amount: '10,00' }],
      items: [{ amount: '10,00', splitMode: 'EQUAL', shares: [ana, beto, carla].map((p) => ({ participantId: p.id, shareInput: 1 })) }],
    });
    expect(result).toEqual({ ok: false, error: 'El reembolso supera el importe pendiente del gasto' });

    // Nothing was silently accepted — the expense total is unchanged.
    const unchanged = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(unchanged.amountCents).toBe(3000);
  });

  it('concurrent updateExpense (shrink) vs createRefund that are individually valid but jointly violate the cap — exactly one succeeds', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;
    await createExpense(group.id, baseInput(ana.id, [ana.id, beto.id, carla.id]));
    const expense = await prisma.expense.findFirstOrThrow();

    // Expense total is 3000, no prior refunds. Shrinking to 1000 is
    // individually valid (0 <= 1000), and a 2000 refund is individually
    // valid against the original 3000 (0 + 2000 <= 3000) — but the two
    // together would leave sum(refunds) = 2000 > amountCents = 1000.
    const [updateResult, refundResult] = await Promise.all([
      updateExpense(group.id, expense.id, {
        title: 'Cena', date: '2026-07-02',
        payers: [{ participantId: ana.id, amount: '10,00' }],
        items: [{ amount: '10,00', splitMode: 'EQUAL', shares: [ana, beto, carla].map((p) => ({ participantId: p.id, shareInput: 1 })) }],
      }),
      createRefund(group.id, { expenseId: expense.id, receivedById: ana.id, amount: '20,00' }),
    ]);

    const results = [updateResult, refundResult];
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ ok: false, error: 'El reembolso supera el importe pendiente del gasto' });

    // Whichever interleaving won the race, the invariant holds: the sum of
    // refunds never exceeds the expense's current total.
    const finalExpense = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
    const refundSum = await prisma.refund.aggregate({ _sum: { amountCents: true }, where: { expenseId: expense.id } });
    expect(refundSum._sum.amountCents ?? 0).toBeLessThanOrEqual(finalExpense.amountCents);
  });

  it('editing an unrelated field succeeds even when a beneficiary was archived after creation', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;
    await createExpense(group.id, baseInput(ana.id, [ana.id, beto.id, carla.id]));
    const expense = await prisma.expense.findFirstOrThrow();

    expect((await archiveParticipant(group.id, carla.id)).ok).toBe(true);

    // Only the title changes — Carla (archived) stays as a beneficiary with
    // the exact same share, which must NOT be rejected.
    const result = await updateExpense(group.id, expense.id, {
      title: 'Cena renombrada', date: '2026-07-02',
      payers: [{ participantId: ana.id, amount: '30,00' }],
      items: [{ amount: '30,00', splitMode: 'EQUAL', shares: [ana, beto, carla].map((p) => ({ participantId: p.id, shareInput: 1 })) }],
    });
    expect(result.ok).toBe(true);
    const updated = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(updated.title).toBe('Cena renombrada');
  });

  it('an edit that keeps an archived participant\'s share unchanged succeeds', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;
    await createExpense(group.id, baseInput(ana.id, [ana.id, beto.id, carla.id]));
    const expense = await prisma.expense.findFirstOrThrow();

    expect((await archiveParticipant(group.id, beto.id)).ok).toBe(true);

    const result = await updateExpense(group.id, expense.id, {
      title: 'Cena', date: '2026-07-02',
      payers: [{ participantId: ana.id, amount: '30,00' }],
      items: [{ amount: '30,00', splitMode: 'EQUAL', shares: [ana, beto, carla].map((p) => ({ participantId: p.id, shareInput: 1 })) }],
    });
    expect(result.ok).toBe(true);
  });

  it('an edit that ADDS a different archived participant is rejected', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;
    await createExpense(group.id, baseInput(ana.id, [ana.id, beto.id]));
    const expense = await prisma.expense.findFirstOrThrow();

    // Diana was never referenced by the original expense, and is archived
    // before this edit tries to add her as a new beneficiary.
    const diana = await prisma.participant.create({ data: { groupId: group.id, name: 'Diana' } });
    expect((await archiveParticipant(group.id, diana.id)).ok).toBe(true);

    const result = await updateExpense(group.id, expense.id, {
      title: 'Cena', date: '2026-07-02',
      payers: [{ participantId: ana.id, amount: '30,00' }],
      items: [{ amount: '30,00', splitMode: 'EQUAL', shares: [ana, beto, carla, diana].map((p) => ({ participantId: p.id, shareInput: 1 })) }],
    });
    expect(result).toEqual({ ok: false, error: 'No se puede usar un participante archivado' });
  });

  it('delete removes expense + shares and logs the snapshot', async () => {
    const group = await seedGroup();
    const ids = group.participants.map((p) => p.id);
    await createExpense(group.id, baseInput(ids[0], ids));
    const expense = await prisma.expense.findFirstOrThrow();
    expect((await deleteExpense(group.id, expense.id)).ok).toBe(true);
    expect(await prisma.expense.count()).toBe(0);
    expect(await prisma.expenseShare.count()).toBe(0);
    const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'expense.delete' } });
    expect(log.payload).toMatchObject({ previous: { title: 'Cena', amountCents: 3000 } });
  });

  it('§2.1: expense id under the wrong group token is a scope miss', async () => {
    const group = await seedGroup();
    const other = await prisma.group.create({
      data: { id: nanoid(24), name: 'Otro', participants: { create: [{ name: 'X' }, { name: 'Y' }] } },
    });
    const ids = group.participants.map((p) => p.id);
    await createExpense(group.id, baseInput(ids[0], ids));
    const expense = await prisma.expense.findFirstOrThrow();
    expect(await deleteExpense(other.id, expense.id)).toEqual({ ok: false, error: 'El gasto ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.' });
    expect(await prisma.expense.count()).toBe(1);
  });
});

describe('editing an expense another phone just deleted', () => {
  beforeEach(resetDb);

  // Session 11 simulation (K7): the edit locked a row that no longer existed and
  // ended in the general "otro cambio" message; it now says what went.
  it('says the expense no longer exists, and leaves nothing behind', async () => {
    const group = await prisma.group.create({
      data: { id: nanoid(24), name: 'Piso', participants: { create: [{ name: 'Ana' }, { name: 'Beto' }] } },
      include: { participants: true },
    });
    const [ana, beto] = group.participants;
    const input = {
      title: 'Cena', date: '2026-09-01', payers: [{ participantId: ana.id, amount: '20,00' }],
      items: [{ amount: '20,00', splitMode: 'EQUAL', shares: [ana, beto].map((p) => ({ participantId: p.id, shareInput: 1 })) }],
    };
    const created = await createExpense(group.id, input);
    if (!created.ok) throw new Error(created.error);
    const findFirst = prisma.expense.findFirst.bind(prisma.expense);
    vi.spyOn(prisma.expense, 'findFirst').mockImplementationOnce((async (args: Parameters<typeof findFirst>[0]) => {
      const row = await findFirst(args);
      await prisma.expense.delete({ where: { id: created.data.id } });
      return row;
    }) as typeof findFirst);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await updateExpense(group.id, created.data.id, { ...input, title: 'Cena editada' })).toEqual({
      ok: false,
      error: 'El gasto ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.',
    });
    expect(await prisma.expense.count()).toBe(0);
    expect(await prisma.expenseItem.count()).toBe(0);
    vi.restoreAllMocks();
  });
});
