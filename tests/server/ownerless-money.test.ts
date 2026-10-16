import { beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../../src/server/db';
import { createExpense } from '../../src/server/actions/expenses';
import { createGroupCharge, updateGroupCharge, deleteGroupCharge } from '../../src/server/actions/group-charge';
import { deleteParticipant } from '../../src/server/actions/participants';
import { getGroupOverview } from '../../src/server/queries';
import { resetDb } from './reset';

async function seedGroup() {
  return prisma.group.create({
    data: {
      id: nanoid(24),
      name: 'Viaje',
      participants: { create: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }, { name: 'Dani' }] },
    },
    include: { participants: true },
  });
}

const equalShares = (ids: string[]) => ids.map((id) => ({ participantId: id, shareInput: 1 }));

describe('ownerless money — Model A (unpaid group charge)', () => {
  beforeEach(resetDb);

  it('§6 Case A: casa rural 400 (no payer) surfaces as external debt, never in settle', async () => {
    const group = await seedGroup();
    const [ana, beto, carla, dani] = group.participants;
    const ids = group.participants.map((p) => p.id);

    const casa = await createGroupCharge(group.id, {
      concept: 'Casa rural', date: '2026-07-02', amount: '400,00', splitMode: 'EQUAL',
      shares: equalShares(ids),
    });
    expect(casa.ok).toBe(true);

    const comida = await createExpense(group.id, {
      title: 'Comida', date: '2026-07-02',
      payers: [{ participantId: ana.id, amount: '80,00' }],
      items: [{ amount: '80,00', splitMode: 'EQUAL', shares: equalShares(ids) }],
    });
    expect(comida.ok).toBe(true);

    const overview = await getGroupOverview(group.id);
    if (!overview) throw new Error('overview is null');

    // Internal settle sees only the comida: Beto/Carla/Dani → Ana 20.
    expect(overview.plan).toContainEqual(expect.objectContaining({ fromId: beto.id, toId: ana.id, amountCents: 2000 }));
    expect(overview.plan).toContainEqual(expect.objectContaining({ fromId: carla.id, toId: ana.id, amountCents: 2000 }));
    expect(overview.plan).toContainEqual(expect.objectContaining({ fromId: dani.id, toId: ana.id, amountCents: 2000 }));
    expect(overview.plan).toHaveLength(3);

    // External charges: each person owes 100 outside — separate section.
    const ext = new Map(overview.externalCharges.map((e) => [e.participantId, e.amountCents]));
    expect(ext.get(ana.id)).toBe(10000);
    expect(ext.get(beto.id)).toBe(10000);
    expect(ext.get(carla.id)).toBe(10000);
    expect(ext.get(dani.id)).toBe(10000);
  });

  it('a charge alone leaves all internal balances at 0 (no person-to-person debt)', async () => {
    const group = await seedGroup();
    const ids = group.participants.map((p) => p.id);
    await createGroupCharge(group.id, {
      concept: 'Casa rural', date: '2026-07-02', amount: '400,00', splitMode: 'EQUAL', shares: equalShares(ids),
    });
    const overview = await getGroupOverview(group.id);
    if (!overview) throw new Error('overview is null');
    expect(overview.balances.every((b) => b.balanceCents === 0)).toBe(true);
    expect(overview.plan).toHaveLength(0);
    expect(overview.externalCharges).toHaveLength(4);
  });

  it('each unpaid charge in the overview carries the share of every person by name (owner review, session 10)', async () => {
    const group = await seedGroup();
    const [ana, beto, carla] = group.participants;
    await createGroupCharge(group.id, {
      concept: 'Casa rural', date: '2026-07-02', amount: '200,00', splitMode: 'EQUAL',
      shares: equalShares([ana.id, beto.id, carla.id]),
    });
    const overview = await getGroupOverview(group.id);
    expect(overview!.charges).toHaveLength(1);
    expect(overview!.charges[0].shares).toEqual([
      { participantId: ana.id, name: 'Ana', amountCents: 6667 },
      { participantId: beto.id, name: 'Beto', amountCents: 6667 },
      { participantId: carla.id, name: 'Carla', amountCents: 6666 },
    ]);
  });

  it('deleteGroupCharge removes its external debt', async () => {
    const group = await seedGroup();
    const ids = group.participants.map((p) => p.id);
    const created = await createGroupCharge(group.id, {
      concept: 'Casa rural', date: '2026-07-02', amount: '400,00', splitMode: 'EQUAL', shares: equalShares(ids),
    });
    if (!created.ok) throw new Error('charge not created');
    const del = await deleteGroupCharge(group.id, created.data.id);
    expect(del.ok).toBe(true);
    const overview = await getGroupOverview(group.id);
    expect(overview?.externalCharges).toHaveLength(0);
  });

  it('T-72: a charge deleted from another device is reported as gone, not as a missing group', async () => {
    const group = await seedGroup();
    const ids = group.participants.map((p) => p.id);
    const created = await createGroupCharge(group.id, {
      concept: 'Casa rural', date: '2026-07-02', amount: '400,00', splitMode: 'EQUAL', shares: equalShares(ids),
    });
    if (!created.ok) throw new Error('charge not created');
    expect((await deleteGroupCharge(group.id, created.data.id)).ok).toBe(true);
    expect(await deleteGroupCharge(group.id, created.data.id)).toEqual({
      ok: false,
      error: 'El gasto sin pagar ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.',
    });
  });

  it('updateGroupCharge re-splits the new amount', async () => {
    const group = await seedGroup();
    const ids = group.participants.map((p) => p.id);
    const created = await createGroupCharge(group.id, {
      concept: 'Casa rural', date: '2026-07-02', amount: '400,00', splitMode: 'EQUAL', shares: equalShares(ids),
    });
    if (!created.ok) throw new Error('charge not created');
    const upd = await updateGroupCharge(group.id, created.data.id, {
      concept: 'Casa rural', date: '2026-07-02', amount: '200,00', splitMode: 'EQUAL', shares: equalShares(ids),
    });
    expect(upd.ok).toBe(true);
    const overview = await getGroupOverview(group.id);
    const ext = new Map(overview!.externalCharges.map((e) => [e.participantId, e.amountCents]));
    expect(ext.get(ids[0])).toBe(5000);
  });

  it('deleteParticipant is blocked when the participant has a charge share', async () => {
    const group = await seedGroup();
    const ids = group.participants.map((p) => p.id);
    await createGroupCharge(group.id, {
      concept: 'Casa rural', date: '2026-07-02', amount: '400,00', splitMode: 'EQUAL', shares: equalShares(ids),
    });
    const del = await deleteParticipant(group.id, ids[0]);
    expect(del.ok).toBe(false);
  });
});

