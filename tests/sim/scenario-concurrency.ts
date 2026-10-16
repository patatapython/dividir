import { expect } from 'vitest';
import type { ActionResult } from '../../src/server/action-result';
import { addParticipant, archiveParticipant, deleteParticipant } from '../../src/server/actions/participants';
import { createExpense, deleteExpense, updateExpense } from '../../src/server/actions/expenses';
import { createRefund } from '../../src/server/actions/refunds';
import { createGroupCharge, payGroupCharge } from '../../src/server/actions/group-charge';
import { addContributions, addSpend, closeKittyRound, openKittyRound } from '../../src/server/actions/kitty';
import { prisma } from '../../src/server/db';
import type { Driver } from './driver';
import type { Rng } from './rng';
import { buildExpense, type ExpenseIn } from './generate';
import { checkActivity, checkKitty, checkLedger, openRoundBalance } from './invariants';
import { newGroup } from './scenario-big-group';

/**
 * Plan §4 K1–K9: several devices acting on the same rows at the same instant. The
 * calls run truly in parallel against Postgres (real transactions and row locks);
 * each outcome must be either a success or a clean Spanish refusal, and the
 * invariants must hold afterwards.
 */
export async function raceDevices(driver: Driver, rng: Rng, names: string[]): Promise<string> {
  const token = await newGroup(driver, 'Concurrencia', names);
  const people = (await prisma.participant.findMany({ where: { groupId: token }, orderBy: { createdAt: 'asc' } })).map((p) => p.id);
  driver.as(token, null);
  const settle = async (label: string, calls: Promise<ActionResult<unknown>>[]) => {
    const results = await Promise.all(calls.map((c) => c.catch((error: unknown) => ({ ok: false as const, error: `UNHANDLED ${String(error)}` }))));
    for (const r of results) if (!r.ok) expect(r.error, `${label}: a refusal, never an unhandled error`).not.toMatch(/^UNHANDLED/);
    const oks = results.filter((r) => r.ok).length;
    driver.countActivity(token, oks);
    return { results, oks, refusals: results.filter((r) => !r.ok).map((r) => (r as { error: string }).error) };
  };

  // K1 — 30 expenses from 10 phones at once.
  const k1 = await settle('K1', Array.from({ length: 30 }, (_, i) =>
    createExpense(token, buildExpense(rng, { date: '2026-09-10', active: people, itemized: i % 4 === 0, payerCount: i % 5 === 0 ? 2 : 1 }))));
  expect(k1.oks, 'K1 every concurrent expense is saved').toBe(30);
  driver.cover('K1');

  // K2 — ten refunds of 20 € race for a 100 € expense: exactly five fit.
  const base: ExpenseIn = {
    title: 'Entradas', date: '2026-09-10', payers: [{ participantId: people[0], amount: '100,00' }],
    items: [{ amount: '100,00', splitMode: 'EQUAL', shares: people.slice(0, 5).map((participantId) => ({ participantId, shareInput: 1 })) }],
  };
  const target = await driver.ok(token, 'K2 expense', createExpense(token, base));
  const k2 = await settle('K2', people.map((receivedById) => createRefund(token, { expenseId: target.id, receivedById, amount: '20,00' })));
  expect(k2.oks, 'K2 the refund cap holds under a race').toBe(5);
  for (const e of k2.refusals) expect(e).toMatch(/supera/);
  driver.cover('K2');

  // K3 — twelve spends of 15 € race for a 100 € bote: never below zero.
  const round = await driver.ok(token, 'K3 open', openKittyRound(token, { name: 'Carrera' }));
  await driver.ok(token, 'K3 contributions', addContributions(token, round.id, { contributions: people.map((participantId) => ({ participantId, amount: '10,00' })) }));
  const k3 = await settle('K3', Array.from({ length: 12 }, () => addSpend(token, round.id, { concept: 'Ronda', amount: '15,00' })));
  expect(k3.oks, 'K3 only the spends that fit').toBe(6);
  expect((await openRoundBalance(token))!.balance, 'K3 what is left').toBe(1000);
  driver.cover('K3');

  // K5 — two phones close the same round at once, each its own way.
  const k5 = await settle('K5', [
    closeKittyRound(token, round.id, { action: 'CERRAR' }),
    closeKittyRound(token, round.id, { action: 'REPARTIR' }),
  ]);
  expect(k5.oks, 'K5 a round closes once').toBe(1);
  expect(k5.refusals[0]).toMatch(/cerrada/);
  driver.cover('K5');

  // K6 — two phones open a round at once.
  const k6 = await settle('K6', [openKittyRound(token, { name: 'A' }), openKittyRound(token, { name: 'B' })]);
  expect(k6.oks, 'K6 one open round at a time').toBe(1);
  expect(k6.refusals[0]).toMatch(/abierta/);
  driver.cover('K6');

  // K4 — someone is archived while five phones add expenses that include them.
  const leaver = people[9];
  const withLeaver = () => ({
    ...base, title: 'Cena con quien se va',
    items: [{ amount: '40,00', splitMode: 'EQUAL' as const, shares: [people[1], leaver].map((participantId) => ({ participantId, shareInput: 1 })) }],
    payers: [{ participantId: people[1], amount: '40,00' }],
  });
  const k4 = await settle('K4', [archiveParticipant(token, leaver), ...Array.from({ length: 5 }, () => createExpense(token, withLeaver()))]);
  expect(k4.results[0].ok, 'K4 the archive goes through').toBe(true);
  for (const e of k4.refusals) expect(e).toMatch(/archivad/);
  const shared = await prisma.expenseShare.count({ where: { participantId: leaver, item: { expense: { title: 'Cena con quien se va' } } } });
  expect(shared, 'K4 exactly the expenses that won the race include them').toBe(k4.oks - 1);
  driver.cover('K4');

  // K7 — the same expense edited on one phone and deleted on another.
  const victims = await prisma.expense.findMany({ where: { groupId: token, title: { not: 'Entradas' } }, take: 8 });
  const k7 = await settle('K7', victims.flatMap((v) => [
    updateExpense(token, v.id, { ...base, title: 'Editado a la vez' }),
    deleteExpense(token, v.id),
  ]));
  for (const e of k7.refusals) expect(e).toMatch(/ya no existe/);
  expect(await prisma.expense.count({ where: { id: { in: victims.map((v) => v.id) } } }), 'K7 every deleted expense is gone').toBe(0);
  driver.cover('K7');

  // K8 — "Lo pagó X" pressed on two phones for the same unpaid charge.
  const charge = await driver.ok(token, 'K8 charge', createGroupCharge(token, {
    concept: 'Casa rural', date: '2026-09-10', amount: '300,00', splitMode: 'EQUAL', shares: people.slice(0, 6).map((participantId) => ({ participantId, shareInput: 1 })),
  }));
  const k8 = await settle('K8', [payGroupCharge(token, charge.id, { payerId: people[2] }), payGroupCharge(token, charge.id, { payerId: people[3] })]);
  expect(k8.oks, 'K8 an unpaid charge is paid once').toBe(1);
  expect(await prisma.expense.count({ where: { groupId: token, title: 'Casa rural' } })).toBe(1);
  driver.cover('K8');

  // K9 — a person deleted while another phone adds an expense that names them.
  const temp = await driver.ok(token, 'K9 add', addParticipant(token, 'Temporal'));
  const k9 = await settle('K9', [
    deleteParticipant(token, temp.id),
    createExpense(token, { ...base, title: 'Con Temporal', items: [{ amount: '10,00', splitMode: 'EQUAL', shares: [{ participantId: temp.id, shareInput: 1 }] }], payers: [{ participantId: people[0], amount: '10,00' }] }),
  ]);
  expect(k9.oks, 'K9 exactly one of them wins').toBe(1);
  driver.cover('K9');

  await checkLedger(driver, token);
  await checkKitty(driver, token);
  await checkActivity(driver, token);
  return token;
}
