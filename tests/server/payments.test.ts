import { beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { prisma } from '../../src/server/db';
import { createPayment, deletePayment } from '../../src/server/actions/payments';
import { resetDb } from './reset';

async function seedGroup() {
  return prisma.group.create({
    data: { id: nanoid(24), name: 'Viaje', participants: { create: [{ name: 'Ana' }, { name: 'Beto' }] } },
    include: { participants: true },
  });
}

describe('createPayment', () => {
  beforeEach(resetDb);

  it('creates a payment and logs activity', async () => {
    const group = await seedGroup();
    const [ana, beto] = group.participants;
    const result = await createPayment(group.id, { fromId: beto.id, toId: ana.id, amount: '15,00', date: '2026-07-02' });
    expect(result.ok).toBe(true);
    const payment = await prisma.payment.findFirstOrThrow();
    expect(payment.amountCents).toBe(1500);
    expect(await prisma.activityLog.count({ where: { action: 'payment.create' } })).toBe(1);
  });

  it('rejects self-payments and non-positive amounts', async () => {
    const group = await seedGroup();
    const [ana, beto] = group.participants;
    const self = await createPayment(group.id, { fromId: ana.id, toId: ana.id, amount: '5,00', date: '2026-07-02' });
    expect(self).toMatchObject({ ok: false, error: 'El pagador y el receptor no pueden ser la misma persona' });
    const zero = await createPayment(group.id, { fromId: ana.id, toId: beto.id, amount: '0', date: '2026-07-02' });
    expect(zero).toMatchObject({ ok: false, error: 'Importe no válido (ejemplo: 12,50)' });
  });

  it('duplicate guard: identical payment within 30s needs confirmDuplicate', async () => {
    const group = await seedGroup();
    const [ana, beto] = group.participants;
    const input = { fromId: beto.id, toId: ana.id, amount: '15,00', date: '2026-07-02' };
    expect((await createPayment(group.id, input)).ok).toBe(true);
    const dup = await createPayment(group.id, input);
    expect(dup).toMatchObject({ ok: false, code: 'DUPLICATE_PAYMENT' });
    expect(await prisma.payment.count()).toBe(1);
    const confirmed = await createPayment(group.id, { ...input, confirmDuplicate: true });
    expect(confirmed.ok).toBe(true);
    expect(await prisma.payment.count()).toBe(2);
    // A different amount is NOT a duplicate:
    const different = await createPayment(group.id, { ...input, amount: '15,01' });
    expect(different.ok).toBe(true);
  });

  it('§2.1: participants from another group are a scope miss', async () => {
    const group = await seedGroup();
    const other = await seedGroup();
    const result = await createPayment(group.id, {
      fromId: other.participants[0].id, toId: group.participants[0].id, amount: '5,00', date: '2026-07-02',
    });
    expect(result).toEqual({ ok: false, error: 'El participante ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.' });
  });
});

describe('deletePayment', () => {
  beforeEach(resetDb);

  it('deletes with snapshot log; wrong group token is a scope miss', async () => {
    const group = await seedGroup();
    const other = await seedGroup();
    const [ana, beto] = group.participants;
    await createPayment(group.id, { fromId: beto.id, toId: ana.id, amount: '15,00', date: '2026-07-02' });
    const payment = await prisma.payment.findFirstOrThrow();
    expect(await deletePayment(other.id, payment.id)).toEqual({ ok: false, error: 'El pago ya no existe: puede que se haya borrado desde otro dispositivo. Recarga la página.' });
    expect((await deletePayment(group.id, payment.id)).ok).toBe(true);
    expect(await prisma.payment.count()).toBe(0);
    const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'payment.delete' } });
    expect(log.payload).toMatchObject({ previous: { amountCents: 1500, date: '2026-07-02' } });
  });
});
