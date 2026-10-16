import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../../src/server/db';
import {
  addParticipant, archiveParticipant, claimParticipant, deleteParticipant, unarchiveParticipant,
  updateParticipant,
} from '../../src/server/actions/participants';
import { createExpense } from '../../src/server/actions/expenses';
import { createRefund } from '../../src/server/actions/refunds';
import { openKittyRound, addContributions } from '../../src/server/actions/kitty';
import { resetDb } from './reset';
import { cookieJar } from './next-mocks';

async function seedGroup(name = 'Grupo') {
  return prisma.group.create({
    data: { id: nanoid(24), name, participants: { create: [{ name: 'Ana' }, { name: 'Beto' }] } },
    include: { participants: true },
  });
}

describe('participant actions', () => {
  beforeEach(async () => {
    await resetDb();
    cookieJar.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('adds a participant and logs activity', async () => {
    const group = await seedGroup();
    const result = await addParticipant(group.id, 'Carla');
    expect(result.ok).toBe(true);
    const log = await prisma.activityLog.findFirst({ where: { groupId: group.id, action: 'participant.create' } });
    expect(log?.payload).toMatchObject({ name: 'Carla' });
  });

  it('rejects duplicate names with a Spanish message, not a DB error', async () => {
    const group = await seedGroup();
    const result = await addParticipant(group.id, 'Ana');
    expect(result).toEqual({ ok: false, error: 'Ya existe un participante con ese nombre' });
  });

  it('refuses the same person again with other capitals, spacing or invisible characters', async () => {
    const group = await seedGroup();
    for (const twin of ['ana', ' ANA ', '\u2060Ana', 'An\u00ADa']) {
      expect(await addParticipant(group.id, twin), twin).toEqual({ ok: false, error: 'Ya existe un participante con ese nombre' });
    }
    expect(await updateParticipant(group.id, group.participants[1].id, 'aNa')).toEqual({ ok: false, error: 'Ya existe un participante con ese nombre' });
    expect(await prisma.participant.count({ where: { groupId: group.id } })).toBe(2);
    // Changing the capitals of one's own name is not a clash with oneself.
    expect(await updateParticipant(group.id, group.participants[0].id, 'ANA')).toEqual({ ok: true, data: undefined });
  });

  it('stores a name pasted from a chat without its invisible characters', async () => {
    const group = await seedGroup();
    const result = await addParticipant(group.id, '\u2060Vanesa\u2060 Po');
    if (!result.ok) throw new Error(result.error);
    expect((await prisma.participant.findUniqueOrThrow({ where: { id: result.data.id } })).name).toBe('Vanesa Po');
  });

  it('two phones adding the same person with other capitals at once: one wins, never a crash', async () => {
    const group = await seedGroup();
    const results = await Promise.all([addParticipant(group.id, 'Carla'), addParticipant(group.id, 'carla')]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, error: 'Ya existe un participante con ese nombre' });
  });

  it('renames and logs the previous state snapshot', async () => {
    const group = await seedGroup();
    const ana = group.participants[0];
    const result = await updateParticipant(group.id, ana.id, 'Ana María');
    expect(result.ok).toBe(true);
    const log = await prisma.activityLog.findFirst({ where: { action: 'participant.update' } });
    expect(log?.payload).toMatchObject({ previous: { name: 'Ana' }, name: 'Ana María' });
  });

  it('deletes an unreferenced participant, refuses a referenced one', async () => {
    const group = await seedGroup();
    const [ana, beto] = group.participants;
    await prisma.expense.create({
      data: {
        groupId: group.id, title: 'Taxi', amountCents: 900,
        date: new Date('2026-07-02T00:00:00.000Z'), splitMode: 'EQUAL',
        payers: { create: [{ participantId: ana.id, amountCents: 900 }] },
        items: { create: [{ amountCents: 900, splitMode: 'EQUAL', shares: { create: [{ participantId: ana.id, shareInput: 1, amountCents: 900 }] } }] },
      },
    });
    expect(await deleteParticipant(group.id, ana.id)).toMatchObject({
      ok: false, error: 'No se puede eliminar: tiene gastos (pagados o sin pagar), pagos o aportes al bote asociados',
    });
    expect((await deleteParticipant(group.id, beto.id)).ok).toBe(true);
  });

  it('FIX-8: refuses deleting a participant referenced only as a refund receiver', async () => {
    const group = await seedGroup();
    const [ana, beto] = group.participants;
    // Beto has NO expense/payment reference of his own — only ana is
    // payer/beneficiary — isolating the refund.receivedById guard.
    await createExpense(group.id, {
      title: 'Cena', date: '2026-07-02',
      payers: [{ participantId: ana.id, amount: '30,00' }],
      items: [{ amount: '30,00', splitMode: 'EQUAL', shares: [{ participantId: ana.id, shareInput: 1 }] }],
    });
    const expense = await prisma.expense.findFirstOrThrow();
    // Beto (not a payer/beneficiary of the expense) is set as the refund's receiver
    const refund = await createRefund(group.id, { expenseId: expense.id, receivedById: beto.id, amount: '10,00' });
    expect(refund.ok).toBe(true);

    expect(await deleteParticipant(group.id, beto.id)).toMatchObject({
      ok: false, error: 'No se puede eliminar: tiene gastos (pagados o sin pagar), pagos o aportes al bote asociados',
    });
  });

  it('JD-1: refuses (not throws) deleting a participant referenced only as a bote contribution', async () => {
    const group = await seedGroup();
    const [ana] = group.participants;
    const open = await openKittyRound(group.id, {});
    if (!open.ok) throw new Error('open failed');
    const contribution = await addContributions(group.id, open.data.id, { contributions: [{ participantId: ana.id, amount: '10,00' }] });
    expect(contribution.ok).toBe(true);

    expect(await deleteParticipant(group.id, ana.id)).toMatchObject({ ok: false });
  });

  it('§2.1: a valid participant id under the WRONG group token is a scope miss', async () => {
    const groupA = await seedGroup('A');
    const groupB = await seedGroup('B');
    const result = await updateParticipant(groupB.id, groupA.participants[0].id, 'Hack');
    expect(result).toEqual({ ok: false, error: 'El participante ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.' });
  });

  it('claim sets the device cookie and marks claimedAt once', async () => {
    const group = await seedGroup();
    const ana = group.participants[0];
    const result = await claimParticipant(group.id, ana.id);
    expect(result).toEqual({ ok: true, data: { name: 'Ana' } });
    expect(cookieJar.get(`participant_${group.id}`)).toBe(ana.id);
    const stored = await prisma.participant.findUnique({ where: { id: ana.id } });
    expect(stored?.claimedAt).not.toBeNull();
    const firstClaim = stored?.claimedAt;
    await claimParticipant(group.id, ana.id); // second device claims the same name
    const again = await prisma.participant.findUnique({ where: { id: ana.id } });
    expect(again?.claimedAt).toEqual(firstClaim);
  });

  // A concurrent expense can reference the participant between the delete
  // guard and the delete. Whatever the interleaving, neither action may throw
  // and exactly one wins.
  it('deleteParticipant racing an expense that references the participant never throws', async () => {
    for (let i = 0; i < 10; i++) {
      const group = await seedGroup(`Carrera ${i}`);
      const [ana, beto] = group.participants;
      const [deleted, created] = await Promise.allSettled([
        deleteParticipant(group.id, beto.id),
        createExpense(group.id, {
          title: 'Cena', date: '2026-07-01',
          payers: [{ participantId: ana.id, amount: '20,00' }],
          items: [{
            amount: '20,00', splitMode: 'EQUAL',
            shares: [ana, beto].map((p) => ({ participantId: p.id, shareInput: 1 })),
          }],
        }),
      ]);
      expect(deleted.status).toBe('fulfilled');
      expect(created.status).toBe('fulfilled');
      const outcomes = [deleted, created].map((r) => (r.status === 'fulfilled' ? r.value.ok : null));
      expect(outcomes.filter(Boolean)).toHaveLength(1);
      const betoExists = (await prisma.participant.count({ where: { id: beto.id } })) === 1;
      expect(betoExists).toBe(outcomes[1]);
    }
  });

  // A concurrent delete can remove the participant after the scoped read and
  // before the write (update throws P2025). Forced deterministically: the
  // scoped read returns the row, then it is deleted before the action writes.
  it.each([
    ['rename', (token: string, id: string) => updateParticipant(token, id, 'Bea')],
    ['archive', archiveParticipant],
    ['unarchive', unarchiveParticipant],
  ])('%s racing a delete of the same participant fails gracefully', async (_, act) => {
    const group = await seedGroup();
    const beto = group.participants[1];
    const findFirst = prisma.participant.findFirst.bind(prisma.participant);
    vi.spyOn(prisma.participant, 'findFirst').mockImplementationOnce((async (args: Parameters<typeof findFirst>[0]) => {
      const row = await findFirst(args);
      await prisma.participant.delete({ where: { id: beto.id } });
      return row;
    }) as typeof findFirst);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await act(group.id, beto.id);

    // The vanished row is named: the person knows what went and what to do.
    expect(result).toEqual({ ok: false, error: 'El participante ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.' });
    expect(await prisma.activityLog.count({ where: { groupId: group.id } })).toBe(0);
  });
});
