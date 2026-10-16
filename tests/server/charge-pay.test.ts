import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../../src/server/db';
import { createExpense } from '../../src/server/actions/expenses';
import { createGroupCharge, payGroupCharge } from '../../src/server/actions/group-charge';
import { archiveParticipant } from '../../src/server/actions/participants';
import { getActivity, getGroupOverview } from '../../src/server/queries';
import { resetDb } from './reset';

// Owner review (session 10): when somebody pays an unpaid charge in full from
// their own pocket, it stops being a debt outside the group and becomes an
// ordinary expense paid by that person, with the very same split.

async function seedGroup(name = 'Viaje') {
  return prisma.group.create({
    data: { id: nanoid(24), name, participants: { create: [{ name: 'ana' }, { name: 'juan' }, { name: 'pollo' }] } },
    include: { participants: true },
  });
}

async function seedCharge(groupId: string, input: { amount: string; splitMode: string; shares: { participantId: string; shareInput: number }[] }) {
  const created = await createGroupCharge(groupId, { concept: 'casa rural', date: '2026-09-24', ...input });
  if (!created.ok) throw new Error(created.error);
  return created.data.id;
}

describe('payGroupCharge', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('turns the charge into an expense paid by that person, which enters the settlement', async () => {
    const group = await seedGroup();
    const [ana, juan, pollo] = group.participants;
    const everyone = [ana, juan, pollo].map((p) => ({ participantId: p.id, shareInput: 1 }));
    const comida = await createExpense(group.id, {
      title: 'comida', date: '2026-09-24',
      payers: [{ participantId: pollo.id, amount: '52,00' }],
      items: [{ amount: '52,00', splitMode: 'EQUAL', shares: everyone }],
    });
    expect(comida.ok).toBe(true);
    const chargeId = await seedCharge(group.id, { amount: '200,00', splitMode: 'EQUAL', shares: everyone });

    const paid = await payGroupCharge(group.id, chargeId, { payerId: pollo.id });
    if (!paid.ok) throw new Error(paid.error);

    expect(await prisma.groupCharge.count()).toBe(0);
    const expense = await prisma.expense.findUniqueOrThrow({
      where: { id: paid.data.expenseId },
      include: { payers: true, items: { include: { shares: true } } },
    });
    expect(expense).toMatchObject({ groupId: group.id, title: 'casa rural', amountCents: 20000, splitMode: 'EQUAL' });
    expect(expense.date.toISOString().slice(0, 10)).toBe('2026-09-24');
    expect(expense.payers.map((p) => [p.participantId, p.amountCents])).toEqual([[pollo.id, 20000]]);

    const overview = await getGroupOverview(group.id);
    expect(overview!.externalCharges).toEqual([]);
    expect(overview!.charges).toEqual([]);
    // comida 52 + casa 200, both paid by pollo: each balance is what they paid
    // minus their stored shares of the two expenses.
    const owed = await prisma.expenseShare.groupBy({ by: ['participantId'], _sum: { amountCents: true } });
    const shareOf = new Map(owed.map((o) => [o.participantId, o._sum.amountCents ?? 0]));
    const paidBy = new Map([[pollo.id, 25200]]);
    for (const b of overview!.balances) {
      expect(b.balanceCents).toBe((paidBy.get(b.participantId) ?? 0) - (shareOf.get(b.participantId) ?? 0));
    }
    expect(overview!.balances.find((b) => b.participantId === ana.id)!.balanceCents).toBeLessThan(-8000);
  });

  it('copies the split exactly — mode, inputs and cents — never recomputing it', async () => {
    const group = await seedGroup();
    const [ana, juan, pollo] = group.participants;
    const chargeId = await seedCharge(group.id, {
      amount: '100,00', splitMode: 'PERCENTAGE',
      shares: [{ participantId: ana.id, shareInput: 5000 }, { participantId: juan.id, shareInput: 3000 }, { participantId: pollo.id, shareInput: 2000 }],
    });
    const before = await prisma.groupChargeShare.findMany({ where: { chargeId }, orderBy: { participantId: 'asc' } });

    const paid = await payGroupCharge(group.id, chargeId, { payerId: ana.id });
    if (!paid.ok) throw new Error(paid.error);

    const items = await prisma.expenseItem.findMany({ where: { expenseId: paid.data.expenseId }, include: { shares: { orderBy: { participantId: 'asc' } } } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ amountCents: 10000, splitMode: 'PERCENTAGE', label: null });
    expect(items[0].shares.map((s) => [s.participantId, s.shareInput, s.amountCents])).toEqual(
      before.map((s) => [s.participantId, s.shareInput, s.amountCents]),
    );
  });

  it('keeps an archived person among those who owe it (already referenced), but refuses an archived payer', async () => {
    const group = await seedGroup();
    const [ana, juan, pollo] = group.participants;
    const chargeId = await seedCharge(group.id, {
      amount: '30,00', splitMode: 'EQUAL', shares: [ana, juan, pollo].map((p) => ({ participantId: p.id, shareInput: 1 })),
    });
    expect((await archiveParticipant(group.id, juan.id)).ok).toBe(true);

    const refused = await payGroupCharge(group.id, chargeId, { payerId: juan.id });
    expect(refused.ok).toBe(false);
    expect(await prisma.groupCharge.count()).toBe(1);

    const paid = await payGroupCharge(group.id, chargeId, { payerId: ana.id });
    expect(paid.ok).toBe(true);
    expect(await prisma.expenseShare.count({ where: { participantId: juan.id } })).toBe(1);
  });

  it('never reaches across groups: another group\'s charge is gone, another group\'s person cannot pay', async () => {
    const mine = await seedGroup('Mío');
    const theirs = await seedGroup('Suyo');
    const theirCharge = await seedCharge(theirs.id, {
      amount: '10,00', splitMode: 'EQUAL', shares: theirs.participants.map((p) => ({ participantId: p.id, shareInput: 1 })),
    });
    const myCharge = await seedCharge(mine.id, {
      amount: '10,00', splitMode: 'EQUAL', shares: mine.participants.map((p) => ({ participantId: p.id, shareInput: 1 })),
    });

    const acrossCharge = await payGroupCharge(mine.id, theirCharge, { payerId: mine.participants[0].id });
    expect(acrossCharge).toEqual({ ok: false, error: expect.stringMatching(/^El gasto sin pagar ya no existe/) });

    const acrossPayer = await payGroupCharge(mine.id, myCharge, { payerId: theirs.participants[0].id });
    expect(acrossPayer.ok).toBe(false);

    expect(await prisma.groupCharge.count()).toBe(2);
    expect(await prisma.expense.count()).toBe(0);
  });

  it('two devices paying the same charge at once make ONE expense; the other is told it is gone', async () => {
    const group = await seedGroup();
    const [ana, juan, pollo] = group.participants;
    const chargeId = await seedCharge(group.id, {
      amount: '90,00', splitMode: 'EQUAL', shares: [ana, juan, pollo].map((p) => ({ participantId: p.id, shareInput: 1 })),
    });
    const results = await Promise.all([
      payGroupCharge(group.id, chargeId, { payerId: ana.id }),
      payGroupCharge(group.id, chargeId, { payerId: juan.id }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, error: expect.stringMatching(/^El gasto sin pagar ya no existe/) });
    expect(await prisma.expense.count()).toBe(1);
    expect(await prisma.groupCharge.count()).toBe(0);
  });

  it('refuses a payer archived from another device after the group was read', async () => {
    const group = await seedGroup();
    const [ana, juan, pollo] = group.participants;
    const chargeId = await seedCharge(group.id, {
      amount: '30,00', splitMode: 'EQUAL', shares: [ana, juan, pollo].map((p) => ({ participantId: p.id, shareInput: 1 })),
    });
    // The group is read while juan is still active, then juan is archived.
    const findUnique = prisma.group.findUnique.bind(prisma.group);
    vi.spyOn(prisma.group, 'findUnique').mockImplementationOnce((async (args: Parameters<typeof findUnique>[0]) => {
      const row = await findUnique(args);
      await prisma.participant.update({ where: { id: juan.id }, data: { archivedAt: new Date() } });
      return row;
    }) as unknown as typeof findUnique);

    const result = await payGroupCharge(group.id, chargeId, { payerId: juan.id });

    expect(result.ok).toBe(false);
    expect(await prisma.expense.count()).toBe(0);
    expect(await prisma.groupCharge.count()).toBe(1);
  });

  it('is recorded once in the activity, naming who paid and leading to the new expense', async () => {
    const group = await seedGroup();
    const [ana, juan, pollo] = group.participants;
    const chargeId = await seedCharge(group.id, {
      amount: '200,00', splitMode: 'EQUAL', shares: [ana, juan, pollo].map((p) => ({ participantId: p.id, shareInput: 1 })),
    });
    const paid = await payGroupCharge(group.id, chargeId, { payerId: ana.id });
    if (!paid.ok) throw new Error(paid.error);

    const activity = await getActivity(group.id, 10);
    const entry = activity!.entries[0];
    expect(entry).toMatchObject({
      action: 'charge.pay',
      label: 'marcó como pagado un gasto sin pagar',
      subject: 'casa rural',
      detail: 'pagó ana',
      amountCents: 20000,
      target: { kind: 'expense', id: paid.data.expenseId },
    });
  });
});
