import { beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../../src/server/db';
import { createExpense } from '../../src/server/actions/expenses';
import { setOwnerlessExtra } from '../../src/server/actions/group';
import { getGroupOverview, getOwnerlessView } from '../../src/server/queries';
import { resetDb } from './reset';

async function seedGroup() {
  return prisma.group.create({
    data: {
      id: nanoid(24),
      name: 'Extra',
      participants: { create: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }, { name: 'Dani' }] },
    },
    include: { participants: true },
  });
}

const equalShares = (ids: string[]) => ids.map((id) => ({ participantId: id, shareInput: 1 }));

describe('ownerless extra pool (declared, remaining is derived)', () => {
  beforeEach(resetDb);

  it('a fresh group has no extra declared', async () => {
    const group = await seedGroup();
    const overview = await getGroupOverview(group.id);
    expect(overview?.ownerless).toEqual({ declaredCents: 0, appliedCents: 0, remainingCents: 0 });
  });

  it('declaring 80 sets declared + remaining; applied stays 0 until nobody pays', async () => {
    const group = await seedGroup();
    const res = await setOwnerlessExtra(group.id, { amount: '80,00' });
    expect(res.ok).toBe(true);
    const overview = await getGroupOverview(group.id);
    expect(overview?.ownerless).toEqual({ declaredCents: 8000, appliedCents: 0, remainingCents: 8000 });
  });

  it('remaining is derived: applied = sum of ownerless payers, and it decreases as nadie pays', async () => {
    const group = await seedGroup();
    const ids = group.participants.map((p) => p.id);
    await setOwnerlessExtra(group.id, { amount: '80,00' });
    await createExpense(group.id, {
      title: 'Cena', date: '2026-07-16',
      payers: [{ participantId: null, amount: '30,00' }, { participantId: ids[0], amount: '130,00' }],
      items: [{ amount: '160,00', splitMode: 'EQUAL', shares: equalShares(ids) }],
    });
    const overview = await getGroupOverview(group.id);
    expect(overview?.ownerless.appliedCents).toBe(3000);
    expect(overview?.ownerless.remainingCents).toBe(5000);
  });

  it('remaining goes negative when nadie pays more than declared (overshoot is surfaced, not clamped)', async () => {
    const group = await seedGroup();
    const ids = group.participants.map((p) => p.id);
    await setOwnerlessExtra(group.id, { amount: '80,00' });
    await createExpense(group.id, {
      title: 'Cena', date: '2026-07-16',
      payers: [{ participantId: null, amount: '90,00' }, { participantId: ids[0], amount: '70,00' }],
      items: [{ amount: '160,00', splitMode: 'EQUAL', shares: equalShares(ids) }],
    });
    const overview = await getGroupOverview(group.id);
    expect(overview?.ownerless.appliedCents).toBe(9000);
    expect(overview?.ownerless.remainingCents).toBe(-1000);
  });

  it('rejects a negative extra', async () => {
    const group = await seedGroup();
    const res = await setOwnerlessExtra(group.id, { amount: '-5,00' });
    expect(res).toEqual({ ok: false, error: 'El importe no puede ser negativo' });
  });

  it('clearing the extra (the form sends 0) resets the declared pool', async () => {
    const group = await seedGroup();
    await setOwnerlessExtra(group.id, { amount: '80,00' });
    const res = await setOwnerlessExtra(group.id, { amount: '0' });
    expect(res.ok).toBe(true);
    const overview = await getGroupOverview(group.id);
    expect(overview?.ownerless.declaredCents).toBe(0);
  });

  it('editing the extra to a new value overwrites it', async () => {
    const group = await seedGroup();
    await setOwnerlessExtra(group.id, { amount: '80,00' });
    await setOwnerlessExtra(group.id, { amount: '120,00' });
    const overview = await getGroupOverview(group.id);
    expect(overview?.ownerless.declaredCents).toBe(12000);
  });

  it('the form-page view derives the same figures as the overview, from this group only', async () => {
    const group = await seedGroup();
    const other = await seedGroup();
    const ids = group.participants.map((p) => p.id);
    const otherIds = other.participants.map((p) => p.id);
    await setOwnerlessExtra(group.id, { amount: '80,00' });
    for (const amount of ['30,00', '25,00']) {
      await createExpense(group.id, {
        title: 'Cena', date: '2026-07-16',
        payers: [{ participantId: null, amount }],
        items: [{ amount, splitMode: 'EQUAL', shares: equalShares(ids) }],
      });
    }
    await createExpense(other.id, {
      title: 'Otra', date: '2026-07-16',
      payers: [{ participantId: null, amount: '99,00' }],
      items: [{ amount: '99,00', splitMode: 'EQUAL', shares: equalShares(otherIds) }],
    });

    const fresh = await prisma.group.findUniqueOrThrow({ where: { id: group.id } });
    const view = await getOwnerlessView(fresh);
    expect(view).toEqual({ declaredCents: 8000, appliedCents: 5500, remainingCents: 2500 });
    expect(view).toEqual((await getGroupOverview(group.id))?.ownerless);
  });
});
