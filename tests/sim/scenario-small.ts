import { expect } from 'vitest';
import { createExpense } from '../../src/server/actions/expenses';
import { createPayment } from '../../src/server/actions/payments';
import { createRefund } from '../../src/server/actions/refunds';
import { prisma } from '../../src/server/db';
import type { Driver } from './driver';
import { typed } from './driver';
import type { Rng } from './rng';
import { buildExpense, isoDay, totalOf, type ExpenseIn } from './generate';
import { checkActivity, checkKitty, checkLedger } from './invariants';
import { newGroup } from './scenario-big-group';

/** A 12-person trip on the exact settlement path (≤ 16 balances), paid off to the last cent (Pg5). */
export async function seedTrip(driver: Driver, rng: Rng, names: string[]): Promise<string> {
  const token = await newGroup(driver, 'Viaje a Oporto', names);
  const people = (await prisma.participant.findMany({ where: { groupId: token } })).map((p) => p.id);
  const start = new Date('2026-08-01T00:00:00Z');
  const ids: string[] = [];
  for (let step = 0; step < 150; step++) {
    driver.as(token, rng.pick(people));
    const input = buildExpense(rng, { date: isoDay(start, Math.floor(step / 15)), active: people, itemized: rng.chance(0.1), payerCount: rng.chance(0.1) ? 2 : 1 });
    ids.push((await driver.ok(token, 'trip expense', createExpense(token, input))).id);
    if (step % 15 === 0) {
      const expense = rng.pick(ids);
      await driver.ok(token, 'trip refund', createRefund(token, { expenseId: expense, receivedById: rng.pick(people), amount: '1,00' }));
    }
  }
  const before = await checkLedger(driver, token);
  expect(before.plan.length, 'the trip needs a settlement').toBeGreaterThan(0);

  // Pg5 — everybody pays what the plan says: every balance ends at exactly 0.
  for (const t of before.plan) {
    await driver.ok(token, 'Pg5 pay the plan', createPayment(token, { fromId: t.fromId, toId: t.toId, amount: typed(t.amountCents), date: '2026-08-12' }));
  }
  const after = await checkLedger(driver, token);
  expect(after.balances.every((b) => b.balanceCents === 0), 'Pg5 all square after paying the plan').toBe(true);
  expect(after.plan, 'Pg5 nothing left to pay').toEqual([]);
  driver.cover('Pg5');
  await checkActivity(driver, token);
  return token;
}

/** Three friends and the cents that don't divide (G11): every split still adds up. */
export async function seedThree(driver: Driver, names: string[]): Promise<string> {
  const token = await newGroup(driver, 'Cena de tres', names);
  const [a, b, c] = (await prisma.participant.findMany({ where: { groupId: token }, orderBy: { createdAt: 'asc' } })).map((p) => p.id);
  const one = (title: string, amount: string, splitMode: ExpenseIn['items'][number]['splitMode'], inputs: number[]): ExpenseIn => ({
    title, date: '2026-09-01', payers: [{ participantId: a, amount }],
    items: [{ amount, splitMode, shares: [a, b, c].map((participantId, i) => ({ participantId, shareInput: inputs[i] })) }],
  });
  const cases: [ExpenseIn, number[]][] = [
    [one('Un céntimo entre tres', '0,01', 'EQUAL', [1, 1, 1]), [1, 0, 0]],
    [one('Diez euros entre tres', '10,00', 'EQUAL', [1, 1, 1]), [334, 333, 333]],
    [one('Un euro al 33,33 %', '1,00', 'PERCENTAGE', [3333, 3333, 3334]), [33, 33, 34]],
    [one('Dos céntimos a partes iguales', '0,02', 'SHARES', [1, 1, 1]), [1, 1, 0]],
    [one('Ajuste que deja a alguien a cero', '3,00', 'ADJUSTMENT', [-100, 50, 50]), [0, 150, 150]],
  ];
  for (const [input, expected] of cases) {
    const { id } = await driver.ok(token, `G11 ${input.title}`, createExpense(token, input));
    const shares = await prisma.expenseShare.findMany({ where: { item: { expenseId: id } } });
    const byPerson = new Map(shares.map((s) => [s.participantId, s.amountCents]));
    expect([a, b, c].map((p) => byPerson.get(p) ?? 0), `G11 ${input.title}`).toEqual(expected);
    expect(shares.reduce((sum, s) => sum + s.amountCents, 0), `G11 ${input.title} adds up`).toBe(totalOf(input));
  }
  driver.cover('G11');
  await checkLedger(driver, token);
  await checkActivity(driver, token);
  return token;
}

/** A group with nothing in it yet: every screen's empty state. */
export async function seedEmpty(driver: Driver, names: string[]): Promise<string> {
  const token = await newGroup(driver, 'Grupo recién creado', names);
  const overview = await checkLedger(driver, token);
  expect(overview.feed).toEqual([]);
  expect(overview.plan).toEqual([]);
  await checkKitty(driver, token);
  await checkActivity(driver, token);
  return token;
}

/** P5, G13 — the longest names and concepts the app accepts, for the visual pass. */
export async function seedLongNames(driver: Driver, rng: Rng): Promise<string> {
  const fifty = (stem: string) => `${stem} `.padEnd(50, 'x').slice(0, 50);
  const names = [
    'María de los Ángeles Fernández-Villaverde Rodríguez'.slice(0, 50),
    'José Antonio Martínez de la Fuente y Sánchez-Mora'.padEnd(50, '.'),
    fifty('Maximiliano Bartolomé'),
    'Wenceslao',
    'Bo',
  ];
  expect(names.slice(0, 3).every((n) => n.length === 50)).toBe(true);
  const token = await newGroup(driver, 'Excursión de fin de curso del instituto con las familias y los profes', names);
  const people = (await prisma.participant.findMany({ where: { groupId: token } })).map((p) => p.id);
  const concept = 'Cena de gala en el restaurante del parador con menú degustación, bodega, sobremesa larga y taxis de vuelta a casa '.padEnd(120, '.').slice(0, 120);
  for (let i = 0; i < 30; i++) {
    const input = buildExpense(rng, { date: isoDay(new Date('2026-06-01T00:00:00Z'), i), active: people, itemized: i % 5 === 0, payerCount: i % 4 === 0 ? 2 : 1 });
    if (i % 3 === 0) input.title = concept;
    if (i === 7) input.items = input.items.map((item) => ({ ...item, label: concept }));
    await driver.ok(token, 'long names expense', createExpense(token, input));
  }
  driver.cover('P5', 'G13');
  await checkLedger(driver, token);
  await checkActivity(driver, token);
  return token;
}
