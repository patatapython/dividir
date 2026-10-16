import { beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../../src/server/db';
import { setOwnerlessExtra } from '../../src/server/actions/group';
import { createExpense } from '../../src/server/actions/expenses';
import { createPayment } from '../../src/server/actions/payments';
import { createGroupCharge } from '../../src/server/actions/group-charge';
import { addContributions, openKittyRound } from '../../src/server/actions/kitty';
import { resetDb } from './reset';

const TOO_LARGE = 'Importe demasiado grande (máximo 1.000.000 €)';

async function seedGroup() {
  return prisma.group.create({
    data: { id: nanoid(24), name: 'Viaje', participants: { create: [{ name: 'Ana' }, { name: 'Beto' }] } },
    include: { participants: true },
  });
}

/**
 * Every amount column is a 32-bit integer (21.474.836,47 €). An amount above the
 * app's ceiling used to reach the database and come back as an unhandled Prisma
 * error — a full-screen error page instead of a message (session 11 simulation, F-01).
 */
describe('amounts above the ceiling are refused, never a crash', () => {
  beforeEach(resetDb);

  it('in every action that takes a typed amount', async () => {
    const group = await seedGroup();
    const [ana, beto] = group.participants;
    const huge = '30000000';
    const results = await Promise.all([
      createPayment(group.id, { fromId: ana.id, toId: beto.id, amount: huge, date: '2026-09-01' }),
      createGroupCharge(group.id, { concept: 'Casa', date: '2026-09-01', amount: huge, splitMode: 'EQUAL', shares: [{ participantId: ana.id, shareInput: 1 }] }),
      setOwnerlessExtra(group.id, { amount: huge }),
      openKittyRound(group.id, { preexisting: huge }),
      createExpense(group.id, {
        title: 'Casa', date: '2026-09-01', payers: [{ participantId: ana.id, amount: huge }],
        items: [{ amount: huge, splitMode: 'EQUAL', shares: [{ participantId: ana.id, shareInput: 1 }] }],
      }),
    ]);
    for (const result of results) expect(result).toEqual({ ok: false, error: TOO_LARGE });

    const round = await openKittyRound(group.id, {});
    if (!round.ok) throw new Error(round.error);
    expect(await addContributions(group.id, round.data.id, { contributions: [{ participantId: ana.id, amount: huge }] }))
      .toEqual({ ok: false, error: TOO_LARGE });
  });

  it('in a split weight too large to store', async () => {
    const group = await seedGroup();
    const [ana, beto] = group.participants;
    const result = await createExpense(group.id, {
      title: 'Cena', date: '2026-09-01', payers: [{ participantId: ana.id, amount: '10,00' }],
      items: [{ amount: '10,00', splitMode: 'SHARES', shares: [{ participantId: ana.id, shareInput: 3_000_000_000 }, { participantId: beto.id, shareInput: 1 }] }],
    });
    expect(result).toEqual({ ok: false, error: 'Valor demasiado grande' });
  });

  it('in a date that is not in the calendar', async () => {
    const group = await seedGroup();
    const [ana, beto] = group.participants;
    for (const date of ['2026-02-30', '2026-13-01']) {
      expect(await createPayment(group.id, { fromId: ana.id, toId: beto.id, amount: '1,00', date })).toEqual({ ok: false, error: 'Fecha no válida' });
    }
    expect(await prisma.payment.count()).toBe(0);
  });
});
