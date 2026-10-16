import { beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../../src/server/db';
import { createExpense } from '../../src/server/actions/expenses';
import { createPayment } from '../../src/server/actions/payments';
import { createRefund } from '../../src/server/actions/refunds';
import { createGroupCharge } from '../../src/server/actions/group-charge';
import { archiveParticipant } from '../../src/server/actions/participants';
import { getGroupOverview, getLedgerExport } from '../../src/server/queries';
import { ledgerCsv } from '../../src/app/g/[token]/exportar/ledger-csv';
import { resetDb } from './reset';

async function seedLedger(name: string) {
  const group = await prisma.group.create({
    data: { id: nanoid(24), name, participants: { create: [{ name: 'Ana' }, { name: 'Beto' }, { name: 'Carla' }] } },
    include: { participants: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  });
  const [ana, beto, carla] = group.participants;
  const all = [ana, beto, carla].map((p) => ({ participantId: p.id, shareInput: 1 }));
  const hotel = await createExpense(group.id, {
    title: 'Hotel', date: '2026-07-01',
    payers: [{ participantId: ana.id, amount: '70,00' }, { participantId: null, amount: '20,00' }],
    items: [{ amount: '90,00', splitMode: 'EQUAL', shares: all }],
  });
  if (!hotel.ok) throw new Error(hotel.error);
  const expense = await prisma.expense.findFirstOrThrow({ where: { groupId: group.id } });
  await createRefund(group.id, { expenseId: expense.id, receivedById: ana.id, amount: '10,00' });
  await createPayment(group.id, { fromId: beto.id, toId: ana.id, amount: '15,00', date: '2026-07-02' });
  await createGroupCharge(group.id, { concept: 'Luz', date: '2026-07-03', amount: '30,00', splitMode: 'EQUAL', shares: all });
  await archiveParticipant(group.id, carla.id);
  return group;
}

/** The "Saldo" row of the CSV, as cents per person column. */
function saldoRow(csv: string, people: number): number[] {
  const saldo = csv.split('\r\n').map((l) => l.split(';')).find((cells) => cells[1] === 'Saldo');
  if (!saldo) throw new Error('no Saldo row');
  return saldo.slice(5, 5 + people).map((cell) => Math.round(Number(cell.replace(',', '.')) * 100));
}

describe('getLedgerExport + ledgerCsv (T-53)', () => {
  beforeEach(resetDb);

  it('the saldo row is exactly what Saldos shows, leftover, refund, payment and archive included', async () => {
    const group = await seedLedger('Viaje');
    const data = await getLedgerExport(group.id);
    const overview = await getGroupOverview(group.id);
    if (!data || !overview) throw new Error('group not found');
    const csv = ledgerCsv(data);
    expect(saldoRow(csv, 3)).toEqual(overview.balances.map((b) => b.balanceCents));
    expect(csv).toContain('Reparto del sobrante');
    expect(csv).toContain('Total gastos sin pagar');
  });

  it('reads only this group (§2.1) and returns null for an unknown token', async () => {
    const group = await seedLedger('Uno');
    await seedLedger('Otro');
    const data = await getLedgerExport(group.id);
    expect(data?.groupName).toBe('Uno');
    expect([data?.expenses.length, data?.payments.length, data?.refunds.length, data?.charges.length]).toEqual([1, 1, 1, 1]);
    expect(await getLedgerExport('x'.repeat(24))).toBeNull();
  });
});
