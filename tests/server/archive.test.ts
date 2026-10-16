import { beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../../src/server/db';
import { createExpense, updateExpense } from '../../src/server/actions/expenses';
import { createRefund } from '../../src/server/actions/refunds';
import { archiveParticipant, unarchiveParticipant } from '../../src/server/actions/participants';
import { getGroupOverview } from '../../src/server/queries';
import { resetDb } from './reset';

async function seedGroup() {
  return prisma.group.create({
    data: { id: nanoid(24), name: 'Viaje', participants: { create: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }] } },
    include: { participants: true },
  });
}

describe('archiveParticipant', () => {
  beforeEach(resetDb);

  it('sets archivedAt and logs the action; no Payment created', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;
    // Give Ana a non-zero balance so we can verify it stays
    await createExpense(group.id, {
      title: 'Cena', date: '2026-07-02',
      payers: [{ participantId: ana.id, amount: '30,00' }],
      items: [{
        amount: '30,00', splitMode: 'EQUAL',
        shares: [ana, beto, carla].map((p) => ({ participantId: p.id, shareInput: 1 })),
      }],
    });

    const result = await archiveParticipant(group.id, carla.id);
    expect(result.ok).toBe(true);

    const stored = await prisma.participant.findUniqueOrThrow({ where: { id: carla.id } });
    expect(stored.archivedAt).not.toBeNull();
    expect(await prisma.payment.count()).toBe(0); // no forced settlement

    const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'participant.archive' } });
    expect(log.payload).toMatchObject({ previous: { id: carla.id, name: 'Carla' } });
  });

  it('archived participant balance stays in settle', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;
    await createExpense(group.id, {
      title: 'Cena', date: '2026-07-02',
      payers: [{ participantId: ana.id, amount: '30,00' }],
      items: [{
        amount: '30,00', splitMode: 'EQUAL',
        shares: [ana, beto, carla].map((p) => ({ participantId: p.id, shareInput: 1 })),
      }],
    });

    await archiveParticipant(group.id, carla.id);

    const overview = await getGroupOverview(group.id);
    if (!overview) throw new Error('overview is null');
    const byId = new Map(overview.balances.map((b) => [b.participantId, b.balanceCents]));
    // Carla still owes 1000 → settle must include her
    expect(byId.get(carla.id)).toBe(-1000);
    const carlaTransfer = overview.plan.find((t) => t.fromId === carla.id);
    expect(carlaTransfer).toBeDefined();
    expect(carlaTransfer?.amountCents).toBe(1000);
  });


  it('unarchive clears archivedAt and is reversible', async () => {
    const group = await seedGroup();
    const [, , carla] = group.participants;
    await archiveParticipant(group.id, carla.id);
    expect((await prisma.participant.findUniqueOrThrow({ where: { id: carla.id } })).archivedAt).not.toBeNull();

    const result = await unarchiveParticipant(group.id, carla.id);
    expect(result.ok).toBe(true);
    const stored = await prisma.participant.findUniqueOrThrow({ where: { id: carla.id } });
    expect(stored.archivedAt).toBeNull();

    const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'participant.unarchive' } });
    expect(log.payload).toMatchObject({ previous: { id: carla.id, name: 'Carla' } });
  });

  it('§2.1: archive with wrong group token is a scope miss', async () => {
    const group = await seedGroup();
    const other = await seedGroup();
    const [ana] = group.participants;

    expect(await archiveParticipant(other.id, ana.id)).toEqual({ ok: false, error: 'El participante ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.' });
    const stored = await prisma.participant.findUniqueOrThrow({ where: { id: ana.id } });
    expect(stored.archivedAt).toBeNull();
  });
});

describe('FIX-6: archived participants rejected server-side (not just client-side)', () => {
  beforeEach(resetDb);
  const ARCHIVED_MESSAGE = 'No se puede usar un participante archivado';

  it('createExpense rejects an archived payer', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;
    await archiveParticipant(group.id, carla.id);
    const result = await createExpense(group.id, {
      title: 'Cena', date: '2026-07-02',
      payers: [{ participantId: carla.id, amount: '30,00' }],
      items: [{ amount: '30,00', splitMode: 'EQUAL', shares: [ana, beto].map((p) => ({ participantId: p.id, shareInput: 1 })) }],
    });
    expect(result).toEqual({ ok: false, error: ARCHIVED_MESSAGE });
  });

  it('createExpense rejects an archived beneficiary', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;
    await archiveParticipant(group.id, carla.id);
    const result = await createExpense(group.id, {
      title: 'Cena', date: '2026-07-02',
      payers: [{ participantId: ana.id, amount: '30,00' }],
      items: [{ amount: '30,00', splitMode: 'EQUAL', shares: [ana, beto, carla].map((p) => ({ participantId: p.id, shareInput: 1 })) }],
    });
    expect(result).toEqual({ ok: false, error: ARCHIVED_MESSAGE });
  });

  it('updateExpense rejects an archived participant added on edit', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;
    await createExpense(group.id, {
      title: 'Cena', date: '2026-07-02',
      payers: [{ participantId: ana.id, amount: '30,00' }],
      items: [{ amount: '30,00', splitMode: 'EQUAL', shares: [ana, beto].map((p) => ({ participantId: p.id, shareInput: 1 })) }],
    });
    const expense = await prisma.expense.findFirstOrThrow();
    await archiveParticipant(group.id, carla.id);
    const result = await updateExpense(group.id, expense.id, {
      title: 'Cena', date: '2026-07-02',
      payers: [{ participantId: ana.id, amount: '30,00' }],
      items: [{ amount: '30,00', splitMode: 'EQUAL', shares: [ana, beto, carla].map((p) => ({ participantId: p.id, shareInput: 1 })) }],
    });
    expect(result).toEqual({ ok: false, error: ARCHIVED_MESSAGE });
  });

  it('createRefund rejects an archived receivedById', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;
    await createExpense(group.id, {
      title: 'Cena', date: '2026-07-02',
      payers: [{ participantId: ana.id, amount: '30,00' }],
      items: [{ amount: '30,00', splitMode: 'EQUAL', shares: [ana, beto].map((p) => ({ participantId: p.id, shareInput: 1 })) }],
    });
    const expense = await prisma.expense.findFirstOrThrow();
    await archiveParticipant(group.id, carla.id);
    const result = await createRefund(group.id, { expenseId: expense.id, receivedById: carla.id, amount: '10,00' });
    expect(result).toEqual({ ok: false, error: ARCHIVED_MESSAGE });
  });
});
