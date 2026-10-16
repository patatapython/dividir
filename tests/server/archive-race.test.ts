import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../../src/server/db';
import { createExpense, updateExpense } from '../../src/server/actions/expenses';
import { createGroupCharge, updateGroupCharge } from '../../src/server/actions/group-charge';
import { createRefund } from '../../src/server/actions/refunds';
import { addContributions, editContribution, openKittyRound } from '../../src/server/actions/kitty';
import { resetDb } from './reset';

// Every action that newly references a person checks that the person is active.
// The check must hold at the moment of the write, not at the moment the group was
// read: here the group is read while Carla is active and she is archived from
// "another device" right after, before the action writes. Each action must refuse.
// (Session 10 backlog; payGroupCharge has the same guard in charge-pay.test.ts.)

async function seed() {
  const group = await prisma.group.create({
    data: { id: nanoid(24), name: 'Carrera', participants: { create: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }] } },
    include: { participants: true },
  });
  const [ana, beto, carla] = group.participants;
  return { token: group.id, ana, beto, carla };
}

/** The next group read sees Carla active; she is archived right after it. */
function archiveAfterNextGroupRead(carlaId: string) {
  const findUnique = prisma.group.findUnique.bind(prisma.group);
  vi.spyOn(prisma.group, 'findUnique').mockImplementationOnce((async (args: Parameters<typeof findUnique>[0]) => {
    const row = await findUnique(args);
    await prisma.participant.update({ where: { id: carlaId }, data: { archivedAt: new Date() } });
    return row;
  }) as unknown as typeof findUnique);
}

const expenseInput = (payerId: string, ids: string[]) => ({
  title: 'Cena', date: '2026-09-25',
  payers: [{ participantId: payerId, amount: '30,00' }],
  items: [{ amount: '30,00', splitMode: 'EQUAL', shares: ids.map((participantId) => ({ participantId, shareInput: 1 })) }],
});
const chargeInput = (ids: string[]) => ({
  concept: 'Casa', date: '2026-09-25', amount: '30,00', splitMode: 'EQUAL',
  shares: ids.map((participantId) => ({ participantId, shareInput: 1 })),
});

describe('a person archived between the group read and the write is refused', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('createExpense', async () => {
    const { token, ana, beto, carla } = await seed();
    archiveAfterNextGroupRead(carla.id);
    expect((await createExpense(token, expenseInput(ana.id, [ana.id, beto.id, carla.id]))).ok).toBe(false);
    expect(await prisma.expense.count()).toBe(0);
  });

  it('updateExpense (newly referenced)', async () => {
    const { token, ana, beto, carla } = await seed();
    const created = await createExpense(token, expenseInput(ana.id, [ana.id, beto.id]));
    if (!created.ok) throw new Error(created.error);
    archiveAfterNextGroupRead(carla.id);
    expect((await updateExpense(token, created.data.id, expenseInput(ana.id, [ana.id, beto.id, carla.id]))).ok).toBe(false);
    expect(await prisma.expenseShare.count({ where: { participantId: carla.id } })).toBe(0);
  });

  it('createGroupCharge', async () => {
    const { token, ana, carla } = await seed();
    archiveAfterNextGroupRead(carla.id);
    expect((await createGroupCharge(token, chargeInput([ana.id, carla.id]))).ok).toBe(false);
    expect(await prisma.groupCharge.count()).toBe(0);
  });

  it('updateGroupCharge (newly referenced)', async () => {
    const { token, ana, beto, carla } = await seed();
    const created = await createGroupCharge(token, chargeInput([ana.id, beto.id]));
    if (!created.ok) throw new Error(created.error);
    archiveAfterNextGroupRead(carla.id);
    expect((await updateGroupCharge(token, created.data.id, chargeInput([ana.id, beto.id, carla.id]))).ok).toBe(false);
    expect(await prisma.groupChargeShare.count({ where: { participantId: carla.id } })).toBe(0);
  });

  it('createRefund (receiver)', async () => {
    const { token, ana, beto, carla } = await seed();
    const expense = await createExpense(token, expenseInput(ana.id, [ana.id, beto.id, carla.id]));
    if (!expense.ok) throw new Error(expense.error);
    archiveAfterNextGroupRead(carla.id);
    expect((await createRefund(token, { expenseId: expense.data.id, receivedById: carla.id, amount: '3,00' })).ok).toBe(false);
    expect(await prisma.refund.count()).toBe(0);
  });

  it('addContributions', async () => {
    const { token, carla } = await seed();
    const round = await openKittyRound(token, { name: 'Bares' });
    if (!round.ok) throw new Error(round.error);
    archiveAfterNextGroupRead(carla.id);
    expect((await addContributions(token, round.data.id, { contributions: [{ participantId: carla.id, amount: '10,00' }] })).ok).toBe(false);
    expect(await prisma.kittyContribution.count()).toBe(0);
  });

  it('editContribution (moved to another person)', async () => {
    const { token, ana, carla } = await seed();
    const round = await openKittyRound(token, { name: 'Bares' });
    if (!round.ok) throw new Error(round.error);
    const added = await addContributions(token, round.data.id, { contributions: [{ participantId: ana.id, amount: '10,00' }] });
    if (!added.ok) throw new Error(added.error);
    const contribution = await prisma.kittyContribution.findFirstOrThrow();
    archiveAfterNextGroupRead(carla.id);
    expect((await editContribution(token, contribution.id, { participantId: carla.id, amount: '10,00' })).ok).toBe(false);
    expect((await prisma.kittyContribution.findUniqueOrThrow({ where: { id: contribution.id } })).participantId).toBe(ana.id);
  });
});
