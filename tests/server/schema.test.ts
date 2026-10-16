import { beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../../src/server/db';
import { resetDb } from './reset';

describe('schema invariants', () => {
  beforeEach(resetDb);

  it('creates a group with nanoid(24) id and participants', async () => {
    const id = nanoid(24);
    expect(id).toHaveLength(24);
    const group = await prisma.group.create({
      data: { id, name: 'Viaje', participants: { create: [{ name: 'Ana' }, { name: 'Beto' }] } },
      include: { participants: true },
    });
    expect(group.currency).toBe('EUR');
    expect(group.participants).toHaveLength(2);
  });

  it('rejects duplicate participant names within a group (P2002)', async () => {
    const id = nanoid(24);
    await prisma.group.create({ data: { id, name: 'Piso', participants: { create: [{ name: 'Ana' }] } } });
    await expect(
      prisma.participant.create({ data: { groupId: id, name: 'Ana' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects the same name in other capitals within a group (P2002), the backstop of a race', async () => {
    const id = nanoid(24);
    await prisma.group.create({ data: { id, name: 'Piso', participants: { create: [{ name: 'Ana' }] } } });
    await expect(prisma.participant.create({ data: { groupId: id, name: 'ANA' } })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('restricts deleting a participant referenced by an expense (P2003)', async () => {
    const id = nanoid(24);
    const group = await prisma.group.create({
      data: { id, name: 'Cena', participants: { create: [{ name: 'Ana' }, { name: 'Beto' }] } },
      include: { participants: true },
    });
    const [ana, beto] = group.participants;
    await prisma.expense.create({
      data: {
        groupId: id, title: 'Cena', amountCents: 1000,
        date: new Date('2026-07-02T00:00:00.000Z'), splitMode: 'EQUAL',
        payers: { create: [{ participantId: ana.id, amountCents: 1000 }] },
        items: { create: [{ amountCents: 1000, splitMode: 'EQUAL', shares: { create: [{ participantId: ana.id, shareInput: 1, amountCents: 500 }, { participantId: beto.id, shareInput: 1, amountCents: 500 }] } }] },
      },
    });
    await expect(prisma.participant.delete({ where: { id: ana.id } })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('cascades group deletion to participants', async () => {
    const id = nanoid(24);
    await prisma.group.create({ data: { id, name: 'Temp', participants: { create: [{ name: 'Ana' }] } } });
    await prisma.group.delete({ where: { id } });
    expect(await prisma.participant.count()).toBe(0);
  });
});

describe('database indexes', () => {
  async function indexDefinitions(): Promise<Map<string, string>> {
    const rows = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`;
    return new Map(rows.map((r) => [r.indexname, r.indexdef]));
  }

  it('indexes every foreign key that is not already a key prefix', async () => {
    const names = await indexDefinitions();
    const expected = [
      'Expense_groupId_idx',
      'Payment_groupId_idx', 'Payment_fromId_idx', 'Payment_toId_idx',
      'Refund_groupId_idx', 'Refund_expenseId_idx', 'Refund_receivedById_idx',
      'GroupCharge_groupId_idx',
      'ActivityLog_groupId_createdAt_idx',
      'KittyRound_groupId_closedAt_idx', 'KittyRound_kittyId_idx',
      'ExpenseItem_expenseId_idx',
      'ExpensePayer_participantId_idx',
      'ExpenseShare_participantId_idx',
      'GroupChargeShare_participantId_idx',
      'KittyContribution_kittyRoundId_idx', 'KittyContribution_participantId_idx',
      'KittySpend_kittyRoundId_idx',
    ];
    expect(expected.filter((name) => !names.has(name))).toEqual([]);
  });

  // Migration-only partial index (Prisma's DSL cannot express it): any
  // generated migration that diffs against the DSL would try to drop it.
  it('keeps the case-insensitive participant name index', async () => {
    const def = (await indexDefinitions()).get('Participant_groupId_name_ci_key');
    expect(def).toMatch(/CREATE UNIQUE INDEX .* \("groupId", lower\(name\)\)/);
  });

  it('keeps the single-open-round partial unique index', async () => {
    const def = (await indexDefinitions()).get('KittyRound_one_open_per_group');
    expect(def).toMatch(/CREATE UNIQUE INDEX .* WHERE \("closedAt" IS NULL\)/);
  });
});