describe('ownerless money — Model B (ownerless payer, "Sobrante" in the UI)', () => {
  beforeEach(resetDb);

  it('the feed names an ownerless payer "Sobrante"', async () => {
    const group = await seedGroup();
    const ids = group.participants.map((p) => p.id);
    await createExpense(group.id, {
      title: 'Regalo', date: '2026-07-16',
      payers: [{ participantId: null, amount: '40,00' }],
      items: [{ amount: '40,00', splitMode: 'EQUAL', shares: equalShares(ids) }],
    });
    const overview = await getGroupOverview(group.id);
    expect(overview?.feed.find((f) => f.title === 'Regalo')?.detail).toBe('Pagó Sobrante');
  });

  it('§6 Case B: Comida 200 = nadie 100 + Ana 100 folds onto people in settle', async () => {
    const group = await seedGroup();
    const [ana, beto, carla, dani] = group.participants;
    const ids = group.participants.map((p) => p.id);

    const comida = await createExpense(group.id, {
      title: 'Comida', date: '2026-07-02',
      payers: [
        { participantId: null, amount: '100,00' }, // ownerless
        { participantId: ana.id, amount: '100,00' },
      ],
      items: [{ amount: '200,00', splitMode: 'EQUAL', shares: equalShares(ids) }],
    });
    expect(comida.ok).toBe(true);

    const overview = await getGroupOverview(group.id);
    if (!overview) throw new Error('overview is null');

    // Settleable balances (bucket folded): Ana +75, others −25.
    const byId = new Map(overview.balances.map((b) => [b.participantId, b.balanceCents]));
    expect(byId.get(ana.id)).toBe(7500);
    expect(byId.get(beto.id)).toBe(-2500);
    expect(byId.get(carla.id)).toBe(-2500);
    expect(byId.get(dani.id)).toBe(-2500);
    expect([...byId.values()].reduce((a, b) => a + b, 0)).toBe(0);

    // Settle: Beto/Carla/Dani → Ana 25.
    expect(overview.plan).toContainEqual(expect.objectContaining({ fromId: beto.id, toId: ana.id, amountCents: 2500 }));
    expect(overview.plan).toContainEqual(expect.objectContaining({ fromId: carla.id, toId: ana.id, amountCents: 2500 }));
    expect(overview.plan).toContainEqual(expect.objectContaining({ fromId: dani.id, toId: ana.id, amountCents: 2500 }));
    expect(overview.plan).toHaveLength(3);

    // Ownerless money is not an external charge.
    expect(overview.externalCharges).toHaveLength(0);
  });

  it('an expense fully paid by nadie leaves everyone at 0 — nobody owes anybody', async () => {
    const group = await seedGroup();
    const ids = group.participants.map((p) => p.id);
    const result = await createExpense(group.id, {
      title: 'Regalo', date: '2026-07-16',
      payers: [{ participantId: null, amount: '200,00' }], // nadie pays the whole thing
      items: [{ amount: '200,00', splitMode: 'EQUAL', shares: equalShares(ids) }],
    });
    expect(result.ok).toBe(true);
    const overview = await getGroupOverview(group.id);
    if (!overview) throw new Error('overview is null');
    expect(overview.balances.every((b) => b.balanceCents === 0)).toBe(true);
    expect(overview.plan).toHaveLength(0);
  });

  it('persists an ExpensePayer with null participantId and does not break membership checks', async () => {
    const group = await seedGroup();
    const [ana] = group.participants;
    const ids = group.participants.map((p) => p.id);

    const result = await createExpense(group.id, {
      title: 'Comida', date: '2026-07-02',
      payers: [
        { participantId: null, amount: '150,00' },
        { participantId: ana.id, amount: '50,00' },
      ],
      items: [{ amount: '200,00', splitMode: 'EQUAL', shares: equalShares(ids) }],
    });
    expect(result.ok).toBe(true);

    const rows = await prisma.expensePayer.findMany();
    expect(rows.some((r) => r.participantId === null)).toBe(true);
  });
});
