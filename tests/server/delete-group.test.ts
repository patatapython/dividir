import { beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../../src/server/db';
import { deleteGroup } from '../../src/server/actions/group';
import { createExpense } from '../../src/server/actions/expenses';
import { createPayment } from '../../src/server/actions/payments';
import { createRefund } from '../../src/server/actions/refunds';
import { createGroupCharge } from '../../src/server/actions/group-charge';
import { addContributions, addSpend, closeKittyRound, openKittyRound } from '../../src/server/actions/kitty';
import { resetDb } from './reset';

/** Row count of every application table, read from the catalog like the test reset. */
async function countAllRows(): Promise<Record<string, number>> {
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`,
  );
  const counts: Record<string, number> = {};
  for (const { tablename } of tables) {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${tablename}"`);
    counts[tablename] = n;
  }
  return counts;
}

function must<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

/** A group holding at least one row of every entity a group can own. */
async function seedFullLedger(name: string): Promise<string> {
  const group = await prisma.group.create({
    data: { id: nanoid(24), name, participants: { create: [{ name: 'Ana' }, { name: 'Beto' }] } },
    include: { participants: true },
  });
  const token = group.id;
  const [ana, beto] = group.participants;
  const both = [ana, beto].map((p) => ({ participantId: p.id, shareInput: 1 }));

  const expense = must(
    await createExpense(token, {
      title: 'Cena',
      date: '2026-09-24',
      payers: [
        { participantId: ana.id, amount: '30,00' },
        { participantId: null, amount: '10,00' },
      ],
      items: [{ amount: '40,00', splitMode: 'EQUAL', shares: both }],
    }),
  );
  must(await createRefund(token, { expenseId: expense.id, receivedById: ana.id, amount: '5,00' }));
  must(await createPayment(token, { fromId: beto.id, toId: ana.id, amount: '10,00', date: '2026-09-24' }));
  must(
    await createGroupCharge(token, {
      concept: 'Casa rural',
      date: '2026-09-24',
      amount: '100,00',
      splitMode: 'EQUAL',
      shares: both,
    }),
  );

  const closed = must(await openKittyRound(token, { name: 'Viernes' }));
  must(await addContributions(token, closed.id, { contributions: [{ participantId: ana.id, amount: '20,00' }] }));
  must(await addSpend(token, closed.id, { concept: 'Hielo', amount: '5,00' }));
  must(await closeKittyRound(token, closed.id, { action: 'REPARTIR' }));
  const open = must(await openKittyRound(token, { name: 'Sábado', preexisting: '3,00' }));
  must(await addContributions(token, open.id, { contributions: [{ participantId: beto.id, amount: '10,00' }] }));

  return token;
}

describe('deleteGroup with a full ledger', () => {
  beforeEach(resetDb);

  it('removes every row the group owns and leaves another group untouched', async () => {
    await seedFullLedger('Superviviente');
    const survivorOnly = await countAllRows();
    // Guard the fixture itself: a table the seed leaves empty is a table this test
    // cannot prove deleteGroup clears (e.g. one added after this test was written).
    expect(Object.entries(survivorOnly).filter(([, n]) => n === 0)).toEqual([]);

    const doomed = await seedFullLedger('Condenado');
    expect(await deleteGroup(doomed, 'Condenado')).toEqual({ ok: true, data: undefined });

    expect(await countAllRows()).toEqual(survivorOnly);
  });
});
